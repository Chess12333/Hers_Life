/**
 * 卡片（2026-11-09）：一张能追问的小窗，从 talker 里拆出来。
 *
 * 为什么要拆：原来的卡片挂在 startTalker 上，于是「卡片能不能用」被绑成了
 * 「自动开口开没开」。它其实只要一件事——宿主给了模型服务（llm.stream）。
 * 拆开之后：她关了自动开口也能在桌面上问一句；开着的时候行为不变。
 *
 * 依赖都从外面传进来，模块自己不碰 ctx、不读设置：
 *   llm    可以是对象，也可以是返回对象的函数（宿主服务晚一步才拿到）
 *   engine sidecar 通道（开窗、追加、改状态）
 *   cardPath 桌面卡（说话的性格在这一页）
 */
import { readFile } from 'node:fs/promises'
import { streamAnswer } from './answer.js'

const DEFAULT_CARD = `# 桌面卡

> 你是桌面上的那个人。这一页决定你怎么说话——改这里就改你。
`

export function createCard({ llm, engine, cardPath = '', fallbackCard = DEFAULT_CARD, log = () => {}, callModel = () => ({}) } = {}) {
  let history = []
  let busy = false
  let active = null

  const model = () => (typeof llm === 'function' ? llm() : llm)

  const readCard = async () => {
    if (!cardPath) return fallbackCard
    try {
      return await readFile(cardPath, 'utf8')
    } catch {
      return fallbackCard
    }
  }

  const reset = () => {
    const previous = active
    active = null
    busy = false
    history = []
    previous?.abort()
  }

  const isBusy = () => busy

  /** 问一句。答案流进卡片；history 记住上一轮，追问才接得上。 */
  async function ask(question, contextRows = [], { mode = 'full', maxTokens = 900 } = {}) {
    const q = String(question || '').trim()
    if (!q) return { ok: false, why: '没问什么' }
    if (busy) return { ok: false, why: '上一句还没答完' }
    const svc = model()
    if (!svc || typeof svc.stream !== 'function') {
      await engine.request('card', { op: 'append', text: '\n（没有模型服务，答不了）\n' }, 4000).catch(() => {})
      return { ok: false, why: '宿主没给模型服务' }
    }

    busy = true
    const controller = new AbortController()
    active = controller
    const owns = () => active === controller
    const cancelled = () => ({ ok: false, why: '已取消' })
    const t0 = Date.now()
    try {
      await engine.request('card', { op: 'open', title: 'AI' }, 8000).catch(() => null)
      if (!owns()) return cancelled()
      await engine.request('card', { op: 'append', text: '\n' }, 4000).catch(() => null)
      if (!owns()) return cancelled()
      const card = await readCard()
      if (!owns()) return cancelled()
      // 2026-11-09 17:0x：宿主的 GenerateOptions 里 provider / model 必填，
      // 从外面这只钩子拿（settings.json 的 talkProvider / talkModel，留空退回 config）。
      const route = callModel() || {}
      const r = await streamAnswer({
        // Keep the service receiver and forward GenerateOptions.signal.
        llm: { stream: (options) => svc.stream({ ...options, signal: controller.signal }) },
        signal: controller.signal,
        provider: route.provider,
        model: route.model,
        card,
        rows: contextRows,
        question: q,
        history,
        mode,
        maxTokens,
        onDelta: (t) => {
          if (owns() && !controller.signal.aborted) engine.request('card', { op: 'append', text: t }, 4000).catch(() => {})
        },
      })
      // A timed-out collector may still be alive: retire its delta channel now.
      controller.abort()
      if (!owns()) return cancelled()
      const took = Date.now() - t0
      if (r.ok) {
        history.push({ role: 'user', text: q.slice(0, 1200) })
        history.push({ role: 'assistant', text: String(r.text || '').slice(0, 2000) })
        if (history.length > 10) history = history.slice(-10)
        log(`卡片答完：${q.slice(0, 20)}（${took}ms，${r.text.length} 字）`)
      } else {
        await engine.request('card', { op: 'append', text: `\n（没答成：${r.why}）\n` }, 4000).catch(() => {})
        log(`卡片没答成：${r.why}`)
      }
      return r
    } catch (error) {
      if (!owns()) return cancelled()
      log(`卡片出错：${error?.message || error}`)
      return { ok: false, why: error?.message || String(error) }
    } finally {
      if (owns()) {
        active = null
        busy = false
        engine.request('card', { op: 'busy', on: false }, 3000).catch(() => {})
      }
      controller.abort()
    }
  }

  /** 把一段现成的字放进卡片（框选、网页取文都可以走这条，而不是只说一句话）。 */
  async function show(text, title = 'AI') {
    const body = String(text || '').trim()
    if (!body) return { ok: false, why: '没内容' }
    await engine.request('card', { op: 'open', title }, 8000).catch(() => null)
    await engine.request('card', { op: 'append', text: `\n${body}\n` }, 6000).catch(() => null)
    return { ok: true }
  }

  const close = async () => {
    reset()
    await engine.request('card', { op: 'close' }, 5000).catch(() => null)
    return { ok: true }
  }

  return { ask, show, reset, close, isBusy, historyLength: () => history.length }
}
