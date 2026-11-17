// 2026-11-09 17:0x：卡片答不出来，先钉住「为什么」。
//
// 现场：pet_input{action:'card', text:'…'} 回「卡片没答成：模型给的空话」。
// 查宿主契约（ctx.llm.stream → GenerateOptions）：provider 和 model 都是**必填**，
// 而 lib/answer.js 里传的是 provider: undefined / model: undefined。
// 适配器按 options.provider 选，选不到就以一个带 error 的 finish 块收尾——
// 那种块 answer.js 从来没读过，于是「调用失败」被写成了「模型给的空话」。
//
// 这份测试钉三件：
//   1. 失败要说清失败在哪（别把 error finish 说成空话）
//   2. provider/model 要真的传进 llm.stream
//   3. 没给 provider/model 就别发请求，当场说清楚
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamAnswer } from '../lib/answer.js'

function streamOf(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

test('取消/出错：finish 块带着 error，必须把它的原因说出来', async () => {
  const seen = []
  const llm = {
    stream(options) {
      seen.push(options)
      return streamOf([
        { type: 'finish', reason: { kind: 'error', failure: { message: 'unknown provider: undefined', code: 'NO_ADAPTER' } } },
      ])
    },
  }
  const r = await streamAnswer({ llm, provider: 'p', model: 'm', rows: [], question: '在吗', mode: 'quick' })
  assert.equal(r.ok, false)
  assert.notEqual(r.why, '模型给的空话', '不能把调用失败说成空话')
  assert.match(r.why, /unknown provider|NO_ADAPTER/)
  assert.equal(seen.length, 1)
})

test('provider / model 真的传进 llm.stream', async () => {
  const seen = []
  const llm = {
    stream(options) {
      seen.push(options)
      return streamOf([
        { type: 'text-delta', index: 0, text: '收到' },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
    },
  }
  const r = await streamAnswer({
    llm, provider: 'wb-proxy', model: 'deepseek-v4.1-flash', rows: [], question: '在吗', mode: 'quick',
  })
  assert.equal(r.ok, true)
  assert.equal(r.text, '收到')
  assert.equal(seen[0].provider, 'wb-proxy')
  assert.equal(seen[0].model, 'deepseek-v4.1-flash')
})

test('没给 provider/model：不发请求，当场说清楚', async () => {
  let called = 0
  const llm = { stream() { called += 1; return streamOf([]) } }
  const r = await streamAnswer({ llm, rows: [], question: '在吗' })
  assert.equal(r.ok, false)
  assert.equal(called, 0, '没型号就不该去撞适配器')
  assert.match(r.why, /provider|model/i)
})

test('被中止：说被中止，不说空话', async () => {
  const llm = {
    stream() {
      return streamOf([{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted by caller', code: 'ABORTED' } } }])
    },
  }
  const r = await streamAnswer({ llm, provider: 'p', model: 'm', rows: [], question: '在吗' })
  assert.equal(r.ok, false)
  assert.match(r.why, /abort|中止|取消/i)
})

test('正常流式：文本一块块进来，onDelta 收到', async () => {
  const got = []
  const llm = {
    stream() {
      return streamOf([
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: '蓝' },
        { type: 'text-delta', index: 0, text: '石' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '蓝石' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
    },
  }
  const r = await streamAnswer({
    llm, provider: 'p', model: 'm', rows: [], question: '测试词是啥', onDelta: (t) => got.push(t),
  })
  assert.equal(r.ok, true)
  assert.equal(r.text, '蓝石')
  assert.equal(got.join(''), '蓝石')
})

test('带历史的追问：assistant 那条必须带 source（宿主适配器会读 source.replayState）', async () => {
  let seen = null
  const llm = {
    stream(options) {
      seen = options
      // 学宿主适配器的样子去读：assistant 消息没有 source 就会抛
      for (const m of options.messages) {
        if (m.role === 'assistant' && !m.source) throw new Error("Cannot read properties of undefined (reading 'replayState')")
      }
      return streamOf([
        { type: 'text-delta', index: 0, text: '蓝石' },
        { type: 'finish', reason: { kind: 'stop' } },
      ])
    },
  }
  const r = await streamAnswer({
    llm,
    provider: 'wb-proxy',
    model: 'deepseek-v4.1-flash',
    rows: [],
    question: '刚才让你记的测试词是什么？',
    history: [
      { role: 'user', text: '记住测试词：蓝石' },
      { role: 'assistant', text: '收到' },
    ],
  })
  assert.equal(r.ok, true, r.why)
  const assistant = seen.messages.find((m) => m.role === 'assistant')
  assert.ok(assistant, '历史里那条 assistant 丢了')
  assert.equal(assistant.source.kind, 'model')
  assert.equal(assistant.source.provider, 'wb-proxy')
  assert.equal(assistant.source.model, 'deepseek-v4.1-flash')
})
