import { createSession, askInSession, wrapCapture } from './sessions.js'

// Own only the card follow: aborting here does NOT stop an admitted DSH task.
export function createCardSessionBridge({ engine, cardCtl, controller, create = createSession, follow = askInSession }) {
  let active = null
  let disposed = false
  const detach = () => { const old = active; active = null; old?.abort() }
  const reset = () => { detach(); cardCtl.reset() }
  const cancelled = (sessionId) => ({ ok: false, sessionId, why: '已停止跟随；不代表会话任务已停止' })
  const askCard = (question, rows) => { detach(); return disposed ? Promise.resolve(cancelled()) : cardCtl.ask(question, rows) }
  const close = () => { reset(); return engine.request('card', { op: 'close' }, 8000) }
  const ask = async (args) => {
    const question = String(args.text || args.question || '').trim()
    if (!question) return { ok: false, why: '要说点什么' }
    if (disposed) return cancelled()
    reset()
    const owner = new AbortController()
    active = owner
    const owns = () => active === owner && !owner.signal.aborted
    let sid = String(args.sessionId || args.session || '').trim()
    const send = (args, ms) => owns() ? engine.request('card', args, ms).catch(() => null) : Promise.resolve(null)
    try {
      const svc = controller()
      if (!sid || sid === 'new') {
        const result = await create(svc, { cwd: args.cwd ? String(args.cwd) : undefined })
        if (!owns()) return cancelled(result.id)
        if (!result.ok) return { ...result, why: `开会话失败：${result.why}` }
        sid = result.id
      }
      const text = args.capture ? wrapCapture(String(args.capture), { question, url: args.url, title: args.title }) : question
      await send({ op: 'open', title: '溟 · 会话' }, 8000)
      if (!owns()) return cancelled(sid)
      await send({ op: 'append', text: `\n→ 会话 ${String(sid).replace(/^session-/, '')}\n` }, 5000)
      if (!owns()) return cancelled(sid)
      let noted = false
      const result = await follow(svc, {
        sessionId: sid, text, signal: owner.signal,
        onDelta: (text) => { void send({ op: 'append', text }, 4000) },
        onActivity: (activity) => {
          if (!owns() || noted) return
          noted = true
          void send({ op: 'append', text: `（${activity}…）` }, 4000)
        },
      })
      return owns() ? result : cancelled(sid)
    } catch (error) {
      return owns() ? { ok: false, sessionId: sid, why: error?.message || String(error) } : cancelled(sid)
    } finally {
      if (owns()) { void send({ op: 'busy', on: false }, 3000); detach() }
      else owner.abort()
    }
  }
  return { ask, askCard, reset, close, dispose: () => { disposed = true; reset() } }
}
