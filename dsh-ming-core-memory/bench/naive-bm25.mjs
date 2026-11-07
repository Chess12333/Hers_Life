// 朴素 BM25 —— 「零智能」的下限基线。
// 没有标题加权、没有标签、没有状态过滤、没有关系层，只数词。
// 分词：ASCII 词 + 中文 bigram（中文没有空格，bigram 是 BM25 在中文上最朴素又不作弊的切法）。

const CJK = /[\u4e00-\u9fff]/;

export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  // 先切出 ASCII 词
  for (const m of s.matchAll(/[a-z0-9][a-z0-9_.\-]*/g)) out.push(m[0]);
  // 再按连续汉字切 bigram
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) { out.push(run); continue; }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out.filter((t) => t && !/^[-_.]+$/.test(t));
}

export function buildBm25(docs, { k1 = 1.5, b = 0.75 } = {}) {
  const t0 = process.hrtime.bigint();
  const df = new Map();
  const items = docs.map((d) => {
    const text = [d.title, (d.tags || []).join(' '), d.body].join('\n');
    const toks = tokenize(text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { id: d.id, tf, len: toks.length };
  });
  const avgLen = items.reduce((a, x) => a + x.len, 0) / Math.max(1, items.length);
  const N = items.length;
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;

  function search(query, limit = 5) {
    const t1 = process.hrtime.bigint();
    const qt = [...new Set(tokenize(query))];
    const scored = [];
    for (const d of items) {
      let s = 0;
      for (const t of qt) {
        const f = d.tf.get(t);
        if (!f) continue;
        s += (idf.get(t) || 0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avgLen));
      }
      if (s > 0) scored.push({ id: d.id, score: s });
    }
    scored.sort((a, b2) => b2.score - a.score);
    const ms = Number(process.hrtime.bigint() - t1) / 1e6;
    return { ids: scored.slice(0, limit).map((x) => x.id), ms, chars: 0 };
  }
  return { search, buildMs, docs: N };
}
