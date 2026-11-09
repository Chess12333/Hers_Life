import assert from 'node:assert/strict'
import test from 'node:test'
import { createCard } from '../lib/card.js'

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture({ fail = false, blockOpen = false } = {}) {
  const calls = [], seen = [], gates = [], started = deferred(), open = deferred()
  const llm = {
    stream(options) {
      assert.equal(this, llm, 'preserve service receiver')
      seen.push(options)
      const gate = deferred()
      gates.push(gate)
      return (async function* () {
        yield { type: 'text-delta', text: 'initial' }
        started.resolve()
        await gate.promise // Deliberately ignores abort, like a delayed provider.
        if (fail) throw new Error('late provider error')
        yield { type: 'text-delta', text: 'late' }
      })()
    },
  }
  const engine = { async request(cmd, args) {
    calls.push({ cmd, ...args })
    if (blockOpen && args.op === 'open') await open.promise
    return { ok: true }
  } }
  // 2026-11-09 17:0x：卡片现在必须带模型路由（宿主 GenerateOptions.provider/model 必填）。
  // 不给路由就会在调 llm.stream 之前直接失败——夹具里得显式给一条，才测得到取消。
  return { card: createCard({ llm, engine, callModel: () => ({ provider: 'test', model: 'fixture' }) }), calls, seen, gates, started, open }
}

for (const operation of ['reset', 'close']) {
  test(`${operation} cancels stream and prevents stale writes/history`, async () => {
    const f = fixture()
    const pending = f.card.ask('old question')
    await f.started.promise
    await f.card[operation]()
    const boundary = f.calls.length
    f.gates[0].resolve()
    const result = await pending
    assert.equal(f.seen[0].signal?.aborted, true, 'provider gets aborted signal')
    assert.equal(result.ok, false, 'cancelled answer must not report success')
    assert.equal(f.card.historyLength(), 0)
    assert.equal(f.card.isBusy(), false)
    assert.deepEqual(f.calls.slice(boundary), [], 'no late append or busy writes')
  })
}

test('old finally cannot unlock a newer answer or inject old history', async () => {
  const f = fixture()
  const old = f.card.ask('old question')
  await f.started.promise
  f.card.reset()
  const fresh = f.card.ask('new question')
  await tick()
  f.gates[0].resolve()
  await old
  const accepted = f.seen.length === 2
  if (f.gates[1]) {
    assert.equal(f.card.isBusy(), true, 'old finally must not clear new busy')
    assert.equal(f.seen[1].messages.length, 1)
    assert.equal(f.card.historyLength(), 0)
    f.gates[1].resolve()
  }
  const result = await fresh
  assert.equal(accepted, true, 'reset releases logical busy immediately')
  assert.equal(result.ok, true)
  assert.equal(f.card.historyLength(), 2)
})

test('close while open awaits prevents starting the model or appending', async () => {
  const f = fixture({ blockOpen: true })
  const pending = f.card.ask('old question')
  await f.card.close()
  const boundary = f.calls.length
  f.open.resolve()
  await tick()
  for (const gate of f.gates) gate.resolve()
  const result = await pending
  assert.equal(f.seen.length, 0)
  assert.equal(result.ok, false)
  assert.deepEqual(f.calls.slice(boundary), [])
})

test('late provider rejection after reset stays silent', async () => {
  const f = fixture({ fail: true })
  const pending = f.card.ask('old question')
  await f.started.promise
  f.card.reset()
  const boundary = f.calls.length
  f.gates[0].resolve()
  assert.equal((await pending).ok, false)
  assert.deepEqual(f.calls.slice(boundary), [])
  assert.equal(f.card.historyLength(), 0)
})

test('timeout retires collector so late deltas cannot reach UI', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  const pending = f.card.ask('question')
  await f.started.promise
  t.mock.timers.tick(60000)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(f.seen[0].signal?.aborted, true)
  const boundary = f.calls.length
  f.gates[0].resolve()
  await tick()
  assert.deepEqual(f.calls.slice(boundary), [])
  assert.equal(f.card.historyLength(), 0)
})

test('normal completion retires and aborts its provider signal', async () => {
  const f = fixture()
  const pending = f.card.ask('question')
  await f.started.promise
  f.gates[0].resolve()
  assert.equal((await pending).ok, true)
  assert.equal(f.seen[0].signal?.aborted, true)
  assert.equal(f.card.historyLength(), 2)
})
