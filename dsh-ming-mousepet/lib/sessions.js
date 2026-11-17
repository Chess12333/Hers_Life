/**
 * 会话桥（2026-11-09）：把「卡片里问的一句」丢进真正的 DSH 会话去办。
 *
 * 为什么不默认走这条：卡片自己就有嘴（llm.stream），一句闲聊没必要开一个会话。
 * 这条留给她要「真去动手」的时候——读文件、跑命令、查东西，那些得在会话里做。
 *
 * 用的是宿主给的 sessionController（可选的），三条：
 *   list   —— 看得见哪些会话（不激活 Agent）
 *   prompt —— 往某个会话投一句（会 resume 它）
 *   follow —— 跟着那个会话的日志，把这一轮的文字和工具动作接出来
 */

const shortId = (id) => String(id || '').replace(/^session-/, '')

/** 把宿主那堆会话行压成能显示的一行行。 */
export function summarizeSessions(value) {
  const items = Array.isArray(value?.items) ? value.items : []
  return items
    .filter((s) => s && s.origin !== 'subagent')
    .map((s) => ({
      id: String(s.sessionId || ''),
      short: shortId(s.sessionId),
      title: String(s.projections?.values?.title || '').slice(0, 60),
      running: Boolean(s.running),
      blank: Boolean(s.blank),
      updatedAt: Number(s.updatedAt) || 0,
      cwd: String(s.cwd || ''),
    }))
}

export async function listSessions(controller, { signal } = {}) {
  if (!controller) return { ok: false, why: '宿主没给 sessionController' }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const value = await controller.list({}, signal || ac.signal)
    const items = summarizeSessions(value).sort((a, b) => b.updatedAt - a.updatedAt)
    return { ok: true, items }
  } catch (error) {
    return { ok: false, why: error?.message || String(error) }
  } finally {
    clearTimeout(timer)
  }
}

export async function createSession(controller, { cwd, agentPreset } = {}) {
  if (!controller) return { ok: false, why: '宿主没给 sessionController' }
  try {
    const request = {}
    if (cwd) request.cwd = cwd
    if (agentPreset) request.agentPreset = agentPreset
    const value = await controller.create(request)
    return { ok: true, id: String(value?.sessionId || ''), agentPreset: value?.agentPreset || '' }
  } catch (error) {
    return { ok: false, why: error?.message || String(error) }
  }
}

const textOfMessage = (message) => {
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

/**
 * 往一个会话投一句，跟着它把这一轮跑完。
 *
 * onDelta(text)   这一轮里模型吐出来的字
 * onActivity(txt) 它动了什么工具（「在跑命令」「在查资料」这类）
 *
 * 返回 { ok, sessionId, text, tools, why }
 */
export async function askInSession(controller, { sessionId, text, onDelta, onActivity, signal, timeoutMs = 180000 } = {}) {
  if (!controller) return { ok: false, why: '宿主没给 sessionController' }
  const id = String(sessionId || '')
  const body = String(text || '').trim()
  if (!id) return { ok: false, why: '没指定会话' }
  if (!body) return { ok: false, why: '没有要说的话' }

  if (signal?.aborted) return { ok: false, sessionId: id, text: '', tools: 0, why: '会话请求已取消' }
  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, Math.max(20000, timeoutMs))
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const cancelledWhy = () => timedOut ? '等待会话回复超时' : '会话请求已取消'

  let out = ''
  let tools = 0
  let ended = false
  let endReason = ''
  const requestId = `ming-card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let matchedTurn = null
  try {
    // prompt's signal cancels admission only; it does not cancel an admitted turn.
    if (ac.signal.aborted) throw new Error(cancelledWhy())
    await controller.prompt({
      sessionId: id,
      requestId,
      mode: 'queue',
      content: [{ type: 'text', text: body }],
    }, ac.signal)
    if (ac.signal.aborted) throw new Error(cancelledWhy())

    // Durable user/message source.rpcId is the only request correlation key.
    // A snapshot may already contain the entire reply; replay it, never baseline-skip it.
    let currentTurn = null
    // 2026-11-09 17:1x：不再数条数。宿主的 user/message 可能同一句投两遍（append + replace），
    // 数条数会把「自己的请求重复出现」误判成「合并了别人的请求」——宿主上就是这么炸的。
    // 判据改成「这一轮里有没有出现不是我这个 rpcId 的用户消息」。
    const foreignTurns = new Set()
    const accept = ev => {
      if (!ev || ac.signal.aborted) return
      if (ev.type === 'turn/start') {
        currentTurn = Number.isSafeInteger(ev.data?.turn) ? ev.data.turn : null
      } else if (ev.type === 'user/message') {
        const src0 = ev.data?.source
        const ours = src0?.kind === 'user' && src0.rpcId === requestId
        if (ours) {
          if (currentTurn === null) throw new Error('无法唯一关联本次会话请求')
          if (matchedTurn === null) matchedTurn = currentTurn
          else if (matchedTurn !== currentTurn) throw new Error('无法唯一关联本次会话请求')
        } else if (currentTurn !== null) {
          // 同一轮里别人也投了一句：先记下这一轮，回放完了再判
          foreignTurns.add(currentTurn)
        }
      } else if (matchedTurn !== null && ev.data?.turn === matchedTurn) {
        if (ev.type === 'assistant/message') {
          const t = textOfMessage(ev.data?.message)
          out += t
          // 2026-11-09 17:1x：不在这里就把字交出去。这一轮后来被发现混进了别人的请求，
          // 已经显示出去的字收不回来——卡片那条按设计也只追加「已确认的完整回答」。

        } else if (ev.type === 'tool/call') {
          tools++
          try { onActivity?.(ev.data?.name ? `在动 ${ev.data.name}` : '在动手') } catch { /* ignore */ }
        } else if (ev.type === 'turn/end') {
          ended = true
          endReason = ev.data?.reason?.kind || ''
        }
      }
      if (ev.type === 'turn/end' && ev.data?.turn === currentTurn) currentTurn = null
    }
    const stream = controller.follow({ address: { kind: 'session', sessionId: id }, assistantStream: true }, ac.signal)

    for await (const frame of stream) {
      if (ac.signal.aborted) break
      if (!frame || typeof frame !== 'object') continue

      if (frame.type === 'snapshot') {
        for (const rec of frame.records || []) {
          accept(rec?.event)
          if (ended) break
        }
      } else if (frame.type === 'event') accept(frame.event)
      // Token chunks have no request identity and may be abandoned. Use commits only.
      if (ended) break
    }

    if (ac.signal.aborted) throw new Error(cancelledWhy())
    if (matchedTurn === null) throw new Error('无法关联本次会话请求')
    // 一旦这一轮混进了别人的请求，已经攒下的字也不能当作本次的回复——先清空再报错。
    if (foreignTurns.has(matchedTurn)) {
      out = ''
      throw new Error('本轮合并了其他请求，无法安全关联回复')
    }
    if (!ended) throw new Error('会话流已结束，但未收到本轮结束事件')
    // Older producers omit reason; explicit non-completed reasons are failures.
    if (endReason && endReason !== 'completed') throw new Error(`会话未完成：${endReason}`)
    if (out) {
      try { onDelta?.(out) } catch { /* UI errors do not stop the observer. */ }
    }
    return { ok: true, sessionId: id, text: out, tools, why: '' }
  } catch (error) {
    return { ok: false, sessionId: id, text: out, tools, why: ac.signal.aborted ? cancelledWhy() : error?.message || String(error) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** 「丢进 <抓取内容> 块」——和我们抓到的字一起交给会话，不给它读全文的机会。 */
export function wrapCapture(text, { question, url, title } = {}) {
  const body = String(text || '').trim()
  const head = []
  if (title) head.push(`页面：《${title}》`)
  if (url) head.push(`网址：${url}`)
  const parts = []
  if (head.length) parts.push(head.join('\n'))
  parts.push(`<抓取内容>\n${body}\n</抓取内容>`)
  if (question) parts.push(`用户的问题：${String(question).trim()}`)
  return parts.join('\n\n')
}
