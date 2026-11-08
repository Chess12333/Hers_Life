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
import { judgeNudge, loadPetState, markSpoken, updatePetState, schedGapMs } from './pet.js'

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
  // Panel schedule is authoritative; legacy tickMs must not override it.
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
  let generation = 0
  let quietCount = 0
  let midTimer = null
  let lastScreenText = ''

  // 「读卡 → 让模型说一句 → 把气泡摆到她看得见的地方」。
  // 自动心跳和「她点了一下」共用这一段；区别只在前面那几行事实、以及说完记不记账。
  async function compose(rows, status, opts = {}) {
    let card = ''
    try {
      card = await readFile(cardPath, 'utf8')
    } catch {
      card = DEFAULT_CARD
    }

    const facts = rows.filter(Boolean).join('\n')

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
    // 2026-11-08 21:2x：她点出来的那一次，位置就用她点的地方——她已经指给我看了，
    // 不用再去猜前台窗口。也让「点了就有动静」这一步不必等定位。
    if (opts.anchor && Number.isFinite(opts.anchor.x) && Number.isFinite(opts.anchor.y)) {
      px = Math.round(opts.anchor.x)
      py = Math.round(opts.anchor.y)
    }
    try {
      const hwnd = status?.foreground?.hwnd
      if (px === null && hwnd) {
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
        const cur = scr?.cursor
        if (cur && Number.isFinite(cur.x) && Number.isFinite(cur.y)) {
          // 2026-11-08 她改的：闲置时自己开口，桌宠落在**她手上那只鼠标**的右下方。
          // 偏移是 74/44（她调的：原来 24/24，再往右 50、往下 20）。
          // 坐标全是物理像素——status.cursor 和 sidecar 画气泡用的是同一套，
          // 别在这边再乘缩放比，也别拿逻辑宽度判越界。
          px = Math.round(cur.x) + 74
          py = Math.round(cur.y) + 44
        } else {
          const w = scr?.screen?.w || 1920
          const h = scr?.screen?.h || 1080
          const ox = scr?.screen?.x || 0
          const oy = scr?.screen?.y || 0
          px = ox + Math.round(w * 0.5)
          py = oy + Math.round(h * 0.5)
        }
      } catch {
        px = null
      }
    }
    if (px !== null) {
      sayArgs.x = px
      sayArgs.y = py
      // 2026-11-08 她要的节奏：缓动过去 → 停一下 → 换成「要点」的手形 → 再停一下 → 才开口。
      // 她点出来的那一次（opts.alreadyMoved）在 poke 里已经先动过了，这里不再重来一遍 1.75 秒。
      if (!opts.alreadyMoved) {
        await engine.request('glide', { x: px, y: py, ms: 750 }, 6000).catch(() => {})
        await new Promise((r) => setTimeout(r, 780))
        try { await engine.request('setCursorStyle', { style: 'link' }, 4000) } catch { /* 换样式失败不影响说话 */ }
        await new Promise((r) => setTimeout(r, 220))
      }
    }

    if (stopped || (opts.valid && !opts.valid())) return { spoken: false, why: '调度已更新' }
    const said = await engine.request('say', sayArgs, 15000)
    if (px !== null) {
      try { await engine.request('setCursorStyle', { style: 'pointer' }, 4000) } catch { /* ignore */ }
    }
    if (!said?.ok) return { spoken: false, why: `气泡没弹出来：${said?.error || '未知'}` }
    return { spoken: true, line }
  }

  async function once(epoch = generation) {
    const valid = () => !stopped && epoch === generation
    const now = new Date()
    const status = await engine.request('status', {}, 10000)
    const state = await loadPetState()
    if (!valid() || (state.gapMode || state.schedMode) === 'off') return { spoken: false, why: '自动开口已关闭或更新', quiet: true }
    const verdict = judgeNudge({ now, status, state })
    if (!verdict.speak) return { spoken: false, why: verdict.why, quiet: true }

    if (!llm || typeof llm.stream !== 'function') {
      return { spoken: false, why: '宿主没给模型服务' }
    }

    const c = verdict.context || {}
    const rows = [
      clockLine(now),
      c.foreground ? `她屏幕上开着：${c.foreground}` : '',
      Number.isFinite(c.idleMin) ? `她最近 ${c.idleMin} 分钟没动鼠标` : '',
      `今天已经主动说过 ${c.spokenToday ?? 0} 次`,
    ]

    // 静默读一眼屏幕：这一屏上的字决定你这次说不说、说什么。
    const screen = await readScreen(options.screenScript)
    if (screen && screen.text) {
      rows.push('她屏幕上这些字（从上往下）：')
      rows.push(String(screen.text).slice(0, 700))
    }

    if (!valid()) return { spoken: false, why: '调度已更新' }
    const r = await compose(rows, status, { valid })
    // 只有「它自己主动开口」才记账——她点出来的那一次不算。
    if (r.spoken) await updatePetState(st => markSpoken(st, new Date()))
    return r
  }

  // 2026-11-08 21:1x 她：「点按桌宠直接进行一次不记次数的活动」。
  // 她伸手点一下，就得有反应：不判 nudge（那是「该不该主动开口」）、不看宵禁、
  // 不写 spokenToday、也不动 nextAt —— 点它一下不该打乱它自己的节奏。
  async function poke(evt) {
    if (stopped || running) return { spoken: false, why: '上一轮还没说完或已停止' }
    if (!llm || typeof llm.stream !== 'function') return { spoken: false, why: '宿主没给模型服务' }
    running = true
    try {
    const t0 = Date.now()
    const now = new Date()
    // 2026-11-08 21:2x 她：「单击以后隔这么久才动」。
    // 原来点完要先走 750ms 缓动 + 780ms 停顿 + 220ms 换手形，再等模型一两秒才出声，
    // 点了跟没点一样。现在点下去先动：手形立刻换成「要点」，同时挪一小步到她点的地方；
    // 话等模型回来再说，位置就用她点的那个点（她已经指给我看了，不用再猜前台窗口）。
    // Keep the whole sprite above-left of the tap, not merely its window origin.
    // Retain signed desktop coordinates for monitors left/above the primary.
    const tapOffset = (Number.isFinite(engine.cursorSize) ? engine.cursorSize : 64) + 8
    const anchor = evt && Number.isFinite(evt.x) && Number.isFinite(evt.y)
      ? { x: Math.round(evt.x) - tapOffset, y: Math.round(evt.y) - tapOffset }
      : null
    const react = (async () => {
      try { await engine.request('setCursorStyle', { style: 'link' }, 3000) } catch { /* 换样式失败不拦说话 */ }
      if (anchor) {
        try { await engine.request('glide', { x: anchor.x, y: anchor.y, ms: 150 }, 3000) } catch { /* 挪不过去也照说 */ }
      }
    })()

    // 窗口标题只是让这句话贴题，不值得为它多等。0.8 秒拿不到就不带了。
    let status = null
    try {
      status = await Promise.race([
        engine.request('status', {}, 4000),
        new Promise((r) => setTimeout(() => r(null), 800)),
      ])
    } catch { status = null }
    const rows = [
      clockLine(now),
      status?.foreground?.title ? `她屏幕上开着：${status.foreground.title}` : '',
      '她刚在桌面上点了你一下——不是到点，是她自己伸手。回一句。',
    ]
    let r
    try {
      r = await compose(rows, status, { anchor, alreadyMoved: true })
    } catch (error) {
      r = { spoken: false, why: error?.message || String(error) }
    }
    await react.catch(() => {})
    const took = Date.now() - t0
    say(r.spoken ? `被点了一下：${r.line}（${took}ms）` : `被点了一下，没说出来 — ${r.why}（${took}ms）`)
    return r
    } finally { running = false }
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
  const clearTimers = () => {
    if (timer) clearTimeout(timer)
    if (midTimer) clearTimeout(midTimer)
    timer = midTimer = null
  }
  const scheduleNext = async (epoch = ++generation) => {
    if (stopped || epoch !== generation) return 0
    clearTimers()
    const valid = () => !stopped && epoch === generation
    try {
      const state = await loadPetState()
      if (!valid()) return 0
      const gap = schedGapMs(state)
      const deadline = gap > 0 ? Date.now() + gap : 0
      await updatePetState(st => valid() ? { ...st, nextAt: deadline } : st)
      if (!valid() || !gap) return 0
      timer = setTimeout(() => {
        if (!valid()) return
        // Re-arm after completion without reviving a replaced schedule.
        tick().finally(() => {
          if (valid()) scheduleNext(epoch).catch(() => {})
        }).catch(error => say('自动开口失败：' + error.message))
      }, Math.max(0, deadline - Date.now()))
      timer.unref?.()
      return gap
    } catch (error) {
      if (valid()) say('调度失败：' + error.message)
      throw error
    }
  }
  scheduleNext().catch(() => {})
  say('桌面陪伴开了 · 按面板设置计时 · 卡：' + cardPath)
  if (!llm || typeof llm.stream !== 'function') say('没拿到宿主的模型服务，自动开口不会生效')

  const manual = () => tick()
  // 桌宠被轻点：她点一下 = 叫它一次，不记次数（2026-11-08 她要的）。

  const stop = () => {
    stopped = true
    generation += 1
    if (timer) clearTimeout(timer)
    if (midTimer) clearTimeout(midTimer)
  }
  stop.reschedule = scheduleNext
  stop.manual = manual
  stop.poke = poke
  return stop
}
