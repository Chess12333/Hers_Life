/**
 * 一段回答怎么来（2026-11-09）。
 *
 * 两种档：
 *   quick — 只回两三句，不许下载/跑命令/出图，没有联网或执行工具。气泡那一档用它。
 *   full  — 第一句必须是结论，可以说理由；只依据已有材料。卡片那一档用它。
 *
 * 判据写在 prompt 里，不在代码里分支——同一个模型，只换要求，别养两条逻辑。
 * 拿不到 llm.stream 就返回 { ok:false, why }，调用方自己降级，不抛。
 */

export const MODE_QUICK =
  '回答要求：这条只要两三句。当前没有联网或执行工具，只依据给出的材料与已有知识回答；不要声称查过资料、运行过命令或生成了图片。' +
  '直接说结论和最关键的那一句理由，不要交代过程，不要列清单，不要写总结。'

export const MODE_FULL =
  '回答要求：第一句就必须是结论，然后再给理由。当前没有联网或执行工具，只依据给出的材料与已有知识推理；不能声称完成了查证、下载、命令执行或出图。' +
  '不要写目录、不要写「总结：」、不要重复我说过的话。不知道就说不知道，别编。'

export const modeLine = (mode) => (mode === 'full' ? MODE_FULL : MODE_QUICK)

/**
 * 跑一次流式回答。
 * onDelta 每来一段就调一次（已经按 80ms 节流，调用方可以直接往界面上写）。
 * 返回 { ok, text, reasoning, why }。
 */
export async function streamAnswer({
  llm,
  provider,
  model,
  card,
  rows,
  question,
  history,
  mode = 'quick',
  maxTokens = 700,
  temperature = 0.9,
  timeoutMs = 60000,
  onDelta,
  signal,
} = {}) {
  if (!llm || typeof llm.stream !== 'function') return { ok: false, why: '宿主没给模型服务' }
  // 2026-11-09 17:0x：宿主的 GenerateOptions 里 provider / model 是必填，适配器按 provider 选；
  // 传 undefined 进不去，只会拿一个带 error 的 finish 块收尾——那在旧代码里显示成「模型给的空话」。
  // 没型号就别去撞，当场说清楚缺哪一项。
  if (!String(provider || '').trim() || !String(model || '').trim()) {
    return { ok: false, why: '没指定 provider/model：settings.json 的 talkProvider/talkModel，或插件 config 的 companion.provider/model 得填上' }
  }

  const facts = (rows || []).filter(Boolean).join('\n')
  const parts = []
  if (facts) parts.push(facts)
  parts.push(modeLine(mode))
  if (question) parts.push(`她问：${question}`)
  const text = parts.join('\n\n')
  if (!text.trim()) return { ok: false, why: '没有可回答的内容' }

  const messages = []
  for (const h of history || []) {
    if (!h || !h.role || !h.text) continue
    const content = [{ type: 'text', text: h.text }]
    if (h.role === 'assistant') {
      // 2026-11-09 17:1x：宿主的 AssistantMessage 必须带 source（适配器会读 source.replayState）。
      // 缺了它，第一问能答、第二问当场炸：「Cannot read properties of undefined (reading 'replayState')」。
      messages.push({ role: 'assistant', source: { kind: 'model', provider, model }, content })
    } else {
      messages.push({ role: h.role, content })
    }
  }
  messages.push({ role: 'user', content: [{ type: 'text', text }] })

  let full = ''
  let reasoning = ''
  let failure = null
  let pending = ''
  let lastFlush = 0
  const flush = (force) => {
    if (!pending) return
    const now = Date.now()
    if (!force && now - lastFlush < 80) return
    lastFlush = now
    const chunk = pending
    pending = ''
    try {
      onDelta?.(chunk)
    } catch {
      /* 界面那边出错不该把回答带崩 */
    }
  }

  let timer = null
  try {
    const stream = llm.stream({
      provider,
      model,
      system: card || '',
      messages,
      temperature,
      maxTokens,
    })
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`模型 ${Math.round(timeoutMs / 1000)} 秒没回完话`)), timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const collect = (async () => {
      for await (const c of stream) {
        if (signal?.aborted) break
        const t = c && c.type
        if (t === 'text-delta' && typeof c.text === 'string') {
          full += c.text
          pending += c.text
          flush(false)
        } else if (t === 'reasoning-delta' && typeof c.text === 'string') {
          reasoning += c.text
        } else if (t === 'finish') {
          // 2026-11-09 17:0x：适配器/网络/中止的失败是**以 finish 块**回来的，不是抛出来的。
          // 旧代码把它整个忽略，于是任何调用失败都被读成「模型给的空话」。
          const kind = c.reason && c.reason.kind
          if (kind === 'error' || kind === 'aborted') {
            const f = c.reason.failure || {}
            failure = { kind, message: f.message || '', code: f.code || '', status: f.status }
          } else if (kind === 'max-tokens') {
            failure = { kind, message: 'token 用完了，正文还没说完', code: 'MAX_TOKENS' }
          }
        }
      }
    })()
    await Promise.race([collect, timeout])
    flush(true)
  } catch (error) {
    flush(true)
    return { ok: false, text: full, reasoning, why: error?.message || String(error) }
  } finally {
    if (timer) clearTimeout(timer)
  }

  // 有正文就算成。没正文时按这个顺序说原因：失败 > 只有推理块 > 真空话。
  if (full.trim()) return { ok: true, text: full, reasoning, why: '' }
  if (failure) {
    const head = failure.kind === 'aborted' ? '被中止'
      : failure.kind === 'max-tokens' ? 'token 用完了'
        : '模型这条路失败了'
    const tail = [failure.message, failure.code ? `（${failure.code}）` : ''].filter(Boolean).join(' ')
    return { ok: false, text: '', reasoning, why: tail ? `${head}：${tail}` : head }
  }
  if (reasoning.trim()) {
    return { ok: false, text: '', reasoning, why: '正文是空的，只有推理块' }
  }
  return { ok: false, text: '', reasoning, why: '模型给的空话' }
}
