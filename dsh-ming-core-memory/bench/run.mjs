/**
 * 对照跑：朴素 BM25（下限） vs 我的 memory_search（现状） vs 带 include_retired。
 *   node bench/run.mjs [--json]
 *
 * 只读真记忆库。三臂吃同一份语料、同一批题、同一套判据。
 * 判据只有三条，都能从输出里数出来：
 *   1. 正解在不在前 1 / 前 3 / 前 5（主列表里的排名，不含「关联」和隐藏段）
 *   2. 现行口径题：输出里有没有把旧的那条标成旧的（⚠ 已被取代 / 并入 / 现行口径）
 *   3. 每题耗时 + 返回字数（成本代理）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { buildBm25 } from './naive-bm25.mjs';
import { questions, staleIds, corpusNote } from './questions.mjs';

const home = process.env.DSH_HOME || join(homedir(), '.dsh');
const memDir = join(home, 'memory');

// ---------- 语料 ----------
const index = JSON.parse(readFileSync(join(memDir, 'index.json'), 'utf8'));
const docs = index.notes.map((n) => {
  let body = '';
  try { body = readFileSync(join(memDir, 'notes', n.id + '.md'), 'utf8'); } catch { body = ''; }
  body = body.replace(/^---[\s\S]*?\n---\n/, '');
  return { id: n.id, title: n.title, tags: n.tags || [], body, status: n.status };
});

// ---------- 我的检索（走真插件、真工具实现） ----------
process.env.DSH_HOME = home;
const { apply } = await import('../lib/index.js');
const tools = {};
apply({
  tools: { register: (d) => { tools[d.name] = d; } },
  systemPrompt: { section: () => {} },
  inject: () => {}, effect: () => {},
});
await new Promise((r) => setTimeout(r, 30)); // 等 bootstrap 的 enqueue

/** 从 memory_search 的文本里取出主列表的 id（顶格 [id] 开头那几行）与标记。 */
function parseMine(text) {
  const mainPart = text.split('关联（')[0].split('另有 ')[0];
  const ids = [];
  for (const line of mainPart.split('\n')) {
    const m = /^\[(\d{8,}[^\]]*)\]/.exec(line);
    if (m) ids.push(m[1]);
  }
  const related = [];
  const relPart = (text.split('关联（')[1] || '').split('另有 ')[0];
  for (const line of relPart.split('\n')) {
    const m = /^- \[(\d{8,}[^\]]*)\]/.exec(line);
    if (m) related.push(m[1]);
  }
  return {
    ids, related,
    marks: /已被 \[[^\]]+\]「[^」]*」取代|已并入 \[|现行口径/.test(text),
    chars: text.length,
  };
}

const bm = buildBm25(docs);

// ---------- 跑 ----------
const rows = [];
for (const q of questions) {
  const t0 = process.hrtime.bigint();
  const b = bm.search(q.q, 5);
  const bMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const t1 = process.hrtime.bigint();
  const mineText = await tools.memory_search.execute({ query: q.q, limit: 5 });
  const mineMs = Number(process.hrtime.bigint() - t1) / 1e6;
  const mine = parseMine(mineText);

  const t2 = process.hrtime.bigint();
  const retiredText = await tools.memory_search.execute({ query: q.q, limit: 5, include_retired: true });
  const retiredMs = Number(process.hrtime.bigint() - t2) / 1e6;
  const ret = parseMine(retiredText);

  const rank = (ids) => {
    for (let i = 0; i < ids.length; i++) if (q.expected.includes(ids[i])) return i + 1;
    return 0;
  };
  const stale = staleIds[q.id] || [];
  const flagsStale = (text) => stale.length > 0 && stale.every((id) => text.includes(id)) &&
    /已被 \[|已并入 \[|现行口径/.test(text);

  rows.push({
    ...q,
    bm25StaleRank: (() => { const st = staleIds[q.id] || []; for (let i = 0; i < b.ids.length; i++) if (st.includes(b.ids[i])) return i + 1; return 0; })(),
    mineStaleRank: (() => { const st = staleIds[q.id] || []; for (let i = 0; i < mine.ids.length; i++) if (st.includes(mine.ids[i])) return i + 1; return 0; })(),
    bm25: { rank: rank(b.ids), ms: bMs, chars: b.ids.length * 90 },
    mine: { rank: rank(mine.ids), ms: mineMs, chars: mine.chars, related: mine.related.length, marks: mine.marks },
    ret: { rank: rank(ret.ids), ms: retiredMs, chars: ret.chars },
    staleOk: { mine: flagsStale(mineText), ret: flagsStale(retiredText) },
  });
}

// ---------- 出表 ----------
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

console.log('语料：' + corpusNote.replace('语料 = ', '') + ' —— ' + docs.length + ' 条，BM25 建索引 ' + r1(bm.buildMs) + ' ms');
console.log('');
console.log(pad('题', 4) + pad('类', 3) + pad('BM25', 6) + pad('AI', 6) + pad('AI+旧', 7) + pad('BM25 ms', 9) + pad('AI ms', 8) + '  问法');
console.log('-'.repeat(96));
for (const x of rows) {
  console.log(
    pad(x.id, 4) + pad(x.cls, 3) +
    pad(x.bm25.rank || '—', 6) + pad(x.mine.rank || '—', 6) + pad(x.ret.rank || '—', 7) +
    padL(r1(x.bm25.ms), 9) + padL(r1(x.mine.ms), 8) + '  ' + x.q,
  );
}

const stat = (arm) => {
  const hit = (k) => rows.filter((x) => x[arm].rank > 0 && x[arm].rank <= k).length;
  const mrr = rows.reduce((a, x) => a + (x[arm].rank ? 1 / x[arm].rank : 0), 0) / rows.length;
  const ms = rows.map((x) => x[arm].ms).sort((a, b) => a - b);
  const chars = Math.round(rows.reduce((a, x) => a + x[arm].chars, 0) / rows.length);
  return { h1: hit(1), h3: hit(3), h5: hit(5), mrr, ms: ms[Math.floor(ms.length / 2)], chars };
};
const arms = [['朴素 BM25', 'bm25'], ['AI（默认）', 'mine'], ['AI（含旧）', 'ret']];
console.log('');
console.log(pad('臂', 12) + pad('命中@1', 8) + pad('@3', 6) + pad('@5', 6) + pad('MRR', 7) + pad('中位耗时', 10) + '每题返回字数');
console.log('-'.repeat(96));
for (const [label, key] of arms) {
  const s = stat(key);
  console.log(pad(label, 12) + pad(s.h1 + '/' + rows.length, 8) + pad(s.h3 + '/' + rows.length, 6) + pad(s.h5 + '/' + rows.length, 6) +
    pad(s.mrr.toFixed(3), 7) + pad(r1(s.ms) + ' ms', 10) + s.chars);
}

console.log('');
for (const cls of ['A', 'B', 'C']) {
  const sub = rows.filter((x) => x.cls === cls);
  if (!sub.length) continue;
  const line = arms.map(([label, key]) => label + ' ' + sub.filter((x) => x[key].rank > 0 && x[key].rank <= 5).length + '/' + sub.length).join('   ');
  console.log('按类 ' + cls + '（' + sub.length + ' 题，命中@5）：' + line);
}
// C 类唯一要看的：库里躺着一条旧的，谁把「这条已经作废」说出来。
// BM25 没有状态这个概念——它能把旧的那条排上来，也可能排上来，但它不会说哪条是旧的。
const cRows = rows.filter((x) => x.cls === 'C' && (staleIds[x.id] || []).length);
if (cRows.length) {
  console.log('现行口径题（库里有一条旧的）：');
  for (const x of cRows) {
    const stale = staleIds[x.id];
    const rankOf = (ids) => { for (let i = 0; i < ids.length; i++) if (stale.includes(ids[i])) return i + 1; return 0; };
    console.log('  ' + x.id + '  旧条目排名：BM25=' + (x.bm25StaleRank || '—') + '  AI=' + (x.mineStaleRank || '—') +
      '   标出新旧：AI默认=' + (x.staleOk.mine ? '标了' : '没标') + ' AI+旧=' + (x.staleOk.ret ? '标了' : '没标'));
  }
}
if (process.argv.includes('--json')) {
  console.log('\n' + JSON.stringify(rows.map((x) => ({ id: x.id, cls: x.cls, bm25: x.bm25.rank, mine: x.mine.rank, ret: x.ret.rank, related: x.mine.related, marks: x.mine.marks })), null, 1));
}
