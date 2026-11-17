// test-support/qa-interest-forward.mjs —— AstrBot 转发 → DSH 决定 → outbox 的离线验收
//
// 用假 llm 跑真的 lib/forward.mjs，验：
//   · 读到几条处理几条，写进 qq-outbox（格式 {chatKey, text}）
//   · 处理过的不会重复处理（done 记账）
//   · 模型说 NONE / 空 → 不写 outbox，但也要记账（不然会一直重试）
//   · 模型异常/超时 → 不写 outbox，不崩
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const LIB = join(here, '..', 'dsh-ming-interest', 'lib', 'forward.mjs')
const { createForwardConsumer, idOf, buildPrompt } = await import('file://' + LIB.replace(/\\/g, '/'))

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const tmp = mkdtempSync(join(tmpdir(), 'ming-fwd-'))
const forwardFile = join(tmp, 'interest-forward.jsonl')
const outbox = join(tmp, 'qq-outbox')
const doneFile = join(tmp, 'interest-forward-done.json')
mkdirSync(outbox, { recursive: true })

const rec = (over = {}) => ({
  at: '2026-11-17T13:00:00', groupId: '700000001', chatKey: 'group:700000001',
  nick: '群友', text: 'AI 模型又更新了', topics: ['AI / 模型 / Agent'], words: ['ai'],
  context: [{ t: '12:59', n: '别人', x: '前面那句' }], source: 'astrbot-interest', handled: false, ...over,
})

// 假 llm：带 provider 目录 + 流式输出（2026-11-17：不传 provider/model 拿不到输出）
function fakeLlm(reply) {
  return {
    listProviders: () => [{ id: 'fake', name: 'Fake' }],
    listModels: async () => [{ id: 'fake-model', name: 'Fake Model' }],
    seen: [],
    stream(opts) {
      this.seen.push({ provider: opts.provider, model: opts.model })
      return (async function* () {
        yield { type: 'text-delta', text: reply }
      })()
    },
  }
}

writeFileSync(forwardFile, [
  JSON.stringify(rec({ text: 'AI 模型又更新了' })),
  JSON.stringify(rec({ text: '这版参数不知道有没有改' })),
].join('\n') + '\n', 'utf8')

// 1) 正常：两条都回
{
  const c = createForwardConsumer({ llm: fakeLlm('嗯，改没改看跑分吧'), forwardFile, outboxDir: outbox, doneFile, maxPerTick: 2 })
  const r = await c.tick()
  ok('处理 2 条', r.handled === 2, JSON.stringify(r))
  ok('写了 2 个箱子', readdirSync(outbox).length === 2, readdirSync(outbox).join(','))
  const f = readdirSync(outbox)[0]
  const payload = JSON.parse(readFileSync(join(outbox, f), 'utf8'))
  ok('箱子格式是 {chatKey, text}', payload.chatKey === 'group:700000001' && payload.text.includes('跑分'), JSON.stringify(payload))
  ok('done 记账写出来了', existsSync(doneFile) && JSON.parse(readFileSync(doneFile, 'utf8')).ids.length === 2)
  ok('箱子不是 .tmp 残留', readdirSync(outbox).every((n) => n.endsWith('.json')))
}

// 2) 再跑：不重复
{
  const c = createForwardConsumer({ llm: fakeLlm('不该再出现'), forwardFile, outboxDir: outbox, doneFile })
  const r = await c.tick()
  ok('第二次不重复处理', r.handled === 0 && readdirSync(outbox).length === 2, JSON.stringify(r))
}

// 3) NONE：不写箱子，但要记账
{
  const f2 = join(tmp, 'f2.jsonl')
  writeFileSync(f2, JSON.stringify(rec({ text: '新的一条', nick: '另一个人' })) + '\n', 'utf8')
  const d2 = join(tmp, 'done2.json')
  const c = createForwardConsumer({ llm: fakeLlm('NONE'), forwardFile: f2, outboxDir: join(tmp, 'ob2'), doneFile: d2 })
  const r = await c.tick()
  ok('NONE 算处理过', r.handled === 1 && r.skipped === 1)
  ok('NONE 不写箱子', !existsSync(join(tmp, 'ob2')) || readdirSync(join(tmp, 'ob2')).length === 0)
  ok('NONE 也记账（不然一直重试）', JSON.parse(readFileSync(d2, 'utf8')).ids.length === 1)
}

// 4) 模型炸了：不崩、不写箱子
{
  const f3 = join(tmp, 'f3.jsonl')
  writeFileSync(f3, JSON.stringify(rec({ text: '第三条' })) + '\n', 'utf8')
  const badLlm = {
    listProviders: () => [{ id: 'fake', name: 'Fake' }],
    listModels: async () => [{ id: 'fake-model', name: 'Fake Model' }],
    stream() { throw new Error('boom') },
  }
  const c = createForwardConsumer({ llm: badLlm, forwardFile: f3, outboxDir: join(tmp, 'ob3'), doneFile: join(tmp, 'done3.json') })
  let threw = false
  let r = null
  try { r = await c.tick() } catch { threw = true }
  ok('模型抛错不把 tick 带崩', !threw, JSON.stringify(r))
  ok('模型抛错不写箱子', !existsSync(join(tmp, 'ob3')) || readdirSync(join(tmp, 'ob3')).length === 0)
}

// 5) 没有 llm
{
  const f4 = join(tmp, 'f4.jsonl')
  writeFileSync(f4, JSON.stringify(rec({ text: '第四条' })) + '\n', 'utf8')
  const c = createForwardConsumer({ llm: null, forwardFile: f4, outboxDir: join(tmp, 'ob4'), doneFile: join(tmp, 'done4.json') })
  const r = await c.tick()
  ok('没有 llm 时整轮不调（no-route），不崩', r.handled === 0 && r.why === 'no-route', JSON.stringify(r))
}

// 6) 工具函数
{
  const a = rec({ text: 'x' })
  const b = rec({ text: 'y' })
  ok('idOf 同一条稳定', idOf(a) === idOf({ ...a }))
  ok('idOf 不同条不同', idOf(a) !== idOf(b))
  const p = buildPrompt(rec())
  ok('prompt 带原句', p.includes('AI 模型又更新了'))
  ok('prompt 带上下文', p.includes('前面那句'))
  ok('prompt 要求一行或 NONE', p.includes('NONE'))
}

// 7) 路由：传了 provider/model 才算调模型
{
  const f5 = join(tmp, 'f5.jsonl')
  writeFileSync(f5, JSON.stringify(rec({ text: '第五条' })) + '\n', 'utf8')
  const llm = fakeLlm('路由测试')
  const c = createForwardConsumer({ llm, forwardFile: f5, outboxDir: join(tmp, 'ob5'), doneFile: join(tmp, 'done5.json') })
  const r = await c.tick()
  ok('自动解析出 provider/model', r.handled === 1 && llm.seen[0]?.provider === 'fake' && llm.seen[0]?.model === 'fake-model', JSON.stringify(llm.seen))
}

// 8) 没有 provider 目录：不调模型、不写箱、也不记账（等它恢复再试）
{
  const f6 = join(tmp, 'f6.jsonl')
  writeFileSync(f6, JSON.stringify(rec({ text: '第六条' })) + '\n', 'utf8')
  const noProv = { stream() { return (async function* () { yield { type: 'text-delta', text: '不该出现' } })() } }
  const c = createForwardConsumer({ llm: noProv, forwardFile: f6, outboxDir: join(tmp, 'ob6'), doneFile: join(tmp, 'done6.json') })
  const r = await c.tick()
  ok('没有 provider 时整轮不调', r.handled === 0 && r.why === 'no-route', JSON.stringify(r))
  ok('没有 provider 时不写箱子', !existsSync(join(tmp, 'ob6')) || readdirSync(join(tmp, 'ob6')).length === 0)
  ok('没有 provider 时不记账（下次还能试）', !existsSync(join(tmp, 'done6.json')))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
