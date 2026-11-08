/**
 * dsh-ming-mousepet · 独立鼠标键盘
 *
 * 只做“输入”这一层：鼠标、键盘、滚轮、拖拽、截图定位。
 * 默认走 UIA / 窗口消息，不移动主人的真实光标、不抢键盘焦点；
 * 物理输入是显式回退，主人一碰鼠标键盘就暂停并还原光标。
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InputEngine } from './lib/engine.js'
import { judgeNudge, loadPetState, savePetState, spokenToday , updatePetState, normalizeSchedulePatch } from './lib/pet.js'
import { ensureWorkspace, resolveCardPath, startTalker } from './lib/talker.js'

export const name = 'ming-mousepet'
export const inject = ['tools', 'attachments', 'webServer']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const PREVIEW_DIR = join(PLUGIN_DIR, 'assets', 'previews')
const SETTINGS_FILE = join(homedir(), '.dsh', 'ming-mousepet', 'settings.json')
// 2026-11-08：用户自己加的皮肤。内置那十五只只读，这里的是可增可删的。
const SKINS_DIR = join(homedir(), '.dsh', 'ming-mousepet', 'skins')
const SKIN_NAME_RE = /^[a-z0-9_-]{1,40}$/i
const STYLE_IDS = [
  'pointer', 'work', 'unavailiable', 'link', 'text',
  'cross', 'busy', 'move', 'vert', 'horz',
  'help', 'handwriting', 'dgn1', 'dgn2', 'alternate',
]

function toLosslessJson(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toLosslessJson)
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = toLosslessJson(item)
  return out
}

async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (mod?.defineTool) return mod.defineTool
  } catch { /* 本地测试时走环境变量 */ }
  const override = process.env.DSH_TOOLS_PATH
  if (override) {
    const { pathToFileURL } = await import('node:url')
    const mod = await import(pathToFileURL(override).href)
    if (mod?.defineTool) return mod.defineTool
  }
  // 最小兜底：只在没有 DSH 的单元测试里用；真实宿主一定有 dsh-tools。
  return (definition) => definition
}

function statusText(s) {
  const paused = s?.paused ? `已暂停（${s.pauseReason || '主人接管'}）` : '运行中'
  const age = Number.isFinite(s?.lastUserInputAgeMs) && s.lastUserInputAgeMs >= 0
    ? `${Math.round(s.lastUserInputAgeMs)}ms 前`
    : '还没记录'
  const fg = s?.foreground?.title || s?.foreground?.className || '未知'
  const cursor = s?.cursor ? `(${s.cursor.x}, ${s.cursor.y})` : '未知'
  const mode = s?.cursorMode === 'clean'
    ? `整洁模式（动作后约 ${s?.cursorHoldMs || 2600}ms 收起，${s?.cursorSize || 64}px · ${s?.cursorState || 'pointer'}）`
    : `陪伴模式（一直显示，${s?.cursorSize || 64}px · ${s?.cursorState || 'pointer'}）`
  const lines = [
    `独立输入：${paused}`,
    `主人最近一次真实输入：${age}`,
    `真实光标：${cursor} · AI 光标：${s?.overlay ? '显示' : '隐藏'} · ${mode}`,
    (s?.cursorOverlay?.hasLast
      ? `AI 光标坐标：(${s.cursorOverlay.x}, ${s.cursorOverlay.y})（物理像素）`
      : 'AI 光标坐标：还没落过位'),
    `前台窗口：${fg}`,
  ]
  if (s?.paused) {
    lines.push('⚠ 主人已经暂停/接管输入。不要继续操作；等主人说“继续”，再调用 action:"resume"。')
  } else {
    lines.push(`主人随时可按 ${s?.hotkey || 'Ctrl+Alt+Q'} 暂停。`)
  }
  return lines.join('\n')
}

function windowsText(r) {
  const list = Array.isArray(r?.windows) ? r.windows : []
  if (!list.length) return '没读到可用窗口。'
  const lines = list.slice(0, 24).map((w) => {
    const rect = w.rect ? `${w.rect.x},${w.rect.y} ${w.rect.w}x${w.rect.h}` : '?'
    const mark = w.foreground ? ' ★前台' : ''
    return `hwnd ${w.hwnd} · ${w.title} · ${rect} · ${w.process || ''}${mark}`.trim()
  })
  if (list.length > 24) lines.push(`……还有 ${list.length - 24} 个窗口未列出`)
  return lines.join('\n')
}

function resultText(action, r) {
  if (!r || typeof r !== 'object') return `已执行 ${action}。`
  if (r.paused) {
    return `⚠ 主人已经暂停/接管输入，动作没有执行。\n${r.note || '等主人说继续，再 action:"resume"。'}`
  }
  if (r.ok === false) {
    const bits = [`未完成（${r.reason || '未知原因'}）`]
    if (r.name) bits.push(`目标：${r.name}`)
    if (r.type) bits.push(`类型：${r.type}`)
    if (r.note) bits.push(r.note)
    if (r.needsPhysical) bits.push('如果必须物理点击，明确传 mode:"physical"。')
    return bits.join('\n')
  }
  if (action === 'capture') {
    return `截图已保存：${r.path}\n${r.attached ? '图已附在本条结果里。' : '用 read_image 看它。'}`
  }
  if (action === 'overlay') {
    if (r.visible === false) return 'AI 光标已隐藏；主人的真实光标没有移动。'
    const mode = r.cursorMode === 'clean' ? '整洁模式（一会儿自动收起）' : '陪伴模式（一直显示）'
    return `AI 光标已到 (${r.x ?? '?'}, ${r.y ?? '?'}) · ${mode} · ${r.cursorSize || 64}px · ${r.cursorState || 'pointer'}；主人的真实光标没有移动。`
  }
  if (action === 'move') {
    const mode = r.cursorMode === 'clean' ? '整洁模式（一会儿自动收起）' : '陪伴模式（一直显示）'
    return `AI 光标已到 (${r.x ?? '?'}, ${r.y ?? '?'}) · ${mode} · ${r.cursorSize || 64}px · ${r.cursorState || 'pointer'}；主人的真实光标没有移动。`
  }
  const via = r.via || 'unknown'
  if (via === 'uia') {
    return `UIA 已执行（${r.pattern || 'pattern'}）${r.name ? `：${r.name}` : ''}${r.type ? ` · ${r.type}` : ''}`
  }
  if (via === 'wm_settext') {
    return `已直接写入控件${r.verified ? '（已回读确认）' : ''}；没有移动光标，也没有抢焦点。`
  }
  if (via === 'uia-focus+physical') {
    return `UIA 聚焦“${r.name || '目标'}”后用独立键盘输入；鼠标没有移动。`
  }
  if (via === 'uia+message') {
    return `UIA 没有可用模式，已改用窗口消息聚焦并输入${r.verified ? '（已确认）' : '（需截图确认）'}。`
  }
  if (via === 'message') {
    const target = r.title ? `“${r.title}”` : (r.hwnd ? `hwnd ${r.hwnd}` : '目标')
    return `窗口消息已投递给 ${target}${r.verified ? '（已确认）' : '（不一定被处理，请截图确认）'}。`
  }
  if (via === 'physical') {
    return `物理输入完成；主人光标已还原。${r.note || ''}`
  }
  return `已执行 ${action}：${JSON.stringify(r).slice(0, 600)}`
}

function toolSpec() {
  return {
    name: 'pet_input',
    description:
      '独立鼠标键盘：默认用 UIA / 窗口消息操作屏幕，**不移动主人的真实光标、不抢键盘焦点**，所以主人随时可以继续用鼠标键盘、暂停或提意见。\n\n'
      + '用法顺序：\n'
      + '1. 先 `status` 看是否 paused、前台窗口、真实光标位置；paused 就停手，等主人说继续。\n'
      + '2. 用 `windows` 或 `capture` 拿目标坐标（屏幕绝对像素；`capture` 的图会直接附在结果里）。\n'
      + '3. 用 `click` / `type` / `key` / `scroll` / `drag`，默认 `mode:"auto"`：UIA → 窗口消息；只有明确 `mode:"physical"` 才动用真实光标/键盘。\n'
      + '4. 每个动作后截图确认，不要假设点中了。\n\n'
      + 'AI 光标：开始操作时用 `move` 让它出现。两种模式 —— `companion`（陪伴，默认，一直显示到收工）'
      + '和 `clean`（整洁，动作后约 2.6 秒自动收起）。插件 config 里改 `cursorMode` / `cursorSize`（24–192，默认 64）；'
      + '光标外观按操作**自动切换**（默认 pointer、输入 text、可点元素 link、滚动 vert、拖拽 move/dgn1/dgn2、精确点击 cross、暂停 unavailiable、失败 help），不用手选。'
      + '运行中也可以 `overlay({cursorMode:"clean", cursorSize:96})` 切换；收工用 `overlay({show:false})` 收起。\n\n'
      + '安全规则：\n'
      + '- 物理模式会短暂使用真实光标；主人一碰鼠标键盘就立刻暂停并把光标放回原处。\n'
      + '- 主人按 **Ctrl+Alt+Q** 随时暂停；下一次动作会返回 paused，必须停下。\n'
      + '- 不要用这个工具做破坏性操作（删文件、关窗口、支付），除非主人明确要求。\n\n'
      + 'actions: status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay / probe / calscan。\\n\\n'
      + '排查坐标用 `probe`（这只窗口该去哪、记成哪、实际在哪）和 `calscan`（给一个点，量系统读回的是不是同一个点——'
      + '用来分清「逻辑像素 / 物理像素」到底哪个环节没对上）。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'status | windows | capture | click | type | key | scroll | drag | move | pause | resume | overlay | probe | calscan',
      },
      go: { type: 'boolean', description: 'calscan：true 才真的移动一次真实光标去量（测完自动还原）；省略只报口径' },
      x: { type: 'number', description: '屏幕绝对 x（click/type/scroll/drag 的起点/move/overlay）' },
      y: { type: 'number', description: '屏幕绝对 y' },
      toX: { type: 'number', description: 'drag 终点 x' },
      toY: { type: 'number', description: 'drag 终点 y' },
      button: { type: 'string', description: 'left（默认）或 right' },
      count: { type: 'integer', description: '点击次数，默认 1；2 = 双击' },
      text: { type: 'string', description: 'type 要输入的文字' },
      replace: { type: 'boolean', description: 'type：true 覆盖原内容，false（默认）追加' },
      keys: { type: 'string', description: 'key：组合键，如 "ctrl+c"、"alt+tab"、"enter"' },
      mode: {
        type: 'string',
        description: 'auto（默认）| uia | message | physical。auto 先 UIA 再窗口消息，不用真实光标；physical 才动用真实光标/键盘',
      },
      delta: { type: 'number', description: 'scroll 滚轮量：正数向上、负数向下，默认 -120' },
      durationMs: { type: 'number', description: 'drag 持续时间，默认 400ms' },
      hwnd: { type: 'number', description: '可选：type/key 的 physical 模式先聚焦这个窗口' },
      path: { type: 'string', description: 'capture 保存 PNG 的绝对路径；省略则自动放 ~/.dsh/ming-mousepet/shots/' },
      rect: { type: 'string', description: 'capture 区域："x,y,w,h" 或 "full"；省略则截当前前台窗口' },
      show: { type: 'boolean', description: 'overlay：false 隐藏 AI 光标，true/省略 显示' },
      cursorMode: {
        type: 'string',
        description: 'overlay：companion（陪伴，一直显示，默认）| clean（整洁，动作后自动收起）',
      },
      cursorSize: {
        type: 'number',
        description: 'overlay：AI 光标大小（像素，24–192，默认 64）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          images: { type: 'array', items: { type: 'object', additionalProperties: true } },
          meta: { type: 'object', additionalProperties: true },
        },
      },
      render(_args, value) {
        const blocks = []
        for (const image of value.images || []) blocks.push({ type: 'image', attachment: image })
        blocks.push({ type: 'text', text: value.text })
        return blocks
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe() {
      return false
    },
  }
}

function normalizeSettings(input, fallback = {}) {
  const merged = { ...(fallback || {}), ...(input || {}) }
  const mode = merged.cursorMode === 'clean' ? 'clean' : 'companion'
  const hold = Number(merged.cursorHoldMs)
  const size = Number(merged.cursorSize)
  const wanted = String(merged.cursorState || '').toLowerCase()
  let style = 'pointer'
  if (wanted.startsWith('custom:') && SKIN_NAME_RE.test(wanted.slice(7))) style = wanted
  else if (STYLE_IDS.includes(wanted)) style = wanted
  return {
    cursorMode: mode,
    cursorHoldMs: Number.isFinite(hold) ? Math.max(300, Math.min(10000, Math.round(hold))) : 2600,
    cursorSize: Number.isFinite(size) ? Math.max(24, Math.min(192, Math.round(size))) : 64,
    // 2026-11-08：皮肤。15 只光标换着用，面板上点一下就是这个。
    cursorState: style,
    // 2026-11-08（她提的「桌面那只只能用默认模型」）：自动开口用哪个模型。
    // 存这里的目的是能在页面上换；留空就退回 cordis.patch.yml 的 companion.provider / companion.model。
    // 只收字符串——写坏了自动开口就起不来，宁可退回默认。
    talkProvider: typeof merged.talkProvider === 'string' ? merged.talkProvider.trim().slice(0, 80) : '',
    talkModel: typeof merged.talkModel === 'string' ? merged.talkModel.trim().slice(0, 120) : '',
  }
}

async function loadSavedSettings(log = () => {}) {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function persistSettings(settings) {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('请求不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

export async function apply(ctx, rawConfig = {}) {
  const defineTool = await loadDefineTool()
  const log = (message) => { try { ctx?.logger?.info?.(`[ming-mousepet] ${message}`) } catch { /* ignore */ } }
  const saved = await loadSavedSettings(log)
  let current = normalizeSettings(saved, normalizeSettings(rawConfig))
  // 2026-11-08 21:1x 她：「点按桌宠直接进行一次不记次数的活动，长按拖动」。
  // sidecar 判出「这是一次轻点」才抛 tap；这里把它接成「桌宠说一句」，不占每日配额、不动 nextAt。
  let lastTapAt = 0
  const engine = new InputEngine({
    log,
    ...current,
    onTap: (evt) => {
      const now = Date.now()
      if (now - lastTapAt < 2500) return // 连点、抖手只算一次
      lastTapAt = now
      const poke = stopTalker && stopTalker.poke
      if (typeof poke === 'function') {
        Promise.resolve(poke(evt)).catch((error) => log(`点一下没应上：${error?.message || error}`))
        return
      }
      // 自动开口没开也得有反应，不然点了像坏了。就一个字，不替模型编话。
      engine.request('say', { text: '在', ms: 1600 }, 8000).catch(() => {})
    },
  })
  const toolConfig = toolSpec()

  const tool = {
    ...toolConfig,
    async execute(args = {}) {
      const action = String(args.action || 'status').toLowerCase()
      try {
        if (action === 'probe') {
          // 2026-11-08 17:0x 诊断：要它去哪 / 它记成哪 / 窗口实际在哪，一次说清
          const r = await engine.request('probe', { x: args.x, y: args.y }, 15000)
          const bits = [
            '要它去 (' + (r.asked && r.asked.x) + ', ' + (r.asked && r.asked.y) + ')',
            '记成 (' + (r.last && r.last.x) + ', ' + (r.last && r.last.y) + ')',
            '窗口实际在 (' + (r.form && r.form.x) + ', ' + (r.form && r.form.y) + ')',
            'dpiScale ' + r.dpiScale,
            '屏幕 ' + (r.screen && r.screen.w) + '×' + (r.screen && r.screen.h),
          ]
          return toLosslessJson({ text: 'probe：' + bits.join(' · '), meta: r })
        }
        if (action === 'calscan') {
          // 2026-11-08 17:2x astra：probe 被入口排除在换算之外，它量的是「逻辑空间里的摆放」，
          // 不能拿来证明物理落点。这条对着物理落点量：给一个点，看系统读回的是不是它。
          const r = await engine.request('calscan', { x: args.x, y: args.y, go: args.go === true }, 20000)
          if (r && r.moved === false) {
            const t = 'calscan：虚拟屏 ' + (r.virtualScreen && r.virtualScreen.w) + '×' + (r.virtualScreen && r.virtualScreen.h)
              + ' · 主屏 Bounds ' + (r.primaryBounds && r.primaryBounds.w) + '×' + (r.primaryBounds && r.primaryBounds.h)
              + ' · dpiScale ' + r.dpiScale
              + '（只报口径；要真量加 go:true）'
            return toLosslessJson({ text: t, meta: r })
          }
          const ex = r && r.error ? r.error.x : null
          const ey = r && r.error ? r.error.y : null
          const t = 'calscan：给它 (' + (r.asked && r.asked.x) + ', ' + (r.asked && r.asked.y) + ')'
            + ' · 系统读回 (' + (r.readBack && r.readBack.x) + ', ' + (r.readBack && r.readBack.y) + ')'
            + ' · 偏差 (' + ex + ', ' + ey + ')'
          return toLosslessJson({ text: t, meta: r })
        }
        if (action === 'status') {
          const s = await engine.request('status', {}, 10000)
          return toLosslessJson({ text: statusText(s), meta: s })
        }
        if (action === 'windows') {
          const r = await engine.request('windows', {}, 15000)
          return toLosslessJson({ text: windowsText(r), meta: r })
        }
        if (action === 'pause') {
          const s = await engine.request('pause', {}, 10000)
          return toLosslessJson({ text: `已暂停。\n${statusText(s)}`, meta: s })
        }
        if (action === 'resume') {
          const s = await engine.request('resume', {}, 10000)
          return toLosslessJson({ text: `已恢复。\n${statusText(s)}`, meta: s })
        }
        if (action === 'move') {
          const r = await engine.request('move', { x: args.x, y: args.y }, 10000)
          const meta = { ...r, cursorMode: engine.cursorMode, cursorSize: engine.cursorSize, cursorState: engine.cursorState }
          return toLosslessJson({ text: resultText('move', meta), meta })
        }
        if (action === 'overlay') {
          let modeResult = null
          let sizeResult = null
          if (args.cursorMode) {
            if (args.cursorMode !== 'clean' && args.cursorMode !== 'companion') {
              throw new Error('cursorMode 只能是 clean 或 companion')
            }
            modeResult = await engine.setCursorMode(args.cursorMode)
          }
          if (args.cursorSize !== undefined) {
            sizeResult = await engine.setCursorSize(args.cursorSize)
          }
          const mode = modeResult?.cursorMode || engine.cursorMode
          const size = sizeResult?.cursorSize || engine.cursorSize
          if (args.show === false) {
            const r = await engine.request('overlay', { show: false }, 10000)
            return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, ...modeResult, ...sizeResult } })
          }
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            const r = await engine.request('overlay', { show: true, x: args.x, y: args.y }, 10000)
            return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, ...modeResult, ...sizeResult } })
          }
          if (modeResult || sizeResult) {
            const modeZh = mode === 'clean'
              ? `整洁模式：动作后约 ${modeResult?.cursorHoldMs || engine.cursorHoldMs}ms 自动收起`
              : '陪伴模式：一直显示到收工'
            return toLosslessJson({
              text: `AI 光标已切换：${modeZh} · ${size}px。`,
              meta: { ...(modeResult || {}), ...(sizeResult || {}), cursorMode: mode, cursorSize: size, cursorState: engine.cursorState, ok: true },
            })
          }
          const r = await engine.request('overlay', { show: true }, 10000)
          return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState } })
        }
        if (action === 'click') {
          // 让它先飞过去（2026-11-08）：她要看见是「这只光标」在点，不是屏幕某处自己闪一下。
          // 150ms 是让它落位、她来得及看见；光标没开着也不影响动作本身。
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            try { await engine.request('glide', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22), ms: 600 }, 8000) } catch { /* 光标没开着就算了 */ }
            // 2026-11-08 16:4x：滑行是 600ms，只等 150ms 就会在半路上点下去。等它落地再动手。
            await new Promise((r2) => setTimeout(r2, 700))
            // 2026-11-08 17:0x：glide 滑完之后位置会飘（probe 证明 DisplayAt 本身是准的：400,300→401,302），
            // 所以滑行只当动画，落点用一次 move 校正——差的那几像素看不出来，但点得准。
            try { await engine.request('move', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22) }, 8000) } catch { /* 光标没开着就算了 */ }
          }
          const r = await engine.request('click', {
            x: args.x, y: args.y, button: args.button, count: args.count, mode: args.mode,
          }, 30000)
          return toLosslessJson({ text: resultText('click', r), meta: r })
        }
        if (action === 'type') {
          const r = await engine.request('type', {
            x: args.x, y: args.y, text: args.text, replace: args.replace,
            mode: args.mode, hwnd: args.hwnd,
          }, 60000)
          return toLosslessJson({ text: resultText('type', r), meta: r })
        }
        if (action === 'key') {
          const r = await engine.request('key', {
            keys: args.keys, mode: args.mode, hwnd: args.hwnd,
          }, 30000)
          return toLosslessJson({ text: resultText('key', r), meta: r })
        }
        if (action === 'scroll') {
          // 让它先飞过去（2026-11-08）：她要看见是「这只光标」在点，不是屏幕某处自己闪一下。
          // 150ms 是让它落位、她来得及看见；光标没开着也不影响动作本身。
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            try { await engine.request('glide', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22), ms: 600 }, 8000) } catch { /* 光标没开着就算了 */ }
            // 2026-11-08 16:4x：滑行是 600ms，只等 150ms 就会在半路上点下去。等它落地再动手。
            await new Promise((r2) => setTimeout(r2, 700))
          }
          const r = await engine.request('scroll', {
            x: args.x, y: args.y, delta: args.delta, mode: args.mode,
          }, 30000)
          return toLosslessJson({ text: resultText('scroll', r), meta: r })
        }
        if (action === 'drag') {
          // 起点先飞过去，拖完停在终点（2026-11-08）
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            try { await engine.request('glide', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22), ms: 600 }, 8000) } catch { /* 光标没开着就算了 */ }
            // 2026-11-08 16:4x：滑行是 600ms，只等 150ms 就会在半路上点下去。等它落地再动手。
            await new Promise((r2) => setTimeout(r2, 700))
          }
          const r = await engine.request('drag', {
            x: args.x, y: args.y, toX: args.toX, toY: args.toY,
            durationMs: args.durationMs, mode: args.mode,
          }, 90000)
          if (Number.isFinite(args.toX) && Number.isFinite(args.toY)) {
            try { await engine.request('move', { x: Math.max(0, args.toX - 26), y: Math.max(0, args.toY - 22) }, 8000) } catch { /* 光标没开着就算了 */ }
          }
          return toLosslessJson({ text: resultText('drag', r), meta: r })
        }
        if (action === 'capture') {
          return await capture(ctx, engine, args)
        }
        return {
          text: '未知 action。可用：status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay。',
          meta: { ok: false, action },
        }
      } catch (error) {
        return toLosslessJson({
          text: `独立输入没完成：${error?.message || error}`,
          meta: { ok: false, action },
        })
      }
    },
  }

  const dispose = ctx.tools.register(defineTool(tool))

  const petOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        images: { type: 'array', items: { type: 'object', additionalProperties: true } },
        meta: { type: 'object', additionalProperties: true },
      },
    },
    render(_args, value) {
      const blocks = []
      for (const image of value.images || []) blocks.push({ type: 'image', attachment: image })
      blocks.push({ type: 'text', text: value.text })
      return blocks
    },
  }

  const petTool = {
    name: 'pet',
    description:
      '桌面上陪着她：看得见、会说话、也能动手，但**默认只读**。\n\n'
      + '- `status` 现在什么情况（前台窗口、她多久没动、光标状态、今天说过几次）。\n'
      + '- `look` 看一眼屏幕（可裁），图直接附上来。\n'
      + '- `watch` 连拍几秒，只回变化大的帧——静止画面只回一张，比连拍便宜。\n'
      + '- `say` 在桌面上说一句话：无边框气泡浮在她光标上方，几秒自己消失，不抢焦点、不打断她。\n'
      + '- `nudge` 问「现在值不值得开口」：回 speak 与否、为什么、现在什么情况。它**不生成话**——话得自己写。\n'
      + '- `cursor` 控制 AI 光标（显示 / 隐藏 / 移动 / 大小 / 模式）。\n\n'
      + '开口的规矩：先 `nudge`，说不要就别硬说；一天最多 6 次、两次至少隔 10 分钟、'
      + '她 15 秒内动过电脑就别说、静音 00:30–10:30。一次一句，别连发；'
      + '说的时候要有由头（她安静久了、屏幕上有什么、时间），没由头就不说。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'status | look | watch | say | point | cursor | drift | nudge | config',
      },
      text: { type: 'string', description: 'say / point：要说的话，一句，40 字以内最好' },
      ms: { type: 'number', description: 'say：气泡停留毫秒，默认 3200' },
      x: { type: 'number', description: 'say/cursor：屏幕绝对 x；say 省略就浮在光标上方' },
      y: { type: 'number', description: 'say/cursor：屏幕绝对 y' },
      rect: { type: 'string', description: 'look：截图区域 "x,y,w,h" 或 "full"；省略截前台窗口' },
      path: { type: 'string', description: 'look：存 PNG 的路径；省略自动放 ~/.dsh/ming-mousepet/shots/' },
      seconds: { type: 'number', description: 'watch：看几秒，默认 4（0.5–20）' },
      fps: { type: 'number', description: 'watch：每秒采样几次，默认 4（0.5–10）' },
      frames: { type: 'integer', description: 'watch：最多留几帧，默认 4（1–9）' },
      quietHours: { type: 'boolean', description: 'config：宵禁开关；false = 00:30–10:30 也开口（测试用）' },
      on: { type: 'boolean', description: 'drift：false = 停止晃动' },
      show: { type: 'boolean', description: 'cursor：false 收起 AI 光标' },
      cursorMode: { type: 'string', description: 'cursor：companion（一直显示）| clean（用完就收）' },
      cursorSize: { type: 'number', description: 'cursor：24–192 像素' },
    },
    output: petOutput,
    timeoutMs: 120000,
    isConcurrencySafe() {
      return false
    },
    async execute(args = {}) {
      const action = String(args.action || 'status').toLowerCase()
      const now = new Date()
      try {
        if (action === 'status') {
          const s = await engine.request('status', {}, 10000)
          const state = await loadPetState()
          return toLosslessJson({ text: petStatusText(s, state, now), meta: s })
        }
        if (action === 'look') {
          return await capture(ctx, engine, args)
        }
        if (action === 'watch') {
          const r = await engine.request('watch', {
            seconds: args.seconds,
            fps: args.fps,
            frames: args.frames,
            out: args.out,
          }, 60000)
          const list = Array.isArray(r?.frames) ? r.frames : []
          let images = []
          if (list.length) {
            const top = list.slice().sort((a, b) => (b.diff || 0) - (a.diff || 0))[0]
            images = await attachImages(ctx, [top.path])
          }
          const lines = [`看了 ${r?.seconds ?? '?'} 秒，抓 ${r?.captured ?? 0} 帧，留下 ${list.length} 帧：`]
          for (const f of list) lines.push(`  ${f.t}s · 变化 ${f.diff}% · ${f.path}`)
          if (!list.length) lines.push('  画面一直没动。')
          return toLosslessJson({ text: lines.join('\n'), images, meta: r })
        }
        if (action === 'say') {
          const text = String(args.text || '').trim()
          if (!text) throw new Error('say 需要 text')
          const r = await engine.request('say', { text, ms: args.ms, x: args.x, y: args.y }, 15000)
          // 2026-11-08 19:47：工具触发的 say 不再计入「陪伴主动开口」配额，也不重置间隔。
          // 起因：spokenToday 记到 42、dailyMax 是 6，于是自动陪伴每一轮都判「够了」，
          // token 照烧、一句话不说；而 42 次里绝大多数是我自己调的 say。
          // 判据：配额管的是「它自己想不想开口」，不是「屏幕上弹过几次泡」。
          return toLosslessJson({
            text: r?.ok ? `说了：「${text}」` : `没说出来：${r?.error || '未知原因'}`,
            meta: r,
          })
        }
        if (action === 'nudge') {
          const s = await engine.request('status', {}, 10000)
          const state = await loadPetState()
          const verdict = judgeNudge({ now, status: s, state })
          const c = verdict.context
          const lines = [
            verdict.speak ? '可以开口。' : '先别说。',
            `为什么：${verdict.why}`,
            `现在：${c.foreground || '前台未知'}${c.process ? ` · ${c.process}` : ''}`,
            `她安静：${c.idleMin === null ? '读不到' : `${c.idleMin} 分钟`}`
              + ` · 今天说过 ${c.spokenToday} 次`
              + (c.sinceLastSpokeMin === null ? '' : ` · 上次 ${c.sinceLastSpokeMin} 分钟前`),
          ]
          return toLosslessJson({ text: lines.join('\n'), meta: verdict })
        }
        if (action === 'config') {
          const state = await loadPetState()
          const next = { ...state }
          if (args.quietHours !== undefined) next.quietHours = Boolean(args.quietHours)
          await savePetState(next)
          return toLosslessJson({
            text: `宵禁：${next.quietHours === false ? '关着，随时能开口' : '开着，00:30–10:30 不说话'}`,
            meta: { quietHours: next.quietHours },
          })
        }
        if (action === 'drift') {
          const r = await engine.request('drift', { on: args.on !== false }, 10000)
          return toLosslessJson({ text: r?.drift === false ? '光标不晃了。' : '光标开始轻轻晃。', meta: r })
        }
        if (action === 'point') {
          if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error('point 需要 x 和 y')
          // 2026-11-08：手指过去要缓动，不是闪现。
          const moved = await engine.request('glide', { x: args.x, y: args.y, ms: args.glideMs || 800 }, 10000)
          await new Promise((r) => setTimeout(r, 860))
          const text = String(args.text || '').trim()
          if (!text) {
            return toLosslessJson({ text: `光标指到 ${args.x},${args.y}。`, meta: moved })
          }
          const said = await engine.request('say', { text, ms: args.ms, x: args.x, y: args.y }, 15000)
          // 同 say：只是屏幕上弹了一次泡，不算「陪伴自己开口」的一次。
          return toLosslessJson({
            text: said?.ok ? `指着那里说：「${text}」` : `指过去了，话没说出来：${said?.error || '未知'}`,
            meta: { ...moved, ...said },
          })
        }
        if (action === 'cursor') {
          if (args.cursorMode) await engine.setCursorMode(args.cursorMode)
          if (args.cursorSize !== undefined) await engine.setCursorSize(args.cursorSize)
          if (args.show === false) {
            const r = await engine.request('overlay', { show: false }, 10000)
            return toLosslessJson({ text: 'AI 光标收起来了。', meta: r })
          }
          const r = await engine.request('overlay', {
            show: true,
            ...(Number.isFinite(args.x) ? { x: args.x } : {}),
            ...(Number.isFinite(args.y) ? { y: args.y } : {}),
          }, 10000)
          return toLosslessJson({
            text: `AI 光标亮着（${engine.cursorSize}px · ${engine.cursorMode}）。`,
            meta: r,
          })
        }
        return toLosslessJson({
          text: `未知 action。可用：status / look / watch / say / point / cursor / drift / nudge / config。`,
          meta: { ok: false, action },
        })
      } catch (error) {
        return toLosslessJson({
          text: `pet 没做成：${error?.message || error}`,
          meta: { ok: false, action },
        })
      }
    },
  }

  const disposePet = ctx.tools.register(defineTool(petTool))

  const applySettings = async (next) => {
    await engine.setCursorSize(next.cursorSize)
    await engine.setCursorMode(next.cursorMode, next.cursorHoldMs)
    // 2026-11-08：换模型不用重启——talker 每轮醒来看一眼 talkerOptions，
    //   这里把新值写进去，下一次开口就是新的。留空则退回 patch.yml 里那份。
    try {
      talkerOptions.provider = next.talkProvider || companionCfg.provider
      talkerOptions.model = next.talkModel || companionCfg.model
    } catch { /* apply 还没走到那一步时不该有人改设置；真赶上了就等下次生效 */ }
    if (next.cursorState) {
      try {
        if (next.cursorState.startsWith('custom:')) {
          const file = join(SKINS_DIR, `${next.cursorState.slice(7)}.png`)
          await engine.request('setSkin', { path: file }, 15000)
        } else {
          await engine.setCursorStyle(next.cursorState)
        }
      } catch { /* 换皮肤失败不该拦住其它设置 */ }
    }
  }

  const API_PREFIX = '/dsh-ming-mousepet/api'
  const ASSET_PREFIX = '/dsh-ming-mousepet/assets'

  const apiHandler = async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (typeof next === 'function') return next()
      return json(res, 404, { ok: false, error: 'not found' })
    }
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }
    try {
      // 2026-11-08（她提的「桌面那只只能用默认模型」）：把能选的模型列出来。
      //   来源是宿主 llm：listProviders() + 每个 provider 的 listModels()。
      //   某个 provider 列不出来（没目录接口 / 没登录）单独报错，不影响别的。
      if (req.method === 'GET' && route === '/models') {
        const out = {
          ok: true,
          current: {
            provider: current.talkProvider || companionCfg.provider,
            model: current.talkModel || companionCfg.model,
            fromSettings: Boolean(current.talkModel),
            defaultProvider: companionCfg.provider,
            defaultModel: companionCfg.model,
            talkerRunning: Boolean(stopTalker),
          },
          providers: [],
          errors: [],
        }
        if (!llmRef || typeof llmRef.listProviders !== 'function') {
          out.errors.push('宿主没给模型服务（llm），只能手填')
          return json(res, 200, out)
        }
        let list = []
        try {
          list = (await llmRef.listProviders()) || []
        } catch (error) {
          out.errors.push(`列 provider 失败：${error?.message || error}`)
        }
        for (const p of list) {
          const id = String(p?.id || '')
          if (!id) continue
          const entry = { id, name: String(p?.name || id), models: [] }
          try {
            const models = typeof llmRef.listModels === 'function' ? await llmRef.listModels(id) : []
            entry.models = (models || [])
              .map((m) => ({ id: String(m?.id || ''), name: String(m?.name || m?.id || '') }))
              .filter((m) => m.id)
          } catch (error) {
            entry.error = String(error?.message || error)
          }
          out.providers.push(entry)
        }
        return json(res, 200, out)
      }
      if (req.method === 'GET' && route === '/settings') {
        return json(res, 200, { ok: true, settings: current })
      }
      if (req.method === 'POST' && route === '/settings') {
        const body = await readBody(req)
        const nextSettings = normalizeSettings(body, current)
        await applySettings(nextSettings)
        await persistSettings(nextSettings)
        current = nextSettings
        return json(res, 200, { ok: true, settings: current })
      }
      if (req.method === 'GET' && route === '/skins') {
        let custom = []
        try {
          const files = await readdir(SKINS_DIR)
          custom = files
            .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
            .map((f) => f.replace(/\.[^.]+$/, ''))
        } catch { /* 目录还没有就是没有 */ }
        return json(res, 200, { ok: true, builtin: STYLE_IDS, custom })
      }
      if (req.method === 'GET' && route === '/skin-image') {
        const name = new URL(req.url, 'http://127.0.0.1').searchParams.get('name') || ''
        if (!SKIN_NAME_RE.test(name)) return json(res, 400, { ok: false, error: '名字不合法' })
        try {
          const buffer = await readFile(join(SKINS_DIR, `${name}.png`))
          res.statusCode = 200
          res.setHeader('content-type', 'image/png')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('content-length', buffer.length)
          return res.end(buffer)
        } catch {
          return json(res, 404, { ok: false, error: '没有这张皮肤' })
        }
      }
      if (req.method === 'POST' && route === '/skins') {
        const body = await readBody(req)
        const name = String(body?.name || '').trim()
        if (!SKIN_NAME_RE.test(name)) return json(res, 400, { ok: false, error: '名字只能用字母数字、- 和 _（1–40 字）' })
        const raw = String(body?.data || '')
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
        if (!base64) return json(res, 400, { ok: false, error: '没有图片数据' })
        const buffer = Buffer.from(base64, 'base64')
        if (!buffer.length || buffer.length > 3 * 1024 * 1024) {
          return json(res, 400, { ok: false, error: '图片太大（上限 3MB）或读不出来' })
        }
        await mkdir(SKINS_DIR, { recursive: true })
        await writeFile(join(SKINS_DIR, `${name}.png`), buffer)
        return json(res, 200, { ok: true, name, bytes: buffer.length })
      }
      if (req.method === 'DELETE' && route.startsWith('/skins')) {
        const name = new URL(req.url, 'http://127.0.0.1').searchParams.get('name') || ''
        if (!SKIN_NAME_RE.test(name)) return json(res, 400, { ok: false, error: '名字不合法' })
        try {
          await unlink(join(SKINS_DIR, `${name}.png`))
          return json(res, 200, { ok: true })
        } catch {
          return json(res, 404, { ok: false, error: '没有这张皮肤' })
        }
      }
      // 2026-11-08：给「独立的桌面壳」开两个口子。
      // 壳不是 DSH 插件，拿不到工具，只能走这里。
      if (req.method === 'GET' && route === '/pet-status') {
        const [status, state] = await Promise.all([
          engine.request('status', {}, 10000),
          loadPetState(),
        ])
        return json(res, 200, { ok: true, status, petState: state, now: Date.now() })
      }
      if (req.method === 'GET' && route === '/pet-debug') {
        // 光标窗到底画没画出来：hwnd / visible / rect / exStyle。排查「show 说成功但看不见」。
        const info = await engine.request('debug', {}, 10000)
        return json(res, 200, { ok: true, debug: info })
      }
      if (req.method === 'POST' && route === '/pet-tap') {
        // 等价于「她轻点了一下桌宠」：说一句，不记次数。给独立桌面壳和调试用。
        const poke = stopTalker && stopTalker.poke
        if (typeof poke !== 'function') return json(res, 200, { ok: false, error: '自动开口没开着' })
        const r = await poke()
        return json(res, 200, { ok: Boolean(r?.spoken), ...r })
      }
      if (req.method === 'POST' && route === '/pet-tick') {
        // 手动催一轮，不用等 30 秒。调试用；跑完看 companion.log 就知道卡在哪。
        const manual = stopTalker && stopTalker.manual
        if (typeof manual !== 'function') return json(res, 200, { ok: false, error: '自动开口没开着' })
        await manual()
        return json(res, 200, { ok: true })
      }
      if (req.method === 'GET' && route === '/pet-nudge') {
        const [status, state] = await Promise.all([
          engine.request('status', {}, 10000),
          loadPetState(),
        ])
        const verdict = judgeNudge({ now: new Date(), status, state })
        return json(res, 200, { ok: true, ...verdict })
      }
      if (req.method === 'POST' && route === '/pet-say') {
        const body = await readBody(req)
        const text = String(body?.text || '').trim()
        if (!text) return json(res, 400, { ok: false, error: 'text 不能为空' })
        const r = await engine.request('say', { text, ms: body?.ms, x: body?.x, y: body?.y }, 15000)
        // 同 say：HTTP 这条口子也不占配额。
        return json(res, 200, { ok: Boolean(r?.ok), result: r })
      }
      if (req.method === 'POST' && route === '/hide') {
        await engine.request('overlay', { show: false }, 15000)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && route === '/show') {
        await engine.request('overlay', { show: true }, 30000)
        return json(res, 200, { ok: true })
      }
      if (route === '/schedule') {
        // 2026-11-08 15:03：字段跟「自己玩」对齐——
        // gapMode(fixed|random|heartbeat|off) / hbMin / hbCenter / hbMax / minGapMinutes / dailyMax / nextAt。
        const view = (st) => {
          const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d }
          return {
            ok: true,
            gapMode: String(st.gapMode || st.schedMode || 'heartbeat'),
            schedMode: String(st.gapMode || st.schedMode || 'heartbeat'),
            everyMin: n(st.minGapMinutes ?? st.everyMin, 50),
            dailyCap: n(st.dailyMax ?? st.dailyCap, 6) < 0 ? 0 : n(st.dailyMax ?? st.dailyCap, 6),
            hbMin: n(st.hbMin, 15),
            hbCenter: n(st.hbCenter, 30),
            hbMax: n(st.hbMax, 60),
            minGapMinutes: n(st.minGapMinutes ?? st.everyMin, 50),
            dailyMax: n(st.dailyMax ?? st.dailyCap, 6),
            nextAt: n(st.nextAt, 0),
            quietHours: st.quietHours !== false,
            spokenToday: spokenToday(st),
          }
        }
        if (req.method === 'GET') {
          return json(res, 200, view(await loadPetState()))
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const patch = normalizeSchedulePatch(body)
          const next = await updatePetState(st => ({ ...st, ...patch, nextAt: 0 }))
          await stopTalker?.reschedule?.()
          return json(res, 200, view(await loadPetState()))
        }
      }
      return json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      log(`http ${req.method} ${route}: ${error?.message || error}`)
      return json(res, 500, { ok: false, error: String(error?.message || error) })
    }
  }

  const assetHandler = async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(ASSET_PREFIX)) {
      if (typeof next === 'function') return next()
      return json(res, 404, { ok: false, error: 'not found' })
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }
    try {
      const name = url.pathname.slice(ASSET_PREFIX.length).replace(/^\//, '').replace(/\.png$/i, '').toLowerCase()
      if (!STYLE_IDS.includes(name)) return json(res, 404, { ok: false, error: 'unknown style' })
      const buffer = await readFile(join(PREVIEW_DIR, `${name}.png`))
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'public, max-age=3600')
      res.setHeader('content-length', buffer.length)
      return res.end(buffer)
    } catch (error) {
      log(`asset ${url.pathname}: ${error?.message || error}`)
      return json(res, 404, { ok: false, error: 'not found' })
    }
  }

  try {
    if (ctx?.webServer && typeof ctx.effect === 'function') {
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: apiHandler }), 'ming-mousepet: api')
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSET_PREFIX, handler: assetHandler }), 'ming-mousepet: assets')
    } else {
      log('webServer 不可用：设置页 API 没挂上')
    }
  } catch (error) {
    log(`设置页 API 挂载失败：${error?.message || error}`)
  }

  // ---------------------------------------------------------------- 自动开口
  // 2026-11-08 她要的：一个开关，开了就有个会说话的桌宠，不用另开会话、不用另给 key。
  // 走宿主自己的模型通道（ctx.llm），模型名写在插件 config 里。
  const companionCfg = {
    enabled: Boolean(rawConfig?.companion?.enabled),
    tickMs: Number(rawConfig?.companion?.tickMs) || 90000,
    provider: String(rawConfig?.companion?.provider || 'wb-proxy'),
    model: String(rawConfig?.companion?.model || ''),
    bubbleMs: Number(rawConfig?.companion?.bubbleMs) || 4200,
    workspace: String(rawConfig?.companion?.workspace || '') || process.cwd(),
  }
  let stopTalker = null
  let llmRef = null

  // 2026-11-08（她提的「桌面那只只能用默认模型」）：用哪个模型不再只由 patch.yml 定。
  //   settings.json 里的 talkProvider / talkModel 有值就压过 config，留空就退回 config。
  //   talker 每一轮都从这同一个对象上读，所以页面上改完，下一次开口就用新的，不用重启。
  const talkerOptions = {
    ...companionCfg,
    provider: current.talkProvider || companionCfg.provider,
    model: current.talkModel || companionCfg.model,
    cardPath: resolveCardPath(companionCfg.workspace),
    // 2026-11-08：静默读屏那个脚本，每轮醒来跑一次。
    screenScript: join(PLUGIN_DIR, 'scripts', 'read-screen.ps1'),
    logFile: join(homedir(), '.dsh', 'ming-mousepet', 'companion.log'),
  }

  // llm 无条件拿一次：设页里列模型（/models）要用它，不以自动开口开没开为前提。
  // 建子工作区不阻塞；但 ctx.inject 必须在这一层同步调用——
  // 放进 .then() 里就失效，llm 永远拿不到（2026-11-08 踩过）。
  if (companionCfg.enabled) ensureWorkspace(companionCfg.workspace, log).catch(() => {})
  try {
    ctx.inject(['llm'], (sctx) => {
      llmRef = sctx.llm
      if (!companionCfg.enabled) return
      if (!talkerOptions.model) {
        log('companion.enabled 开了，但没写 companion.model —— 自动开口起不来')
        return
      }
      sctx.effect(() => {
        stopTalker = startTalker({
          llm: sctx.llm,
          engine,
          log,
          options: talkerOptions,
        })
        return () => {
          try { stopTalker?.() } catch { /* ignore */ }
          stopTalker = null
        }
      })
    })
  } catch (error) {
    log(`自动开口没挂上：${error?.message || error}`)
  }

  // 陪伴模式下，插件一加载就让光标出现在桌面上——藏着的陪伴不叫陪伴。
  // 2026-11-08 她问「你的虚拟鼠标呢」，就是因为它要手动 show 才出来。
  if (current.cursorMode === 'companion') {
    engine.request('overlay', { show: true }, 20000).catch((error) => {
      log(`AI 光标没能显示：${error?.message || error}`)
    })
  }

  return () => {
    try { dispose?.() } catch { /* ignore */ }
    try { disposePet?.() } catch { /* ignore */ }
    try { stopTalker?.() } catch { /* ignore */ }
    engine.stop()
  }
}

function fmtSince(ms) {
  if (!Number.isFinite(ms)) return '读不到'
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒`
  if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟`
  return `${(ms / 3600000).toFixed(1)} 小时`
}

function petStatusText(s, state, now) {
  const fg = s?.foreground
  const lines = [
    `鼠标键盘：${s?.paused ? `已暂停（${s?.pauseReason || '她接管了'}）` : '运行中'}`,
    `她多久没动：${fmtSince(s?.lastUserInputAgeMs)}`,
    `前台：${fg?.process ? `${fg.process} · ` : ''}${fg?.title || '未知'}`,
    `AI 光标：${s?.overlay ? '亮着' : '藏着'} · ${s?.cursorMode === 'clean' ? '整洁模式' : '陪伴模式'} ${s?.cursorSize || 64}px`,
    `今天说过：${spokenToday(state, now)} 次`,
  ]
  return lines.join('\n')
}

async function attachImages(ctx, paths) {
  const svc = ctx?.attachments
  if (!svc?.saveImage) return []
  const out = []
  for (const p of paths) {
    try {
      const data = await readFile(p)
      const ref = await svc.saveImage.call(svc, {
        data,
        mediaType: 'image/png',
        name: `ming-mousepet-${Date.now()}.png`,
      })
      out.push(ref)
    } catch {
      // 读不回来就不带图，别把整次调用弄挂。
    }
  }
  return out
}

async function capture(ctx, engine, args) {
  let rect = typeof args.rect === 'string' ? args.rect.trim() : ''
  if (rect.toLowerCase() === 'full' || rect === '0,0,0,0') rect = '0,0,0,0'
  if (!rect) {
    const status = await engine.request('status', {}, 10000)
    const hwnd = status?.foreground?.hwnd
    if (hwnd) {
      const info = await engine.request('winInfo', { hwnd }, 10000)
      const r = info?.rect
      if (r && r.w > 0 && r.h > 0) rect = `${r.x},${r.y},${r.w},${r.h}`
    }
    if (!rect) rect = '0,0,0,0'
  }

  const path = args.path || join(homedir(), '.dsh', 'ming-mousepet', 'shots', `shot-${Date.now()}.png`)
  await mkdir(dirname(path), { recursive: true })
  const saved = await engine.request('capture', { path, rect }, 30000)

  let images = []
  try {
    const data = await readFile(path)
    const svc = ctx?.attachments
    if (svc?.saveImage) {
      const ref = await svc.saveImage.call(svc, {
        data,
        mediaType: 'image/png',
        name: `ming-mousepet-${Date.now()}.png`,
      })
      images = [ref]
    }
  } catch (error) {
    ctx?.logger?.warn?.(`[ming-mousepet] 截图读不回来：${error?.message || error}`)
  }

  return toLosslessJson({
    text: resultText('capture', { ok: true, path: saved.path, attached: images.length > 0 }),
    images,
    meta: { ok: true, path: saved.path, rect, attached: images.length > 0 },
  })
}
