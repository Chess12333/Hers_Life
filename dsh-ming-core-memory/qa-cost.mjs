/**
 * 量一次「关系层」的代价：同样的查询，新版比旧版多花多少字、多少毫秒。
 *   node qa-cost.mjs
 * 记忆插件每次检索都会读全库建图，这笔账要能说清；说不清就不该留在里面。
 */
import { performance } from 'node:perf_hooks';

async function loadTools(modPath) {
  const mod = await import(modPath);
  const tools = {};
  mod.apply({
    tools: { register: (d) => { tools[d.name] = d; } },
    systemPrompt: { section: () => {} },
    inject: () => {},
    effect: () => {},
  });
  return tools;
}

const now = await loadTools('./lib/index.js');
const before = await loadTools('./bench/old-index.mjs');

const queries = [
  '出站 判据',
  '记忆 注入',
  '蒸馏 群聊',
  'docker snowluma',
  'B站 字幕',
  '收图 rkey',
];

const rows = [];
for (const q of queries) {
  const t0 = performance.now();
  const a = await before.memory_search.execute({ query: q, limit: 8 });
  const t1 = performance.now();
  const b = await now.memory_search.execute({ query: q, limit: 8 });
  const t2 = performance.now();
  rows.push({ q, oldChars: a.length, newChars: b.length, oldMs: t1 - t0, newMs: t2 - t1 });
}

let sumOld = 0, sumNew = 0;
console.log('query'.padEnd(18), '字数 旧→新'.padEnd(18), 'ms 旧→新');
for (const r of rows) {
  sumOld += r.oldChars; sumNew += r.newChars;
  console.log(r.q.padEnd(18), (r.oldChars + ' → ' + r.newChars).padEnd(18), r.oldMs.toFixed(0) + ' → ' + r.newMs.toFixed(0));
}
console.log(`\n合计字数 ${sumOld} → ${sumNew}（+${sumNew - sumOld}，${((sumNew / sumOld - 1) * 100).toFixed(0)}%）`);
console.log(`平均耗时 旧 ${(rows.reduce((s, r) => s + r.oldMs, 0) / rows.length).toFixed(0)}ms / 新 ${(rows.reduce((s, r) => s + r.newMs, 0) / rows.length).toFixed(0)}ms`);
