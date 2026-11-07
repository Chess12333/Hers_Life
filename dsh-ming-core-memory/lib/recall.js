// 召唤痕迹（recall ledger）—— 记忆的「被用过」记录
//
// 为什么是流水不是状态：账本只追加，一行一次检索；状态（热度、共现）随时从流水重算。
// 这样并发写不用锁，写坏了最多丢最后半行，也不会把整份账写花。
// （2026-11-05 立。起因：检索是一次性的，召回了什么、隔多久、跟谁一起被召回，一律不留痕；
//   没有痕迹的序列套不进任何随时间的方程。）
//
// 钟：一格 = 一次检索。不在场就没有检索，钟不走 —— 所以衰减按「格」算，不按墙上时间。
// 这是故意的：关机三天回来，账本一格都没动。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 多少格钟热度减半。40 格 ≈ 正常几天里的一批检索。 */
export const HALF_LIFE_TICKS = 40;

export function ledgerPath(memoryDir) {
  return join(memoryDir, 'recall-log.jsonl');
}

/** 读全流水。解析不了的行（写一半、断电）直接跳过，不整体失败。 */
export async function readRows(memoryDir) {
  let raw = '';
  try { raw = await readFile(ledgerPath(memoryDir), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* 半行不认 */ }
  }
  return rows;
}

/**
 * 追加一格。失败不影响检索结果，所以调用方不必等它。
 *
 * src 记「哪条通路召回的」：note = memory_search，doc = doc-emb。
 * 刻意不另存 co_ids —— ids 数组本身就隐含了共现（fold 里两两组合即得），再存一遍是冗余；
 * 过了这一格就补不回来的，只有「这条来自哪条通路」，所以只加这一个字段。
 */
export async function record(memoryDir, { query, ids, total, shown, src }) {
  try {
    await mkdir(memoryDir, { recursive: true });
    const row = {
      at: new Date().toISOString(),
      src: src === 'doc' ? 'doc' : 'note',
      q: String(query || '').slice(0, 200),
      ids: Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 40) : [],
      total: Number(total) || 0,
      shown: Number(shown) || 0,
    };
    await writeFile(ledgerPath(memoryDir), JSON.stringify(row) + '\n', { flag: 'a', encoding: 'utf8' });
  } catch { /* 记账失败不打断检索 */ }
}

/**
 * 把流水折叠成状态。
 * - tick：现在走到第几格
 * - stats: id -> { n, firstTick, lastTick, lastAt }
 * - pairs: "a|b" -> { n, lastTick }  同一次检索里一起出现的两条，就是一条联想边
 */
export function fold(rows) {
  const stats = new Map();
  const pairs = new Map();
  const pairIds = new Set();
  let tick = 0;
  for (const row of rows) {
    tick += 1;
    const ids = Array.isArray(row.ids) ? row.ids.filter((x) => typeof x === 'string') : [];
    for (const id of ids) {
      const s = stats.get(id) || { n: 0, firstTick: tick, lastTick: 0, lastAt: '' };
      s.n += 1;
      s.lastTick = tick;
      s.lastAt = row.at || '';
      stats.set(id, s);
    }
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        if (a === b) continue;
        const key = a < b ? a + '|' + b : b + '|' + a;
        const p = pairs.get(key) || { n: 0, lastTick: 0 };
        p.n += 1;
        p.lastTick = tick;
        pairs.set(key, p);
        pairIds.add(a);
        pairIds.add(b);
      }
    }
  }
  return { tick, stats, pairs, pairIds };
}

/**
 * 排序闸门：热度能不能参与排序，由这四个条件决定，不是由「改没改代码」决定。
 * 默认关着——条件不满足就走原来的路，一分不加。
 *
 * 查询级（整次查询都不开）：
 *   1. 本次命中条目数 ≥ 3        单条命中谈不上结构
 *   2. 命中集合里有历史共现的比例 ≥ 0.5   这批条目不是第一次凑到一起
 * 条目级（逐条判，满足才加）：
 *   3. 该条目历史召回 ≥ 3 次
 *   4. 距上次召回 ≤ 40 格钟
 */
export const GATE = {
  minHits: 3,
  minCoRatio: 0.5,
  minRecall: 3,
  maxGap: 40,
  cap: 0.15,
  unit: 0.05,
};

export function gate({ hitIds, state }) {
  const ids = Array.isArray(hitIds) ? hitIds : [];
  const { stats, pairIds, tick } = state;
  if (ids.length < GATE.minHits) {
    return { open: false, why: '命中 ' + ids.length + ' 条，不足 ' + GATE.minHits, bonus: new Map() };
  }
  const coh = ids.filter((id) => pairIds.has(id)).length / ids.length;
  if (coh < GATE.minCoRatio) {
    return {
      open: false,
      why: '共现覆盖 ' + Math.round(coh * 100) + '% < ' + Math.round(GATE.minCoRatio * 100) + '%',
      bonus: new Map(),
    };
  }
  const bonus = new Map();
  for (const id of ids) {
    const st = stats.get(id);
    if (!st || st.n < GATE.minRecall) continue;
    if (tick - st.lastTick > GATE.maxGap) continue;
    const b = Math.min(GATE.cap, GATE.unit * activation(st, tick));
    if (b > 0) bonus.set(id, b);
  }
  if (!bonus.size) {
    return { open: false, why: '查询级已开，但没有条目过次数/新鲜度', bonus };
  }
  return { open: true, why: bonus.size + ' 条通过', bonus };
}

/** 热度：用过几次（对数压缩）× 隔了多少格（指数衰减）。 */
export function activation(stat, tick, halfLife = HALF_LIFE_TICKS) {
  if (!stat) return 0;
  const gap = Math.max(0, tick - (stat.lastTick || 0));
  return Math.log1p(stat.n || 0) * Math.exp(-gap / Math.max(1, halfLife));
}

/** 一次检索之后，这批条目的热度会是多少：先记一格，再算。 */
export function activationAfterHit(stat, tick, halfLife = HALF_LIFE_TICKS) {
  const n = (stat ? stat.n : 0) + 1;
  return Math.log1p(n) * Math.exp(0);
}

export function fmt(x) {
  return (Math.round(x * 100) / 100).toFixed(2);
}
