import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { askInSession } from '../lib/sessions.js'
const ev = (type, data) => ({ type: 'event', event: { type, data } })
const start = turn => ev('turn/start', { turn })
const user = rpcId => ev('user/message', { source: { kind: 'user', rpcId } })
const text = (turn, value) => ev('assistant/message', { turn, message: { content: [{ type: 'text', text: value }] } })
const end = turn => ev('turn/end', { turn, reason: { kind: 'completed' } })
const tool = turn => ev('tool/call', { turn, name: 'mock' })
const run = async (frames) => {
  let requestId
  const seen = [], activity = []
  const controller = { prompt: async req => { requestId = req.requestId }, follow: async function* () { yield* frames(requestId) } }
  const result = await askInSession(controller, { sessionId: 's', text: 'question', onDelta: t => seen.push(t), onActivity: t => activity.push(t) })
  return { result, seen, activity }
}
test('fast reply completed before follow snapshot is recovered by rpcId', async () => {
  const { result, seen } = await run(id => [{ type: 'snapshot', records: [start(1), user('old'), text(1, 'OLD'), end(1), start(2), user(id), text(2, 'mine'), end(2)] }])
  assert.equal(result.ok, true); assert.equal(result.text, 'mine'); assert.deepEqual(seen, ['mine'])
})
test('queued unrelated turn cannot supply text tools or completion', async () => {
  const { result, seen, activity } = await run(id => [start(1), user('other'), text(1, 'wrong'), tool(1), end(1), start(2), user(id), text(99, 'wrong-number'), tool(99), end(99), text(2, 'mine'), end(2)])
  assert.equal(result.ok, true); assert.equal(result.text, 'mine'); assert.equal(result.tools, 0); assert.deepEqual(seen, ['mine']); assert.deepEqual(activity, [])
})
test('missing request correlation fails closed', async () => {
  const { result, seen } = await run(() => [start(1), user('other'), text(1, 'wrong'), tool(1), end(1)])
  assert.equal(result.ok, false); assert.equal(result.text, ''); assert.equal(result.tools, 0); assert.deepEqual(seen, []); assert.match(result.why, /关联/)
})
for (const before of [true, false]) test(`co-consumed user message (${before ? 'before' : 'after'}) fails explicitly`, async () => {
  const { result, seen } = await run(id => [start(2), ...[user(id), user('other')].sort(() => before ? -1 : 1), text(2, 'mixed'), end(2)])
  assert.equal(result.ok, false); assert.equal(result.text, ''); assert.deepEqual(seen, [])
})
test('truncated snapshot lacking turn start never invents correlation', async () => {
  const { result } = await run(id => [{ type: 'snapshot', hasMore: true, records: [user(id), text(2, 'unknown'), end(2)] }])
  assert.equal(result.ok, false); assert.equal(result.text, '')
})
test('uncommitted assistant chunks never pollute committed output', async () => {
  const { result } = await run(id => [start(2), user(id), { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'abandoned' } } }, text(2, 'mine'), end(2)])
  assert.equal(result.ok, true); assert.equal(result.text, 'mine')
})
test('同一条请求的 user/message 重复出现（append+replace）不算「合并了别的请求」', async () => {
  // 2026-11-09 17:1x 宿主实测：ask 回了「本轮合并了其他请求」，可会话里只有我们这一条
  //（titleInput.count=1）。旧代码按条数数，重复投递就误判；判据应该是「有没有别的 rpcId」。
  const { result, seen } = await run(id => [start(2), user(id), user(id), text(2, 'mine'), end(2)])
  assert.equal(result.ok, true, result.why)
  assert.equal(result.text, 'mine')
  assert.deepEqual(seen, ['mine'])
})
