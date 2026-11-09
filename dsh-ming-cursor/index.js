/**
 * dsh-ming-cursor —— 轻量版：桌面上的一只 AI 光标，会说一句话
 *
 * 和 dsh-ming-mousepet 的分工：那个是整套「眼睛 + 手」（截屏、连拍、UIA 点击、拖拽、卡片）；
 * 这个只有两件东西——把光标画到屏幕上、在桌面上说一句。
 *
 * 两个工具：
 *   cursor       显示 / 移动 / 隐藏 / 换样式 / 换大小 / 换模式 / 看状态
 *   cursor_say   说一句话（气泡浮在她光标上方，不抢焦点）
 *
 * 设置页：装了 dsh-ming-graph 就挂进「她的一生」顶栏；没装就自己开一个设置页。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CursorEngine } from './lib/engine.js'

export const name = 'ming-cursor'
export const inject = ['tools', 'webServer']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const HOME_DIR = join(homedir(), '.dsh', 'ming-cursor')
const SETTINGS_FILE = join(HOME_DIR, 'settings.json')
const API_PREFIX = '/dsh-ming-cursor/api'
const ASSET_PREFIX = '/dsh-ming-cursor/assets'

export const STYLE_IDS = [
  'pointer', 'work', 'unavailiable', 'link', 'text',
  'cross', 'busy', 'move', 'vert', 'horz',
  'help', 'handwriting', 'dgn1', 'dgn2', 'alternate',
]

const DEFAULTS = {
  mode: 'companion',   // companion = 一直陪着 / clean = 用一下就收
  holdMs: 2600,
  size: 64,
  style: 'pointer',
}

function normalize(input = {}) {
  const out = { ...DEFAULTS }
  const mode = String(input.mode || '').toLowerCase()
  if (mode === 'clean' || mode === 'companion') out.mode = mode
  const hold = Number(input.holdMs)
  if (Number.isFinite(hold)) out.holdMs = Math.max(400, Math.min(60000, Math.round(hold)))
  const size = Number(input.size)
  if (Number.isFinite(size)) out.size = Math.max(24, Math.min(192, Math.round(size)))
  const style = String(input.style || '').toLowerCase()
  if (STYLE_IDS.includes(style)) out.style = style
  return out
}

// 装了完整版（dsh-ming-mousepet）时，这个插件不该再画光标——两个光标会打架。
// 判据：profile 的 bundles 里有没有它（＝装了且启用），不是「目录在不在」。
async function hasFullMousepet() {
  try {
    const p = join(process.env.USERPROFILE || homedir(), '.dsh', 'profiles', 'web', 'package.json')
    const j = JSON.parse(await readFile(p, 'utf8'))
    return (j?.dsh?.profile?.bundles || []).includes('dsh-ming-mousepet')
  } catch { return false }
}

async function loadSettings(log = () => {}) {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    return normalize(JSON.parse(raw))
  } catch (error) {
    if (error?.code !== 'ENOENT') log('设置读不到，用默认：' + (error?.message || error))
    return { ...DEFAULTS }
  }
}

async function saveSettings(next, log = () => {}) {
  try {
    await mkdir(HOME_DIR, { recursive: true })
    await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    log('设置存不下：' + (error?.message || error))
  }
}

async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (mod?.defineTool) return mod.defineTool
  } catch { /* 单元测试里没有宿主 */ }
  return (definition) => definition
}

const STYLE_LABEL = {
  pointer: '指针', work: '工作', unavailiable: '禁止', link: '链接', text: '文本',
  cross: '十字', busy: '忙碌', move: '移动', vert: '上下', horz: '左右',
  help: '帮助', handwriting: '手写', dgn1: '斜向1', dgn2: '斜向2', alternate: '备用',
}

function describeState(s = {}) {
  if (!s || s.visible === undefined) return '光标还没起来（sidecar 没连上）'
  const where = s.visible ? `在 (${s.x}, ${s.y})` : '收着'
  const size = Number(s.size) || 64
  const style = s.style || 'pointer'
  const mode = s.mode === 'clean' ? '整洁模式（露一下就自己收）' : '陪伴'
  return `光标${where} · ${mode} · ${size}px · ${STYLE_LABEL[style] || style}`
}

export async function apply(ctx, rawConfig = {}) {
  const defineTool = await loadDefineTool()
  const log = (m) => { try { ctx?.logger?.info?.('[ming-cursor] ' + m) } catch { } }

  let current = normalize({ ...rawConfig, ...(await loadSettings(log)) })
  // 完整版在不在：在就提醒卸载这个，两个光标别一起画（2026-11-10 她说的）
  const conflict = await hasFullMousepet()
  const engine = new CursorEngine({ log })

  // 起来时把档位推给 sidecar（它自己有环境变量兜底）
  const pushConfig = async () => {
    try {
      await engine.size(current.size)
      await engine.style(current.style)
      await engine.mode(current.mode, current.holdMs)
    } catch (error) {
      log('档位没推过去：' + (error?.message || error))
    }
  }

  // DSH 的工具必须声明 output（2026-11-10 踩的：不写就 TypeError，整个插件被判 failed，
  // 表现是「工具没出现、路由 404」，而日志只有一行，不在界面上）。
  const cursorOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        meta: { type: 'object', additionalProperties: true },
      },
    },
    render(_args, value) {
      return [{ type: 'text', text: String((value && value.text) || '') }]
    },
  }

  const cursorTool = {
    name: 'cursor',
    output: cursorOutput,
    description:
      '桌面上的 AI 光标：把它画到屏幕上、滑过去、收起来、换样子。**它只看不见也不动手**——不截屏、不点、不拖、不读 UIA。\n'
      + '要真的操作电脑，用 dsh-ming-mousepet 的 pet_input。\n'
      + '坐标是屏幕绝对像素（左上角）。\n\n'
      + 'actions:\n'
      + '- status：现在在哪、多大、什么模式\n'
      + '- show：显示并放到 x,y\n'
      + '- move：滑到 x,y（ms 控制滑行时长，默认 0 = 直接跳过去）\n'
      + '- hide：收起来\n'
      + '- style：换外观（' + STYLE_IDS.join(' / ') + '）\n'
      + '- size：24–192 像素\n'
      + '- mode：companion（一直陪着）/ clean（露一下就收，holdMs 毫秒）\n',
    parameters: {
      action: { type: 'string', required: true, description: 'status | show | move | hide | style | size | mode' },
      x: { type: 'number', description: '屏幕绝对 x' },
      y: { type: 'number', description: '屏幕绝对 y' },
      ms: { type: 'number', description: 'move 时滑行多少毫秒，0 = 直接跳' },
      name: { type: 'string', description: 'style 时的样式名' },
      px: { type: 'number', description: 'size 时的像素（24–192）' },
      mode: { type: 'string', description: 'mode 时：companion | clean' },
      holdMs: { type: 'number', description: 'clean 模式下露多久再收' },
    },
    async execute(args = {}) {
      // 完整版在跑就不动手：一个屏幕只该有一只光标（2026-11-10）
      if (conflict) return { text: '完整版（dsh-ming-mousepet）在场，这个插件不启动。请用它，或者把那边停掉再用这个。', meta: { ok: false, conflict: true } }
      const action = String(args.action || 'status').toLowerCase()
      try {
        if (action === 'show' || action === 'move') {
          const r = args.action === 'show'
            ? await engine.show(args.x ?? 0, args.y ?? 0)
            : await engine.move(args.x ?? 0, args.y ?? 0, Number(args.ms) || 0)
          return { text: describeState(r.state), meta: { ok: true, ...r.state } }
        }
        if (action === 'hide') { await engine.hide(); return { text: '收起来了。', meta: { ok: true } } }
        if (action === 'style') {
          const want = String(args.name || '').toLowerCase()
          if (!STYLE_IDS.includes(want)) return { text: `没有这个样式。可选：${STYLE_IDS.join(' / ')}`, meta: { ok: false } }
          const r = await engine.style(want)
          current = { ...current, style: want }
          await saveSettings(current, log)
          return { text: `换成 ${STYLE_LABEL[want] || want}。`, meta: { ok: true, style: r.style } }
        }
        if (action === 'size') {
          const r = await engine.size(Number(args.px) || current.size)
          current = { ...current, size: r.size }
          await saveSettings(current, log)
          return { text: `光标 ${r.size}px。`, meta: { ok: true, size: r.size } }
        }
        if (action === 'mode') {
          const want = String(args.mode || '').toLowerCase() === 'clean' ? 'clean' : 'companion'
          const holdMs = Number(args.holdMs) || current.holdMs
          const r = await engine.mode(want, holdMs)
          current = { ...current, mode: want, holdMs: r.holdMs }
          await saveSettings(current, log)
          return {
            text: want === 'clean' ? `整洁模式：露一下，约 ${Math.round(r.holdMs / 100) / 10} 秒后自己收。` : '陪伴模式：一直显示。',
            meta: { ok: true, mode: want, holdMs: r.holdMs },
          }
        }
        if (action === 'status') {
          const r = await engine.status()
          return { text: describeState(r.state), meta: { ok: true, ...r.state } }
        }
        return { text: `不认识的 action：${action}。可用：status / show / move / hide / style / size / mode。`, meta: { ok: false } }
      } catch (error) {
        return { text: '光标没动成：' + (error?.message || error), meta: { ok: false } }
      }
    },
  }

  const sayTool = {
    name: 'cursor_say',
    output: cursorOutput,
    description:
      '在桌面上说一句话：一个无边框气泡浮在她光标上方，几秒自己消失，**不抢焦点、不打断她**。\n'
      + '一句话就够，别塞一段。要发到 QQ 用 qq_send，要念出来用 voice_say。',
    parameters: {
      text: { type: 'string', required: true, description: '要说的话，一句' },
      x: { type: 'number', description: '气泡锚点的屏幕 x（不给就用她当前光标）' },
      y: { type: 'number', description: '气泡锚点的屏幕 y' },
      ms: { type: 'number', description: '停留多久，默认 3200ms' },
    },
    async execute(args = {}) {
      // 说一句话也算是它在屏幕上露脸：完整版在场就闭嘴（2026-11-10）
      if (conflict) return { text: '完整版（dsh-ming-mousepet）在场，这个插件不启动。', meta: { ok: false, conflict: true } }
      const text = String(args.text || '').trim()
      if (!text) return { text: '没有要说的话。', meta: { ok: false } }
      try {
        const r = await engine.say(text, { x: args.x, y: args.y, ms: Number(args.ms) || 3200 })
        return { text: `说了：「${text}」（${r.at || '位置没报上来'}）`, meta: { ok: true, at: r.at } }
      } catch (error) {
        return { text: '没说出来：' + (error?.message || error), meta: { ok: false } }
      }
    },
  }

  ctx.tools.register(defineTool(cursorTool))
  ctx.tools.register(defineTool(sayTool))

  // ---------------------------------------------------------------- 设置口（给 client 半边）
  const apiHandler = async (req, res, url) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    // 签名是 (req, res, next)——第三个不是 url。路径要从 req.url 重新解析，
    // 照 dsh-ming-mousepet 的写法来。2026-11-10 踩的：把第三参当 url 读，每条路由都落成 '/'。
    const urlObj = new URL(String((req && req.url) || '/'), 'http://127.0.0.1')
    const route = String(urlObj.pathname || '').replace(API_PREFIX, '') || '/'
    try {
      if (route === '/settings' && (req.method === 'GET' || !req.method)) {
        return send(200, { ok: true, settings: current, styles: STYLE_IDS, labels: STYLE_LABEL, conflict })
      }
      if (route === '/settings' && req.method === 'POST') {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        current = normalize({ ...current, ...body })
        await saveSettings(current, log)
        await pushConfig()
        return send(200, { ok: true, settings: current })
      }
      if (route === '/status') {
        const r = await engine.status().catch((e) => ({ state: { error: String(e?.message || e) } }))
        return send(200, { ok: true, settings: current, state: r.state })
      }
      // 「在屏幕上试一下」：按当前档位画出来，回话里带上它真实的位置和大小。
      if (route === '/demo' && req.method === 'POST') {
        try {
          await engine.size(current.size)
          await engine.style(current.style)
          await engine.mode(current.mode, current.holdMs)
          await engine.move(900, 480, 0)
          const r = await engine.status()
          return send(200, { ok: true, state: r.state })
        } catch (e) {
          return send(200, { ok: false, error: String(e?.message || e) })
        }
      }
      if (route === '/preview') {
        // 设置页要的那 15 张小图，直接用插件目录里的
        return send(200, { ok: true, dir: ASSET_PREFIX + '/cursors' })
      }
      return send(404, { ok: false, error: 'no route: ' + route })
    } catch (error) {
      return send(500, { ok: false, error: String(error?.message || error) })
    }
  }

  const assetHandler = async (req, res, url) => {
    const rawPath = decodeURIComponent(new URL(String((req && req.url) || '/'), 'http://127.0.0.1').pathname)
    const rel = rawPath.replace(ASSET_PREFIX, '').replace(/^\/+/, '')
    const full = join(PLUGIN_DIR, 'assets', rel)
    if (!full.startsWith(join(PLUGIN_DIR, 'assets')) || !existsSync(full)) {
      res.writeHead(404); res.end('not found'); return
    }
    try {
      const buf = await readFile(full)
      const type = full.endsWith('.png') ? 'image/png' : 'application/octet-stream'
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=3600' })
      res.end(buf)
    } catch { res.writeHead(500); res.end('read failed') }
  }

  try {
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: apiHandler }), 'ming-cursor: api')
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSET_PREFIX, handler: assetHandler }), 'ming-cursor: assets')
  } catch (error) {
    log('路由没挂上：' + (error?.message || error))
  }

  // 完整版在场就不启动自己的 sidecar——一个屏幕只该有一只光标（2026-11-10）
  if (!conflict) { try { await pushConfig() } catch { } }
  log('起来了：' + JSON.stringify(current))
}
