// 2026-11-09 17:1x：ask 这条路，从工具入口一路走到假会话。
//
// 之前只验过「pet 吃 ask」和「不认识就说是要说什么」，没验过它真能把一句投进会话、
// 把这一轮的完整回答接回来。这份测试用一个假 sessionController 走完：
//   pet{ask} → sessionCard.ask → createSession → prompt → follow → 关联 → 返回
// 关键点：requestId 是 askInSession 内部生成的，所以假 prompt 要把它记下来，
// 假 follow 再用同一个 rpcId 回放——这正好也是宿主的关联口径。
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const tools = new Map()
let controller = null

function fakeController() {
  let requestId = ''
  let prompted = null
  let followed = null
  return {
    get prompted() { return prompted },
    get followed() { return followed },
    async list() { return { items: [] } },
    async create() { return { sessionId: 'session-fake-1', agentPreset: '' } },
    async prompt(request) {
      prompted = request
      requestId = String(request.requestId || '')
      return { ok: true }
    },
    follow(address) {
      followed = address
      const events = [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { turn: 1, source: { kind: 'user', rpcId: requestId } } },
        { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '桥接验收成功' }] } } },
        { type: 'tool/call', data: { turn: 1, name: 'read' } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ]
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'snapshot', records: events.map((event) => ({ event })) }
        },
      }
    },
  }
}

controller = fakeController()

const ctx = {
  logger: { info() {}, warn() {} },
  tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
  // index.js 在 apply 里同步调 ctx.inject；给它一个假的，会话桥就能挂上。
  inject(_names, callback) { callback({ sessionController: controller }) },
}

const dispose = await apply(ctx)
test.after(() => { try { dispose() } catch { /* ignore */ } })

test('ask 真把话投进会话，并接回这一轮的回答', async () => {
  const r = await tools.get('pet').execute({ action: 'ask', text: '只回复桥接验收成功，不调用工具', cwd: 'C:/tmp' })
  const meta = r.meta || {}
  assert.equal(meta.ok, true, `没成：${r.text}`)
  assert.equal(meta.text, '桥接验收成功', '回答正文没接回来')
  assert.equal(meta.tools, 1, '工具动作次数没数上')
  assert.equal(meta.sessionId, 'session-fake-1')
  assert.match(String(r.text), /回了 6 字/, `回执不对：${r.text}`)
})

test('投出去的那一句就是她说的那一句', () => {
  const p = controller.prompted
  assert.ok(p, '压根没 prompt')
  assert.equal(p.sessionId, 'session-fake-1')
  assert.equal(p.mode, 'queue')
  assert.equal(p.content[0].text, '只回复桥接验收成功，不调用工具')
  assert.match(String(p.requestId), /^ming-card-/, 'requestId 前缀变了，关联口径会跟着变')
})

test('跟的是同一个会话，且要了 assistantStream', () => {
  const f = controller.followed
  assert.ok(f, '压根没 follow')
  assert.deepEqual(f.address, { kind: 'session', sessionId: 'session-fake-1' })
  assert.equal(f.assistantStream, true)
})
