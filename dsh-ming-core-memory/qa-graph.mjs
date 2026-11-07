/**
 * 自测：拿真实索引跑一遍图，不打网络、不写盘。
 *   node qa-graph.mjs
 * 看四件事：图建得出来、边像不像话、检索命中能扩出邻居、取代链能读出前因后果。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph, expand, describeChain, conflictCandidates, identifiers, REPLACES } from './lib/graph.js';

const home = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
const dir = join(home, 'memory', 'notes');
const idx = JSON.parse(readFileSync(join(home, 'memory', 'index.json'), 'utf8')).notes;

const stripFront = (t) => {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(t);
  return m ? t.slice(m[0].length) : t;
};
const notes = idx.map((n) => {
  let body = '';
  try { body = stripFront(readFileSync(join(dir, n.id + '.md'), 'utf8')); } catch {}
  return { ...n, body };
});

const g = buildGraph(notes);
const related = g.edges.filter((e) => e.rel === 'related');
const rule = g.edges.filter((e) => e.rel === 'supersedes');
console.log(`notes=${notes.length} edges=${g.edges.length} (related=${related.length} supersedes=${rule.length})`);
const deg = new Map();
for (const e of related) { deg.set(e.src, (deg.get(e.src) || 0) + 1); deg.set(e.dst, (deg.get(e.dst) || 0) + 1); }
console.log(`有邻居的记忆=${deg.size}/${notes.length} 孤立=${notes.length - deg.size} 最高度=${Math.max(0, ...deg.values())}`);
const pairKey = (e) => [e.src, e.dst].sort().join('|');
const degree = new Map();
for (const e of related) for (const id of [e.src, e.dst]) degree.set(id, (degree.get(id) || 0) + 1);
console.log('\n边样例（按共享标识符数排序）：');
for (const e of [...related].sort((a, b) => b.w - a.w).slice(0, 8)) {
  console.log(`  ${g.byId.get(e.src)?.title.slice(0, 20)} ‖ ${g.byId.get(e.dst)?.title.slice(0, 20)}  via=${e.via.join(' + ')} w=${e.w}`);
}

function score(note, q) {
  const t = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const k of t) {
    if ((note.title || '').toLowerCase().includes(k)) s += 3;
    if ((note.tags || []).join(' ').toLowerCase().includes(k)) s += 3;
    const body = (note.body || '').toLowerCase();
    let i = body.indexOf(k), c = 0;
    while (i >= 0 && c < 50) { s += 1; c++; i = body.indexOf(k, i + k.length); }
  }
  return s;
}

for (const q of ['记忆 注入', 'QQ 出站', '蒸馏', '收图']) {
  const hits = g.list.map((n) => ({ id: n.id, score: score(n, q) })).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
  const ex = expand(hits, g);
  console.log(`\nquery「${q}」 hits=${hits.length} → 扩散 ${ex.length} 条`);
  for (const x of ex) console.log(`   → [${x.id.slice(-14)}] ${g.byId.get(x.id)?.title.slice(0, 26)} (来自 ${x.from.slice(-14)}, via ${x.via.join(',')})`);
}

console.log('\n取代链：');
for (const n of notes.filter((x) => x.superseded_by || x.supersedes)) {
  console.log(` [${n.id.slice(-16)}] ${n.title.slice(0, 30)}`);
  for (const l of describeChain(n.id, g)) console.log(l);
}

console.log('\n冲突扫描：');
const sample = '这条取代出站箱旧口径：改成回查 OneBot 历史，不再看 message_id 正负';
console.log(`  REPLACES = ${REPLACES.test(sample)}；标识符 = ${[...identifiers('scripts/qq-send-verify.mjs 与 memory_write 都改了')].join(', ')}`);
for (const c of conflictCandidates(sample, g)) {
  console.log(`   候选 [${c.id.slice(-20)}] ${c.title.slice(0, 34)} shared=${c.shared.join(',')}${c.byId ? ' (同标识符)' : ''}`);
}
console.log('\nOK');
