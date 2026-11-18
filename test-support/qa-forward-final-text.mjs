// Run with node --test from the reviewed Hers_Life checkout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { collectOne } from '../dsh-ming-interest/lib/forward.mjs'

const collect = async (...chunks) => collectOne({ async *stream() { yield* chunks } }, 'synthetic')
const reply = { type: 'text-delta', text: '给你留个位' }
const stop = { type: 'finish', reason: { kind: 'stop' } }

test('only text-delta contributes public text', async () => {
  const r = await collect({ type: 'debug', text: 'internal marker' },
    { type: 'reasoning-delta', text: 'private marker' }, reply, stop)
  assert.equal(r.text, reply.text)
})

test('an unknown textual event alone is silent', async () => {
  assert.equal((await collect({ type: 'trace', message: { content: 'internal' } }, stop)).text, '')
})

for (const kind of ['tool-calls', 'aborted', 'error', 'max-tokens']) {
  test('drops candidate with finish ' + kind, async () => {
    assert.equal((await collect(reply, { type: 'finish', reason: { kind } })).text, '')
  })
}

test('a tool call stream cannot publish its preamble', async () => {
  assert.equal((await collect(reply, { type: 'tool-call-delta', argumentsDelta: '{}' }, stop)).text, '')
})

test('text-only adapter with no finish frame still works after normal stream closure', async () => {
  assert.equal((await collect(reply)).text, reply.text)
})
