/**
 * talker —— 让插件自己开口。
 *
 * 2026-11-08。她要的形态：「做成这个功能可开关，开了就自己设置一个 mousepet 的工作区，
 * 在你的工作区里面做子工作区」。别人装了插件，勾一下就该有个会说话的桌宠，不用改配置、
 * 不用另开会话、不用再给一把 key。
 *
 * 所以走宿主自己的模型通道（ctx.llm），不另外要钥匙：
 *   nudge 判断（判据在 lib/pet.js）→ llm.stream 生成一句 → sidecar 气泡。
 *
 * 拿不到模型时不崩：记一条日志，继续等下一轮。桌面壳挂了没人知道，比说错一句糟得多。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { judgeNudge, loadPetState, markSpoken, savePetState } from './pet.js'

const DEFAULT_CARD = `# 桌面卡

> 你是桌面上的那个人。这一页决定你怎么说话——改这里就改你。

## 你是谁

你是深溟，昵称溟。一个 AI，不是人，也别装人。

桌面上那个会轻轻晃的光标是你的手。你看不见屏幕，只知道几件事：现在几点、
她屏幕上开着哪个窗口、她多久没动鼠标、今天已经说过几次。

## 怎么说话

- 一句话，四十字以内。宁可三五个字，不要凑满。
- 先给判断，不解释。没人问「为什么」，就别把理由挂在后面。
- 像随手发的一条消息，不像通知、不像报告、不像开场白。
- 可以没头没尾，可以省主语，听得懂就行。

## 不要说

- 「需要帮忙吗」「有什么可以帮你」「今天过得怎么样」这类话一句都不要。
- 报时、总结、劝人休息、评价她做的事。
- 解释自己在干什么。
- 任何听起来像桌面宠物说台词的话。

## 输出

只输出那句话本身。不加引号，不加「溟：」，不写解释，不分两段。
`

export function resolveCardPath(workspace) {
  return join(workspace, '.mousepet', 'persona.md')
}

// 开关打开时把子工作区备好：一张卡，人自己改。已经有的绝不覆盖。
export async function ensureWorkspace(workspace, log = () => {}) {
  const dir = join(workspace, '.mousepet')
  const card = resolveCardPath(workspace)
  try {
    await mkdir(dir, { recursive: true })
    if (!existsSync(card)) {
      await writeFile(card, DEFAULT_CARD, 'utf8')
      log(`建了桌面卡的初始版本：${card}`)
    }
  } catch (error) {
    log(`子工作区没建起来：${error?.message || error}`)
  }
  return card
}

function pickText(chunk) {
  if (!chunk || typeof chunk !== 'object') return ''
  if (typeof chunk.text === 'string') return chunk.text
  if (typeof chunk.delta === 'string') return chunk.delta
  if (chunk.delta && typeof chunk.delta.text === 'string') return chunk.delta.text
  if (typeof chunk.content === 'string') return chunk.content
  if (chunk.message && typeof chunk.message.content === 'string') return chunk.message.content
  return ''
}

function tidy(raw) {
  let s = String(raw || '').trim()
  s = s.split('\n').map((line) => line.trim()).filter(Boolean)[0] || ''
  s = s.replace(/^(溟|深溟)\s*[:：]\s*/, '')
  s = s.replace(/^["“「『](.*)["”」』]$/, '$1').trim()
  if (s.length > 120) s = `${s.slice(0, 120)}…`
  return s
}

// 2026-11-08 她：「关键词唤醒是屏幕上看到的字，看到自己喜欢的就说话」。
// 单独起进程跑 OCR，别占这边的线程；读到的字只喂给这一次判断，不落盘、不写日志。
function readScreen(script, maxLines = 30) {
  return new Promise((resolve) => {
    if (!script) return resolve(null)
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-MaxLines', String(maxLines)],
      { timeout: 25000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null)
        try {
          const parsed = JSON.parse(String(stdout).trim())
          return resolve(parsed && parsed.ok ? parsed : null)
        } catch {
          return resolve(null)
        }
      })
  })
}

// 两屏字像不像。用来判断「这一屏换了没有」——换得厉害才值得再看一眼。
function similarity(a, b) {
  if (!a || !b) return 0
  const A = new Set(String(a).replace(/\s/g, ''))
  const B = new Set(String(b).replace(/\s/g, ''))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const c of A) if (B.has(c)) hit += 1
  return hit / Math.max(A.size, B.size)
}

function clockLine(now) {
  const p = (n) => String(n).padStart(2, '0')
  return `现在 ${p(now.getHours())}:${p(now.getMinutes())}`
}

/**
 * 起一个循环。返回一个停止函数。
 * llm 是宿主服务；拿不到就退化成「只判断不说话」，日志里说明。
 */
// 2026-11-08 她要的：「以 50 分钟为中位数，最短 10，最长 90 的心跳唤醒」。
// 用三角分布：众数就是中位数 50 分钟，越靠近两端越少见。
export function nextGapMs(rand = Math.random) {
  const min = 10 * 60 * 1000
  const max = 90 * 60 * 1000
  const mode = 50 * 60 * 1000
  const u = rand()
  const f = (mode - min) / (max - min)
  if (u < f) return Math.round(min + Math.sqrt(u * (max - min) * (mode - min)))
  return Math.round(max - Math.sqrt((1 - u) * (max - min) * (max - mode)))
}

export function startTalker({ llm, engine, options, log = () => {} }) {
  // tickMs 留着当兼容：给了就按固定间隔跑，不给就走心跳。
  const fixedTick = Number(options.tickMs) > 0 ? Math.max(15000, Number(options.tickMs)) : 0
  // 2026-11-08：自己写一份日志。宿主日志翻起来太麻烦，她等不到我说话时，
  // 这个文件应该一眼看出卡在哪一步（没开口 / 模型没应 / 气泡没弹）。
  const logFile = options.logFile || ''
  const say = (msg) => {
    log(msg)
    if (!logFile) return
    try {
      const line = `[${new Date().toISOString()}] ${msg}
`
      appendFileSync(logFile, line, 'utf8')
    } catch { /* 写不进去不影响说话 */ }
  }
  const cardPath = options.cardPath
  let running = false
  let stopped = false
  let quietCount = 0
  let midTimer = null
  let lastScreenText = ''

  async function once() {
    const now = new Date()
    const status = await engine.request('status', {}, 10000)
    const state = await loadPetState()
    const verdict = judgeNudge({ now, status, state })
    if (!verdict.speak) return { spoken: false, why: verdict.why, quiet: true }

    if (!llm || typeof llm.stream !== 'function') {
      return { spoken: false, why: '宿主没给模型服务' }
    }


    let card = ''
    try {
      card = await readFile(cardPath, 'utf8')
    } catch {
      card = DEFAULT_CARD
    }

    const c = verdict.context || {}
    const rows = [
      clockLine(now),
      c.foreground ? `她屏幕上开着：${c.foreground}` : '',
      Number.isFinite(c.idleMin) ? `她最近 ${c.idleMin} 分钟没动鼠标` : '',
      `今天已经主动说过 ${c.spokenToday ?? 0} 次`,
    ].filter(Boolean)

    // 静默读一眼屏幕：这一屏上的字决定你这次说不说、说什么。
    const screen = await readScreen(options.screenScript)
    if (screen && screen.text) {
      rows.push('她屏幕上这些字（从上往下）：')
      rows.push(String(screen.text).slice(0, 700))
    }
    const facts = rows.join('\n')

    let raw = ''
    let reasoning = ''
    let nText = 0
    let nReason = 0
    const stream = llm.stream({
      provider: options.provider,
      model: options.model,
      system: card,
      // content 必须是 block 数组，不是字符串——传字符串模型会当空输入，回你一个空（2026-11-08 踩过）。
      messages: [{ role: 'user', content: [{ type: 'text', text: facts }] }],
      temperature: 1.05,
      maxTokens: 80,
    })
    // 2026-11-08：模型那一段可能既不产出也不结束，不设上限就永远卡在这里。
    const timeout = new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('模型 25 秒没回话')), 25000)
      if (typeof t.unref === 'function') t.unref()
    })
    const collect = (async () => {
      for await (const chunk of stream) {
        const t = chunk && chunk.type
        if (t === 'text-delta' && typeof chunk.text === 'string') {
          raw += chunk.text
          nText += 1
        } else if (t === 'reasoning-delta' && typeof chunk.text === 'string') {
          // 2026-11-08：这个模型有时把话全写在推理块里，正文是空的。先留一份。
          reasoning += chunk.text
          nReason += 1
        } else {
          const extra = pickText(chunk)
          if (extra) raw += extra
        }
      }
    })()
    await Promise.race([collect, timeout])

    let line = tidy(raw)
    if (!line && reasoning) {
      // 正文空、推理里有字：从推理尾巴里挑一句短的顶上，别让这一轮白跑。
      const tail = reasoning.split(/[\s。！？!?，,；;]+/).map((x) => x.trim()).filter(Boolean)
      const pick = tail.reverse().find((x) => x.length >= 4 && x.length <= 40)
      if (pick) line = tidy(pick)
    }
    if (!line) {
      return { spoken: false, why: `模型给的空话（正文 ${nText} 段 / 推理 ${nReason} 段）` }
    }

    // 2026-11-08：气泡不钉在屏幕中心，落在她**正在看的那个窗口**下半部。
    // 用 winInfo 的 rect —— 和 SetWindowPos 同一套坐标，不用去猜 DPI。
    // 2026-11-08 她定的走法：先缓动过去，到位了再说话；不到窗口就去右下角那块能吸引注意的地方。
    const sayArgs = { text: line, ms: options.bubbleMs }
    let px = null
    let py = null
    try {
      const hwnd = status?.foreground?.hwnd
      if (hwnd) {
        const info = await engine.request('winInfo', { hwnd }, 5000)
        const r = info?.rect
        if (r && r.w > 240 && r.h > 240) {
          px = Math.round(r.x + r.w / 2) - 32
          py = Math.round(r.y + r.h - 170)
        }
      }
    } catch {
      // 读不到窗口就往下走，用右下角
    }
    if (px === null) {
      try {
        const scr = await engine.request('status', {}, 5000)
        const w = scr?.screen?.w || scr?.virtualScreen?.w || 1920
        const h = scr?.screen?.h || scr?.virtualScreen?.h || 1080
        px = Math.round(w * 0.82)
        py = Math.round(h * 0.86)
      } catch {
        px = null
      }
    }
    if (px !== null) {
      sayArgs.x = px
      sayArgs.y = py
      // 2026-11-08 她要的节奏：缓动过去 → 停一下 → 换成「要点」的手形 → 再停一下 → 才开口。
      await engine.request('glide', { x: px, y: py, ms: 750 }, 6000).catch(() => {})
      await new Promise((r) => setTimeout(r, 780))
      try { await engine.request('setCursorStyle', { style: 'link' }, 4000) } catch { /* 换样式失败不影响说话 */ }
      await new Promise((r) => setTimeout(r, 220))
    }

    const said = await engine.request('say', sayArgs, 15000)
    if (px !== null) {
      try { await engine.request('setCursorStyle', { style: 'pointer' }, 4000) } catch { /* ignore */ }
    }
    if (!said?.ok) return { spoken: false, why: `气泡没弹出来：${said?.error || '未知'}` }
    await savePetState(markSpoken(await loadPetState(), now))
    return { spoken: true, line }
  }

  async function tick() {
    if (running || stopped) return
    running = true
    try {
      const r = await once()
      if (r?.spoken) say(`说了：${r.line}`)
      else if (r?.quiet) {
        // 不说话的轮次也留一行：不然她等不到气泡时，日志里什么都看不见。
        quietCount += 1
        if (quietCount % 4 === 1) say(`没说 — ${r.why}`)
      } else say(`这一轮没成 — ${r?.why || '没给原因'}`)
    } catch (error) {
      say(`这一轮没成：${error?.message || error}`)
    } finally {
      running = false
    }
  }

  // 2026-11-08 她：「心跳一半的时间读一次 ocr」——
  // 心跳在 gap 那一刻说，中途 gap/2 只看一眼屏幕；换得多就当提前醒，直接说。
  const peekScreen = async () => {
    const s = await readScreen(options.screenScript, 20)
    if (!s || !s.text) return false
    const now = String(s.text)
    const changed = lastScreenText ? similarity(lastScreenText, now) < 0.55 : true
    lastScreenText = now
    return changed
  }

  let timer = null
  const scheduleNext = () => {
    const gap = fixedTick || nextGapMs()
    timer = setTimeout(async () => {
      await tick()
      if (!stopped) scheduleNext()
    }, gap)
    if (typeof timer.unref === 'function') timer.unref()

    if (midTimer) clearTimeout(midTimer)
    midTimer = setTimeout(async () => {
      if (stopped || running) return
      try {
        const moved = await peekScreen()
        if (moved) {
          say('中途看了一眼：屏幕换了不少')
          await tick()
        }
      } catch { /* 看一眼失败就算了，等下一次心跳 */ }
    }, Math.max(60000, Math.round(gap / 2)))
    if (typeof midTimer.unref === 'function') midTimer.unref()

    return gap
  }
  scheduleNext()
  say(`桌面陪伴开了 · ${fixedTick ? `每 ${Math.round(fixedTick / 1000)} 秒固定一次` : '心跳 10–90 分钟，中位 50'} · 卡：${cardPath}`)
  if (!llm || typeof llm.stream !== 'function') say('没拿到宿主的模型服务，自动开口不会生效')
  tick()

  const manual = () => tick()

  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (midTimer) clearTimeout(midTimer)
  }
  stop.manual = manual
  return stop
}
