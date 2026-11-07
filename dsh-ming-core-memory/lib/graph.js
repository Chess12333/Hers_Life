/**
 * 归档记忆的「关系层」——从 dsh-soul 2.0（github.com/icyaaaww/dsh-soul）搬过来的那一半。
 *
 * 原版两条：
 *   1. 新记忆替换旧事实：旧的写 `valid_to`，不删。判据 =「新的说它替换了什么」+「两条说的是同一个东西」。
 *   2. 沿关系回捞：命中当种子，顺着关联边扩散（propagate）。
 *
 * 我们这边的实况：73 条记忆是平铺的 md，除了 supersedes 一个字段之外没有任何边，
 * 所以「旧口径和新口径同时躺在场里」不是判断力问题，是**没东西可区分**。
 *
 * 一处**没照搬**：原版按「共享稀有词」连边，我们的记忆一条 1–2 KB，中文二字切词下
 * 共享的稀有词全是 noise（实测：`web_search 401` 被连到 `WSL 2.7 空闲`，via 用户/与/反复）。
 * 他们的节点是一条一句的短 claim，同样的判据在那里才成立。所以这里只认**标识符**：
 * 路径、文件名、snake_case、IP、#命令。共享一个标识符 = 讲的是同一个东西。
 *
 * 不写盘、不调模型：每次检索时从现有 index.json + 正文现算，可测（qa-graph.mjs）。
 */

const IDENTIFIERS = [
  /[A-Za-z]:\\[^\s"'`,;)\]]+/g, // C:\dsh\x.mjs
  /(?:^|[\s(`"'])((?:\/[A-Za-z0-9_.-]+){2,})/g, // /a/b/c
  /\b[a-z0-9][\w.-]*\.(?:mjs|js|cjs|ts|py|ps1|json|ya?ml|md|bat|cmd|sh|exe)\b/gi, // 文件名
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, // snake_case（工具名、字段名）
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, // IP[:端口]
  /(?<=^|[\s（(])#[A-Za-z]{1,8}\b/g, // #SL 这类命令
];

/** 抽出这条记忆里「猜不出来、必须同一个东西才会有」的标识符。 */
export function identifiers(text) {
  const s = String(text ?? '');
  const out = new Set();
  for (const re of IDENTIFIERS) {
    for (const m of s.matchAll(re)) {
      const raw = (m[1] ?? m[0]).replace(/[.。,;:]+$/, '').toLowerCase().replaceAll('\\', '/');
      if (raw.length < 3) continue;
      out.add(raw);
    }
  }
  return out;
}

/** 中文二字切词——只给「冲突候选」和「片段」用，不拿它连边。 */
export function terms(text, cap = 200) {
  const s = String(text ?? '').normalize('NFKC').toLowerCase();
  const words = s.match(/[a-z0-9_]{2,}/g) ?? [];
  for (const span of s.match(/[\p{Script=Han}]+/gu) ?? []) {
    if (span.length === 1) words.push(span);
    else for (let i = 0; i < span.length - 1; i++) words.push(span.slice(i, i + 2));
  }
  return [...new Set(words)].slice(0, cap);
}

/** 新文本在宣称「我替换了什么」。只认明确的替换词，宁漏不错。 */
export const REPLACES = /(?:改成|改用|换成|变为|不再|不用|改掉|作废|废弃|取代|替换|纠正|更正|推翻|而不是|instead|switch(?:ed)? to|no longer|replace)/i;

const DAY_TAG = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 从一堆记忆建图。
 * notes: [{id, title, tags, created, status, supersedes, superseded_by, body}]
 * → { byId, list, edges }
 */
export function buildGraph(notes) {
  const byId = new Map();
  const list = [];
  for (const n of notes) {
    const tags = (n.tags || []).filter((t) => !DAY_TAG.test(String(t)));
    const ids = identifiers((n.title || '') + '\n' + tags.join(' ') + '\n' + (n.body || ''));
    const entry = { ...n, ids };
    byId.set(n.id, entry);
    list.push(entry);
  }

  const edges = [];
  const seen = new Set();
  const push = (src, dst, rel, w, via) => {
    const key = src + '>' + dst + '>' + rel;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ src, dst, rel, w, via });
  };

  // 取代链：新 → 旧。这不是「关联」，扩散时要单独走（被替换的东西不该显得中心）。
  for (const n of list) {
    if (n.supersedes && byId.has(n.supersedes)) push(n.id, n.supersedes, 'supersedes', 1, []);
    if (n.superseded_by && byId.has(n.superseded_by)) push(n.superseded_by, n.id, 'supersedes', 1, []);
  }

  // 标识符倒排：一个标识符出现在哪几条里
  const postings = new Map();
  for (const n of list) for (const id of n.ids) {
    if (!postings.has(id)) postings.set(id, []);
    postings.get(id).push(n.id);
  }
  // 只出现在一条记忆里的标识符连不出边；出现在太多条里的（比如 C:/dsh 这种根、index.js）
  // 也不该算强链接——共享它的两条记忆未必在讲同一件事。权重按 IDF 给：越少见越算数。
  const hubCeiling = Math.max(5, Math.round(list.length * 0.12));
  const n = Math.max(2, list.length);
  for (const [id, ids] of postings) {
    if (ids.length < 2 || ids.length > hubCeiling) continue;
    const w = Math.log(1 + n / ids.length) / Math.log(1 + n); // df=2 → .84, df=5 → .64, df=8 → .53
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [src, dst] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        push(src, dst, 'related', Math.round(w * 100) / 100, [id]);
      }
    }
  }
  // 合并同一对记忆之间的多条标识符：共享越多越强（但封顶 1，别让一对记忆吃掉排序）
  const merged = new Map();
  for (const e of edges) {
    if (e.rel !== 'related') continue;
    const key = e.src + '>' + e.dst;
    const prev = merged.get(key);
    if (!prev) merged.set(key, { ...e });
    else {
      prev.via = [...new Set([...prev.via, ...e.via])].slice(0, 3);
      prev.w = Math.min(1, Math.round((prev.w + e.w * 0.5) * 100) / 100);
    }
  }
  return {
    byId, list,
    edges: edges.filter((e) => e.rel === 'supersedes').concat([...merged.values()]),
  };
}

/**
 * 沿关联边扩散一趟。种子是检索命中的那几条，一跳之外的按「边权 × 衰减」排队。
 * 两跳在这里不划算：73 条记忆的图太密，走远了每条都连得上，排序就没信息了。
 */
export function expand(seeds, graph, { decay = 0.6, limit = 3, floor = 0.6 } = {}) {
  const seedIds = new Set(seeds.map((s) => s.id));
  const top = Math.max(1, ...seeds.map((s) => s.score));
  const base = new Map(seeds.map((s) => [s.id, s.score / top])); // 归一：别让一个高分种子吃掉全部名额
  const scored = new Map();
  for (const e of graph.edges) {
    if (e.rel === 'supersedes') continue;
    if (e.w < floor) continue;
    let from = null, to = null;
    if (seedIds.has(e.src)) { from = e.src; to = e.dst; }
    else if (seedIds.has(e.dst)) { from = e.dst; to = e.src; }
    if (!from || seedIds.has(to)) continue;
    const s = (base.get(from) || 1) * e.w * decay;
    const prev = scored.get(to);
    if (!prev || prev.score < s) scored.set(to, { id: to, score: s, from, via: e.via });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 取代链的两个方向：它取代了谁（前因）、谁取代了它（后果）。 */
export function chainOf(id, graph) {
  const prev = [];
  const next = [];
  for (const e of graph.edges) {
    if (e.rel !== 'supersedes') continue;
    if (e.src === id && graph.byId.has(e.dst)) prev.push(graph.byId.get(e.dst));
    if (e.dst === id && graph.byId.has(e.src)) next.push(graph.byId.get(e.src));
  }
  return { prev, next };
}

function head(body, n = 70) {
  const flat = String(body || '').replace(/^\s*---[\s\S]*?---\s*/, '').replace(/\s+/g, ' ').trim();
  return flat.slice(0, n) + (flat.length > n ? '…' : '');
}

/** 合并条目的 merged_from（index.json 里是数组，老文件里可能没有）。 */
export function mergedIds(note) {
  const v = note && note.merged_from;
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * 一行一句：把前因后果写成人话，而不是再给一个 id 让人自己跳。
 * 2026-11-03：合并（memory_merge）也走 superseded 这一条链，但它不是改口——
 * 所以并进事件的那几条不许写「旧口径」，写「并入」。改口径和并碎片是两件事，
 * 混成一个词之后，读到的人会以为结论被推翻过。
 */
export function describeChain(id, graph, { withHead = true } = {}) {
  const { prev, next } = chainOf(id, graph);
  const mine = mergedIds(graph.byId.get(id));
  const lines = [];
  for (const old of prev) {
    const when = old.created ? '（' + String(old.created).slice(0, 10) + '）' : '';
    if (mine.indexOf(old.id) >= 0) {
      lines.push('  并入：同一件事的一片 [' + old.id + ']「' + old.title + '」' + when +
        (withHead ? '——原话：' + head(old.body) : ''));
    } else {
      lines.push('  起因：本条取代 [' + old.id + ']「' + old.title + '」' + when +
        (withHead ? '——旧口径：' + head(old.body) : ''));
    }
  }
  for (const live of next) {
    const when = live.created ? '（' + String(live.created).slice(0, 10) + '）' : '';
    if (mergedIds(live).indexOf(id) >= 0) {
      lines.push('  ⚠ 这条已并入 [' + live.id + ']「' + live.title + '」' + when +
        '——同一件事的碎片，结论没变' + (withHead ? '；事件条目里的原话：' + head(live.body) : ''));
    } else {
      lines.push('  ⚠ 这条已被 [' + live.id + ']「' + live.title + '」取代' + when +
        (withHead ? '——现行口径：' + head(live.body) : ''));
    }
  }
  return lines;
}

/**
 * 写入前的冲突扫描：新文本说「我换了」，库里还躺着讲同一个东西的活条目 → 把候选交出来。
 *
 * 原版直接给旧条目写 valid_to（自动作废）。这里不自动：误判一次就把一条还活着的约束藏起来，
 * 比留一条过期的更糟。所以只报警，由写的人决定要不要把 supersedes 填上。
 * 判据同原版：共享标识符，或者共享 ≥3 个稀有词。
 */
export function conflictCandidates(text, graph, { limit = 3 } = {}) {
  const claim = String(text ?? '');
  if (claim.length < 6) return [];
  const ownIds = identifiers(claim);
  const own = new Set(terms(claim, 200));
  const freq = new Map();
  for (const n of graph.list) {
    for (const t of new Set(terms(n.title + ' ' + (n.body || ''), 160))) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const floor = Math.max(2, Math.round(graph.list.length * 0.12));
  const scored = [];
  for (const n of graph.list) {
    if (n.status && n.status !== 'active' && n.status !== 'candidate') continue;
    const sharedIds = [...ownIds].filter((id) => n.ids.has(id));
    const sharedTerms = [...new Set(terms(n.title + ' ' + (n.body || ''), 160))].filter(
      (t) => own.has(t) && (freq.get(t) ?? 1) <= floor,
    );
    if (!sharedIds.length && sharedTerms.length < 3) continue;
    scored.push({
      id: n.id, title: n.title, created: n.created,
      shared: (sharedIds.length ? sharedIds : sharedTerms).slice(0, 4),
      byId: sharedIds.length > 0,
    });
  }
  scored.sort((a, b) => (b.byId ? 1 : 0) - (a.byId ? 1 : 0) || b.shared.length - a.shared.length);
  return scored.slice(0, limit);
}
