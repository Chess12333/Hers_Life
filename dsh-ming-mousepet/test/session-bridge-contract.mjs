/**
 * 会话桥的契约测试（2026-11-09）。
 *
 * 不碰真会话：给一个假的 sessionController，只看「发出去的东西对不对、收回来的东西拼不拼得上」。
 *   1. list 要滤掉 subagent 行，标题和短 id 要留；
 *   2. prompt 的 content 必须是 [{type:'text'}]，mode 是 queue，requestId 每次不同；
 *   3. 流式帧要拼成一句完整的话，onDelta 只在验完之后交付整段（不逐段交付）；
 *   4. 工具调用要变成一句「在动 X」；
 *   5. 一轮结束（turn/end 且 turn 比快照里的新）就停，不许把进程挂在那儿；
 *   6. 没有 controller 不许抛，返回 ok:false 带原因；
 *   7. wrapCapture 要把原文包进 <抓取内容>。
 */
import { listSessions, createSession, askInSession, wrapCapture } from '../lib/sessions.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const makeController = () => {
  const calls = { prompt: [], follow: [] }
  let consumed = 0
  const controller = {
    async list() {
      return {
        items: [
          { sessionId: 'session-1', updatedAt: 100, running: false, blank: false, projections: { values: { title: '甲会话' } } },
          { sessionId: 'session-2', updatedAt: 200, running: true, blank: false, origin: 'subagent' },
          { sessionId: 'session-3', updatedAt: 50, running: false, blank: true },
        ],
      }
    },
    async create(req) {
      calls.create = req
      return { sessionId: 'session-9' }
    },
    async prompt(req) {
      calls.prompt.push(req)
      return { accepted: true }
    },
    follow(_req) {
      calls.follow.push(_req)
      return (async function* () {
        yield {
          type: 'snapshot',
          records: [
            { event: { type: 'turn/start', data: { turn: 2 } } },
            { event: { type: 'user/message', data: { source: { kind: 'user', rpcId: calls.prompt.at(-1).requestId } } } },
          ],
        }
        consumed += 1
        yield { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'uncorrelated' } } }
        consumed += 1
        yield { type: 'event', event: { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '你好' }] } } } }
        consumed += 1
        yield { type: 'event', event: { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '呀' }] } } } }
        consumed += 1
        yield { type: 'event', event: { type: 'tool/call', data: { turn: 2, name: 'ops_bash' } } }
        consumed += 1
        yield { type: 'event', event: { type: 'turn/end', data: { turn: 2 } } }
        consumed += 1
        // 这一条如果被消费了，说明没在 turn/end 停
        yield { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '不该到这里' }] } } } }
        consumed += 1
      })()
    },
  }
  return { controller, calls, consumed: () => consumed }
}

try {
  const { controller, calls, consumed } = makeController()

  const list = await listSessions(controller)
  check('list 成功', list.ok === true, list.why || '')
  check('滤掉 subagent', list.items.every((s) => s.id !== 'session-2'), list.items.map((s) => s.id).join(','))
  check('标题留着', list.items.some((s) => s.title === '甲会话'), JSON.stringify(list.items.map((s) => s.title)))
  check('短 id 去掉 session- 前缀', list.items.every((s) => !s.short.startsWith('session-')), list.items[0]?.short)
  check('按时间新→旧', list.items[0].updatedAt >= list.items[list.items.length - 1].updatedAt, '')

  const created = await createSession(controller, { cwd: 'C:/x' })
  check('开会话拿到 id', created.ok === true && created.id === 'session-9', JSON.stringify(created))
  check('cwd 传下去了', calls.create?.cwd === 'C:/x', JSON.stringify(calls.create))

  const deltas = []
  const acts = []
  const r = await askInSession(controller, {
    sessionId: 'session-1',
    text: '帮我看一下',
    onDelta: (t) => deltas.push(t),
    onActivity: (a) => acts.push(a),
    timeoutMs: 20000,
  })
  check('ask 成功', r.ok === true, r.why || '')
  check('拼成一句', r.text === '你好呀', JSON.stringify(r.text))
  check('整段交付一次', deltas.length === 1 && deltas[0] === r.text, JSON.stringify(deltas))
  check('未关联 token 块不进入输出', !r.text.includes('uncorrelated') && !deltas.some(t => t.includes('uncorrelated')), JSON.stringify(deltas))
  check('tool/call 变成一句话', acts.length === 1 && acts[0].includes('ops_bash'), JSON.stringify(acts))
  check('一轮结束就停', consumed() < 7, `消费了 ${consumed()} 帧`)
  const p = calls.prompt[0]
  check('prompt 带 text 块', p?.content?.[0]?.type === 'text' && p.content[0].text === '帮我看一下', JSON.stringify(p?.content))
  check('prompt 是 queue 模式', p?.mode === 'queue', String(p?.mode))
  check('prompt 有 requestId', typeof p?.requestId === 'string' && p.requestId.length > 8, p?.requestId)

  await askInSession(controller, { sessionId: 'session-1', text: '第二次', timeoutMs: 20000 })
  check('requestId 每次不同', calls.prompt[0].requestId !== calls.prompt[1].requestId, '')

  const none = await askInSession(null, { sessionId: 'x', text: 'y' })
  check('没 controller 不抛', none.ok === false && Boolean(none.why), none.why || '')

  const wrapped = wrapCapture('一段正文', { question: '这啥意思', title: '标题', url: 'https://a.b' })
  check('包了 <抓取内容>', wrapped.includes('<抓取内容>') && wrapped.includes('</抓取内容>'), '')
  check('问题和标题都在', wrapped.includes('这啥意思') && wrapped.includes('标题') && wrapped.includes('https://a.b'), '')
} catch (error) {
  check('跑完', false, error?.message || String(error))
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 过`)
if (bad.length) process.exitCode = 1
