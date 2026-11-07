/**
 * 自测 memory_merge：在临时 DSH_HOME 里真跑一遍写入 → 合并 → 检索。
 *   node qa-merge.mjs
 * 不碰真记忆库（DSH_HOME 指到临时目录，跑完删掉）。
 */
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = await mkdtemp(join(tmpdir(), 'ming-merge-qa-'));
process.env.DSH_HOME = home;

const { apply } = await import('./lib/index.js');
const tools = {};
const ctx = {
  tools: { register: (def) => { tools[def.name] = def; } },
  systemPrompt: { section: () => {} },
  inject: () => {},
  effect: () => {},
};
apply(ctx);

const fail = [];
const check = (label, ok, extra = '') => {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

if (!tools.memory_merge) { console.error('FAIL: memory_merge 没注册'); process.exit(1); }

// 三条散落的事实（模拟「同一件事散成好几条」）
const w1 = await tools.memory_write.execute({
  title: '出站箱串号：两个实例共用一个包（2026-11-02）',
  content: '浅水区的字从某个人的号发出去。原因：plugins 是包级目录，两个大脑扫同一个出站箱。',
  tags: ['出站箱', 'QA'], source: 'direct_observation',
});
const w2 = await tools.memory_write.execute({
  title: '出站箱串号的修法：认 QQ_AGENT_DATA_DIR',
  content: 'setup() 开头认一眼 QQ_AGENT_DATA_DIR，不是 data 就退出。改完要重启。',
  tags: ['出站箱', 'QA'], source: 'direct_observation',
});
const w3 = await tools.memory_write.execute({
  title: '5099 端口抢占：localhost 走了 IPv6',
  content: '撞进别人的 WebUI，改完敲 127.0.0.1:5099 才是自己的号。',
  tags: ['出站箱', 'QA'], source: 'direct_observation',
});
const id1 = /\[([^\]]+)\]/.exec(w1)[1];
const id2 = /\[([^\]]+)\]/.exec(w2)[1];
await tools.memory_write.execute({
  title: '不相干的一条', content: '番茄下载器的登录态在 App 里，不在 cookie 文件。', tags: ['杂项'],
});
const id3 = /\[([^\]]+)\]/.exec(w3)[1];

const before = await tools.memory_search.execute({ query: '出站箱 串号', limit: 5 });
check('合并前三条都能搜到', before.includes(id1) && before.includes(id2) && before.includes(id3));

// 合并前：一条 id 不够 → 拒绝
const one = await tools.memory_merge.execute({ title: '只给一条', ids: [id1] });
check('只给一条被拒', one.startsWith('合并失败'), one.slice(0, 20));

// 合并前：不存在的 id → 拒绝
const miss = await tools.memory_merge.execute({ title: 'x', ids: [id1, '不存在的-id'] });
check('不存在的 id 被拒', miss.startsWith('合并失败') && miss.includes('找不到'), miss.slice(0, 30));

// 真合并
const merged = await tools.memory_merge.execute({
  title: 'QQ-Agent 双实例串号（2026-11-02 一整件事）',
  ids: [id1, id2, id3],
  note: '现行口径：一个包装两个大脑，出站箱必须按 QQ_AGENT_DATA_DIR 分家；端口一律写 127.0.0.1，别写 localhost。',
  tags: ['出站箱', 'QA', '事件'],
});
console.log('--- memory_merge ---\n' + merged + '\n');
check('合并返回成功', merged.startsWith('已合并成') && merged.includes('3 条 → 1 条'));
const mergedId = /\[([^\]]+)\]/.exec(merged)[1];

// 索引落盘：新条目在、三条原文变 superseded
const index = JSON.parse(await readFile(join(home, 'memory', 'index.json'), 'utf8'));
const byId = Object.fromEntries(index.notes.map((n) => [n.id, n]));
check('新条目记了 merged_from', Array.isArray(byId[mergedId].merged_from) && byId[mergedId].merged_from.length === 3,
  JSON.stringify(byId[mergedId].merged_from));
check('三条原文变 superseded 且指向新条目',
  [id1, id2, id3].every((i) => byId[i].status === 'superseded' && byId[i].superseded_by === mergedId));
check('不相干的那条没被碰', Object.keys(byId).length === 5);

// 正文一个字没删
const oldFile = await readFile(join(home, 'memory', 'notes', id2 + '.md'), 'utf8');
check('原条目正文还在', oldFile.includes('QQ_AGENT_DATA_DIR') && oldFile.includes('merged_from') === false);

// 默认检索：碎片不再占位，事件条目顶上来
const after = await tools.memory_search.execute({ query: '出站箱 串号', limit: 5 });
console.log('--- 默认检索 ---\n' + after);
// 合并条目正文里本来就带着原 id 指针，所以不能拿「结果里有没有 id2」当判据；
// 判的是：主列表（「另有 N 条…」之前那一段）里只剩事件条目一条。
const mainList = after.split('关联（')[0].split('另有 ')[0];
// 主列表的条目行是「[id] 标题（日期，状态 …）」，顶格、没有短横；关联和隐藏段都带 "- "。
const headlineCount = (mainList.match(/^\[2026/gm) || []).length;
check('默认检索只剩事件条目（碎片不再单独占位）', after.includes(mergedId) && headlineCount === 1, '条目行=' + headlineCount);
check('事件条目里有每片的指针与摘句', after.includes(id1) || after.includes('双实例'));

// 带 include_retired：原文还搜得到（细节不丢）
const withOld = await tools.memory_search.execute({ query: 'QQ_AGENT_DATA_DIR', limit: 5, include_retired: true });
check('include_retired 能翻回原文', withOld.includes(id2) || withOld.includes('QQ_AGENT_DATA_DIR'));

// 已经并过一次的，再并要拒
const again = await tools.memory_merge.execute({ title: '再并一次', ids: [id1, id2] });
check('已 superseded 的不再进合并', again.startsWith('合并失败'), again.slice(0, 24));

// 合并条目的文件头字段
const mergedFile = await readFile(join(home, 'memory', 'notes', mergedId + '.md'), 'utf8');
check('合并条目写了 merged_from 头字段', /^merged_from: .+/m.test(mergedFile));
check('未经手写的时间是系统时间', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(mergedFile));

// 磁盘上只多了一个文件
const files = (await readdir(join(home, 'memory', 'notes'))).filter((f) => f.endsWith('.md'));
check('notes 目录 4 条 + 1 条事件', files.length === 5, String(files.length));

await rm(home, { recursive: true, force: true });
console.log('\n' + (fail.length ? '失败 ' + fail.length + ' 项：' + fail.join(' / ') : '全过（临时目录已删）'));
process.exit(fail.length ? 1 : 0);
