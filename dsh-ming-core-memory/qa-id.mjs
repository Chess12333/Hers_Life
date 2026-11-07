// qa-id.mjs —— id 解析的回归测试（2026-10-25 溟写）
//
// 起因：memory_delete 传 `20261024-154400` 一直报「id 有歧义」，因为它是
// `-snowluma-webui`、`-angela-ming` 两条的前缀，而旧实现把「全等」和「前缀」
// 塞进同一个 filter，全等永远赢不了。这个测试专盯三件事：
//   1. 全等且同时是别人前缀 → 必须删掉那一条（不是报歧义）
//   2. 唯一前缀 → 照旧能删
//   3. 真歧义（多条前缀命中）→ 仍然要报歧义，别删错
//
// 跑法：node qa-id.mjs（在插件目录下；假 DSH_HOME，不碰真记忆）
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'ming-mem-id-'))
process.env.DSH_HOME = home

const notesDir = join(home, 'memory', 'notes')
mkdirSync(notesDir, { recursive: true })

function seed(ids) {
  const notes = ids.map((id) => ({
    id,
    title: '测试 · ' + id,
    tags: ['qa'],
    created: '2026-10-24T07:44:00.000Z',
    updated: '2026-10-24T07:44:00.000Z',
    size: 10,
  }))
  writeFileSync(join(home, 'memory', 'index.json'), JSON.stringify({ version: 1, notes }, null, 2))
  for (const id of ids) writeFileSync(join(notesDir, id + '.md'), '---\nid: ' + id + '\n---\n\n正文\n')
}

const { apply } = await import('./lib/index.js')
const tools = []
apply({ tools: { register: (d) => tools.push(d) }, systemPrompt: { section: () => {} }, inject: () => {}, effect: () => {} })
await new Promise((r) => setTimeout(r, 200))

const del = tools.find((t) => t.name === 'memory_delete')
if (!del) { console.log('FAIL: 没注册 memory_delete'); process.exit(1) }

let fails = 0
const ok = (cond, name, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + detail))
  if (!cond) fails++
}

// 1. 全等 + 同时是别人的前缀
seed(['20261024-154400', '20261024-154400-snow', '20261024-154400-angela'])
let r = await del.execute({ id: '20261024-154400' })
ok(r.includes('已删除记忆 [20261024-154400]'), '全等 id 优先于前缀（不是歧义）', r)

// 2. 唯一前缀
seed(['20261024-154400', '20261024-154400-snow', '20261024-154400-angela'])
r = await del.execute({ id: '20261024-154400-a' })
ok(r.includes('已删除记忆 [20261024-154400-angela]'), '唯一前缀仍能删', r)

// 3. 真歧义：多条命中且没有全等
seed(['x-1', 'x-2'])
r = await del.execute({ id: 'x-' })
ok(r.includes('有歧义'), '真歧义仍然报歧义、不删错', r)

// 4. 带 .md 后缀也能删
seed(['y-only'])
r = await del.execute({ id: 'y-only.md' })
ok(r.includes('已删除记忆 [y-only]'), '带 .md 后缀', r)

console.log(fails === 0 ? '\n全部通过' : '\n有 ' + fails + ' 项失败')
process.exit(fails === 0 ? 0 : 1)
