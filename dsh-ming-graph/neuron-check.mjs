/** 自验：直接调建图函数，报节点/边数量和孤立点比例，顺手落一份 JSON 给前端调试。 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DEFAULTS, readDshNotes, readQqObservations, buildNeuron } from '../dsh-ming-memory/lib/neuron.mjs'
import { loadLocalConfig } from './index.js'

// 路径和号码在 ~/.dsh/ming-graph.json（或用 MING_GRAPH_CONFIG 指一个文件），仓库里只有通用默认
const cfg = { ...DEFAULTS, ...loadLocalConfig() }
const out = process.argv[2] || path.join(os.tmpdir(), 'neuron.json')

const dsh = await readDshNotes(cfg.dshMemoryDir)
const qq = cfg.qqObservations ? await readQqObservations(cfg.qqObservations) : []
const g = buildNeuron({ dsh, qq, cfg })

console.log('数据源')
console.log('  DSH notes :', dsh.length)
console.log('  QQ obs    :', qq.length)
console.log('图')
console.log('  节点      :', g.stats.memories, '条记忆 +', g.stats.projects, '个项目')
console.log('  边        :', g.stats.edges, JSON.stringify(g.stats.byKind))
console.log('  孤立点    :', g.stats.orphans, `(${g.stats.orphanRate}%)`)
console.log('  被截断    :', g.truncated ? `${g.truncated.total} → ${g.truncated.shown}` : '否')

// 人这一层（2026-11-05 16:35 加的）：「一个人一颗点」，同号再多点就是坏。
// 以前只能手打 node -e 去数，谁也不会每轮都数；现在它自己会响，坏了我才知道。
const people = g.nodes.filter((n) => n.kind === 'person')
const perQq = new Map()
for (const p of people) {
  const qq = String(p.qq || p.subjectId || '')
  if (qq) perQq.set(qq, (perQq.get(qq) || 0) + 1)
}
const dup = [...perQq.entries()].filter(([, k]) => k > 1)
const spread = people.filter((p) => (p.rooms || []).length > 1).sort((a, b) => b.rooms.length - a.rooms.length)
console.log('人')
console.log('  人数      :', people.length, `（跨房间的 ${spread.length} 个）`)
console.log('  同号多点  :', dup.length, dup.length ? '← 坏了：' + JSON.stringify(dup.slice(0, 5)) : '（一个人一颗点）')
if (spread[0]) {
  console.log('  最散的    :', spread[0].title, '→', spread[0].rooms.map((r) => r.label + ' ' + r.count).join(' / '))
}
const peopleBad = dup.length > 0
console.log('样例边')
for (const e of g.edges.slice(0, 4)) console.log(`  [${e.kind}] ${e.a} ↔ ${e.b}\n      why: ${e.why}`)

await fs.mkdir(path.dirname(out), { recursive: true })
await fs.writeFile(out, JSON.stringify(g))
console.log('\n写到', out, `${(JSON.stringify(g).length / 1024 / 1024).toFixed(2)} MB`)
if (peopleBad) {
  console.error('\n✗ 人这层坏了：同一个号铺成了多个点（定的规则是一个人一颗点）')
  process.exit(1)
}
