import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { getEventListeners } from 'node:events'
import { askInSession, wrapCapture } from '../lib/sessions.js'

// Only mocks: never resolve, prompt, cancel, or mutate a real session.
const snapshot = { type: 'snapshot', records: [{ event: { type: 'turn/start', data: { turn: 1 } } }] }
const delta = (text) => ({ type: 'event', event: { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text }] } } } })
const correlation = id => ({ type: 'snapshot', records: [{ event: { type: 'turn/start', data: { turn: 2 } } }, { event: { type: 'user/message', data: { source: { kind: 'user', rpcId: id } } } }] })
const end = (turn = 2, kind = 'completed') => ({ type: 'event', event: { type: 'turn/end', data: { turn, reason: { kind } } } })
const ask = (controller, options = {}) => askInSession(controller, { sessionId: 's', text: 'x', ...options })
const controllerFor = (frames) => {
  const controller = { requestId: null, prompt: async req => { controller.requestId = req.requestId; return { accepted: true } }, follow: () => (async function* () { yield correlation(controller.requestId); yield* frames.filter(f => f !== snapshot) })() }
  return controller
}

test('pre-aborted signal never calls prompt or follow', async () => {
  const ac = new AbortController()
  ac.abort()
  let calls = 0
  const result = await ask({ prompt: async () => { calls++ }, follow: () => { calls++; return [] } }, { signal: ac.signal })
  assert.equal(calls, 0)
  assert.equal(result.ok, false)
  assert.ok(result.why)
})

test('prompt and follow receive the same composed cancellation signal', async () => {
  let promptSignal
  const controller = controllerFor([snapshot, end()])
  controller.prompt = async (_req, signal) => { promptSignal = signal; controller.requestId = _req.requestId }
  const follow = controller.follow
  controller.follow = (req, signal) => { assert.ok(signal instanceof AbortSignal); assert.equal(signal, promptSignal); return follow(req, signal) }
  assert.equal((await ask(controller)).ok, true)
})

test('natural EOF preserves output but is not success', async () => {
  const result = await ask(controllerFor([snapshot, delta('partial')]))
  assert.equal(result.ok, false)
  assert.equal(result.text, 'partial')
  assert.ok(result.why)
})

test('old turn/end cannot turn natural EOF into success', async () => {
  assert.equal((await ask(controllerFor([snapshot, end(1)]))).ok, false)
})

for (const kind of ['aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked']) {
  test(`${kind} turn/end is failure with partial output`, async () => {
    const result = await ask(controllerFor([snapshot, delta('partial'), end(2, kind)]))
    assert.equal(result.ok, false)
    assert.equal(result.text, 'partial')
    assert.ok(result.why)
  })
}

for (const throws of [false, true]) {
  test(`caller abort with ${throws ? 'throwing' : 'quiet'} follow preserves output and removes listener`, async () => {
    const ac = new AbortController()
    const seen = []
    const controller = controllerFor([])
    controller.follow = async function* (_req, signal) {
      yield correlation(controller.requestId)
      yield delta('partial')
      ac.abort()
      assert.equal(signal.aborted, true)
      if (throws) throw new Error('stream cancelled')
      yield delta('late')
    }
    const result = await ask(controller, { signal: ac.signal, onDelta: (text) => seen.push(text) })
    assert.equal(result.ok, false)
    assert.equal(result.text, 'partial')
    // 2026-11-09 17:1x：改成整段交付之后，被中止的一轮一个字都不交出去（result.text 仍留部分）
    assert.deepEqual(seen, [], '被中止的一轮不该交付任何一段')
    assert.equal(getEventListeners(ac.signal, 'abort').length, 0)
  })
}

for (const failure of [false, true]) {
  test(`listener removed on ${failure ? 'prompt failure' : 'success'}`, async () => {
    const ac = new AbortController()
    const controller = controllerFor([snapshot, end()])
    if (failure) controller.prompt = async () => { throw new Error('admission failed') }
    const result = await ask(controller, { signal: ac.signal })
    assert.equal(result.ok, !failure)
    assert.equal(getEventListeners(ac.signal, 'abort').length, 0)
  })
}

test('follow exception keeps accumulated output and tools', async () => {
  const controller = controllerFor([])
  controller.follow = async function* () {
    yield correlation(controller.requestId)
    yield delta('partial')
    yield { type: 'event', event: { type: 'tool/call', data: { turn: 2, name: 'mock' } } }
    throw new Error('connection lost')
  }
  const result = await ask(controller)
  assert.equal(result.ok, false)
  assert.equal(result.text, 'partial')
  assert.equal(result.tools, 1)
  assert.match(result.why, /connection lost/)
})

test('abort during prompt admission does not begin follow', async () => {
  const ac = new AbortController()
  let followed = false
  const result = await ask({ prompt: async () => ac.abort(), follow: () => { followed = true; return [] } }, { signal: ac.signal })
  assert.equal(result.ok, false)
  assert.equal(followed, false)
})

test('wrapCapture uses actual newlines including header and block spacing', () => {
  assert.equal(wrapCapture('正文', { title: '题', url: 'https://x', question: '问' }), '页面：《题》\n网址：https://x\n\n<抓取内容>\n正文\n</抓取内容>\n\n用户的问题：问')
})
