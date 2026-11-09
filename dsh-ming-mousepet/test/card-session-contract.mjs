import test from 'node:test'
import assert from 'node:assert/strict'
import { createCardSessionBridge } from '../lib/card-session.js'
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(r => setImmediate(r))
function fixture({ openGate, createGate, reject = false } = {}) {
  const calls = [], runs = [], local = []
  const engine = { async request(cmd, args) { calls.push({ cmd, ...args }); if (args.op === 'open' && openGate) await openGate.promise; return { ok: true } } }
  const cardCtl = { reset() { local.push('reset') }, ask(q) { local.push(q); return Promise.resolve({ ok: true }) } }
  const bridge = createCardSessionBridge({ engine, cardCtl, controller: () => ({}),
    create: async () => { if (createGate) await createGate.promise; return { ok: true, id: 'session-created' } },
    follow: async (_svc, opts) => { const done = defer(); runs.push({ opts, done }); await done.promise; if (reject) throw new Error('late error'); opts.onDelta('late'); opts.onActivity('late activity'); return { ok: true, text: 'late', tools: 1, sessionId: opts.sessionId } },
  })
  const ask = () => bridge.ask({ text: 'hello', sessionId: 'session-one' })
  return { bridge, calls, runs, local, ask }
}
for (const action of ['reset', 'close', 'dispose', 'askCard']) test(`${action} detaches session callbacks and stale busy`, async () => {
  const f = fixture(); const pending = f.ask(); await tick()
  await f.bridge[action]('new question')
  const boundary = f.calls.length
  f.runs[0].done.resolve(); const result = await pending
  assert.equal(f.runs[0].opts.signal?.aborted, true)
  assert.deepEqual(f.calls.slice(boundary), [])
  assert.equal(result.ok, false)
  assert.match(result.why, /停止跟随/)
})
test('session takeover resets local card and stale finally cannot unlock newer ask', async () => {
  const f = fixture(); const one = f.ask(); await tick(); const two = f.ask(); await tick()
  const boundary = f.calls.length
  f.runs[0].done.resolve(); await one
  assert.deepEqual(f.calls.slice(boundary), [])
  assert.equal(f.runs[1].opts.signal.aborted, false)
  assert.equal(f.local.filter(x => x === 'reset').length, 2)
  f.runs[1].done.resolve(); assert.equal((await two).ok, true)
  assert.equal(f.runs[1].opts.signal.aborted, true)
})
for (const stage of ['open', 'create']) test(`close during ${stage} prevents prompt and stale append`, async () => {
  const gate = defer(); const f = fixture({ [stage + 'Gate']: gate })
  const pending = stage === 'create' ? f.bridge.ask({ text: 'hello' }) : f.ask()
  await tick(); await f.bridge.close(); const boundary = f.calls.length
  gate.resolve(); await tick(); for (const run of f.runs) run.done.resolve(); const result = await pending
  assert.equal(f.runs.length, 0)
  assert.deepEqual(f.calls.slice(boundary), [])
  assert.equal(result.ok, false)
})
test('session banner contains actual newlines', async () => {
  const f = fixture(); const pending = f.ask(); await tick(); f.runs[0].done.resolve(); await pending
  const banner = f.calls.find(x => x.op === 'append').text
  assert.equal(banner.charCodeAt(0), 10)
  assert.equal(banner.charCodeAt(banner.length - 1), 10)
})
test('late rejection after detach stays quiet', async () => {
  const f = fixture({ reject: true }); const pending = f.ask(); await tick(); f.bridge.reset()
  const boundary = f.calls.length; f.runs[0].done.resolve()
  assert.equal((await pending).ok, false); assert.deepEqual(f.calls.slice(boundary), [])
})
