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

// 9) 只有思考过程：不许当成正式回复（核查 R05 / E-REASONING-AS-REPLY）
{
  const f8 = join(tmp, 'f8.jsonl')
  writeFileSync(f8, JSON.stringify(rec({ text: '只思考的那种' })) + '\n', 'utf8')
  const think = {
    listProviders: () => [{ id: 'fake', name: 'Fake' }],
    listModels: async () => [{ id: 'fake-model', name: 'Fake Model' }],
    stream() {
      return (async function* () {
        yield { type: 'reasoning-delta', text: '这条要不要接呢' }
        yield { type: 'reasoning-delta', text: '算了随便说一句' }
      })()
    },
  }
  const ob8 = join(tmp, 'ob8')
  const c = createForwardConsumer({ llm: think, forwardFile: f8, outboxDir: ob8, doneFile: join(tmp, 'done8.json') })
  const r = await c.tick()
  ok('只有思考过程时外发文本为空', r.handled === 1 && r.skipped === 1 && r.sent.length === 0, JSON.stringify(r))
  ok('reasoning-only 不写箱子', !existsSync(ob8) || readdirSync(ob8).length === 0)
  const dbg = existsSync(join(tmp, 'interest-forward-debug.jsonl')) ? readFileSync(join(tmp, 'interest-forward-debug.jsonl'), 'utf8') : ''
  ok('记下原因是 reasoning-only', dbg.includes('reasoning-only'))
}

// 10) 两个 tick 并发：同一行只调一次模型、只写一个箱子（核查 R06-1 / E-OVERLAPPING-TICKS）
{
  const f7 = join(tmp, 'f7.jsonl')
  writeFileSync(f7, JSON.stringify(rec({ text: '并发的那一条' })) + '\n', 'utf8')
  let calls = 0
  const slow = {
    listProviders: () => [{ id: 'fake', name: 'Fake' }],
    listModels: async () => [{ id: 'fake-model', name: 'Fake Model' }],
    stream() {
      calls += 1
      return (async function* () {
        await new Promise((r) => setTimeout(r, 60))
        yield { type: 'text-delta', text: '并发回复' }
      })()
    },
  }
  const ob7 = join(tmp, 'ob7')
  const c = createForwardConsumer({ llm: slow, forwardFile: f7, outboxDir: ob7, doneFile: join(tmp, 'done7.json') })
  const [r1, r2] = await Promise.all([c.tick(), c.tick()])
  ok('并发 tick 只跑一轮', r1.handled + r2.handled === 1 && calls === 1, JSON.stringify({ r1, r2, calls }))
  ok('第二个 tick 如实说 busy', r1.why === 'busy' || r2.why === 'busy', JSON.stringify([r1.why, r2.why]))
  ok('并发只写一个箱子', readdirSync(ob7).length === 1, readdirSync(ob7).join(','))
}

// 11) 已处理超过 800 条、源日志还在：不许重放旧请求（核查 R06-2 / E-REPLAY-AFTER-800）
{
  const f9 = join(tmp, 'f9-801.jsonl')
  const lines = []
  for (let i = 0; i < 801; i++) lines.push(JSON.stringify(rec({ text: '批量第 ' + i + ' 条' })))
  const body = lines.join('\n') + '\n'
  writeFileSync(f9, body, 'utf8')
  const d9 = join(tmp, 'done9.json')
  const ob9 = join(tmp, 'ob9')
  const c = createForwardConsumer({ llm: fakeLlm('批量回复'), forwardFile: f9, outboxDir: ob9, doneFile: d9, maxPerTick: 900 })
  const r1 = await c.tick()
  const r2 = await c.tick()
  ok('801 条一轮处理完', r1.handled === 801, String(r1.handled))
  ok('第二轮没有旧请求重放', r2.handled === 0, JSON.stringify(r2))
  const state = JSON.parse(readFileSync(d9, 'utf8'))
  ok('done 只留 800 个 id（正确性靠游标）', state.ids.length === 800, String(state.ids.length))
  ok('游标记到文件末尾', state.cursor === Buffer.byteLength(body), String(state.cursor))
  ok('同一个 job 重放不写第二份箱子', readdirSync(ob9).length === 801, String(readdirSync(ob9).length))
}

// 12) 源日志被整份换掉（长度还更长）：开头指纹变了就重读，已处理过的 id 仍然挡住
{
  const f10 = join(tmp, 'f10.jsonl')
  writeFileSync(f10, JSON.stringify(rec({ text: '旧的一行' })) + '\n', 'utf8')
  const d10 = join(tmp, 'done10.json')
  const c = createForwardConsumer({ llm: fakeLlm('第一次'), forwardFile: f10, outboxDir: join(tmp, 'ob10'), doneFile: d10 })
  await c.tick()
  writeFileSync(f10, JSON.stringify(rec({ text: '换过的新行，比原来长一些' })) + '\n' + JSON.stringify(rec({ text: '第二条新行' })) + '\n', 'utf8')
  const r = await c.tick()
  ok('源文件被换掉后还能读新行', r.handled === 2, JSON.stringify(r))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
