/**
 * make-memory-card.mjs —— 生成 / 重建《记忆卡》（八章索引）
 *
 * 记忆卡是**索引**，不是原文：每章下面一行一条，指向 notes/ 里那份。
 * 关系图读它取 chapter（neuron.js 的 parseCard 认 `## 第X章 标题` 和正文加粗词）。
 *
 *   node make-memory-card.mjs            # 写 ~/.dsh/xingxi/记忆卡.md
 *   node make-memory-card.mjs --dry      # 只统计分布，不写
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const NOTES = path.join(HOME, '.dsh', 'memory', 'notes')
const OUT = path.join(HOME, '.dsh', 'xingxi', '记忆卡.md')

// 八章：名字按她一眼能懂的说法来，不用技术目录
const CHAPTERS = [
  { name: '通道', kw: ['QQ-Agent', '出站', '掉线', '白名单', 'snowluma', 'NapCat', 'OneBot', '看门狗', 'qq-say', 'ming-bridge', '私聊', '群门', '发送', '端口'] },
  { name: '记忆', kw: ['记忆', '检索', '索引', '归档', 'doc-emb', 'recall', '压缩', '关系图', 'neuron', '向量', '星图', '卡'] },
  { name: '插件与本事', kw: ['插件', 'DSH', 'dsh-', '扩展', '技能', 'skill', 'MCP', '注入', '缓存', '工具', 'sidecar', '感知', 'perceive'] },
  // 2026-11-07 21:40 补：未分章那 7 条全是手机/adb/隧道/wb-proxy 这类机器侧的活——
  // 不是它们没信息，是「机器」这章的关键词里根本没有这些词。
  { name: '机器', kw: ['环境', '网络', '代理', '防火墙', '磁盘', 'C 盘', 'GPU', 'Windows', '驱动', '电源', '内存', 'Clash', 'hosts', 'SSL', 'adb', '隧道', '手机', '安卓', 'Termux', 'wb-proxy', 'workbench', 'ssh', 'Docker', 'Edge', '端口占用'] },
  { name: '画与声', kw: ['ComfyUI', 'LoRA', '画', '语音', 'TTS', '翻唱', '音频', '视频', 'SoVITS', '声', '音色'] },
  { name: '外面', kw: ['B站', '贴吧', '浏览', '见闻', '读书', '小说', '微博', '知乎', '小黑盒', '何氏语林'] },
  { name: '活计', kw: ['委托', '任务', '计划任务', '脚本', 'scripts', '事故', '修复', 'bug', '修法', '自检', '巡检', '账', '下载器', '坑'] },
  { name: '人和话', kw: ['群友', '称呼', '语气', '接话', '蒸馏', '人设', '约定', '说话', '群聊', '她', '名字', 'people'] },
]

function parse(file, text) {
  const title = (text.match(/^title:\s*(.+)$/m) || [])[1] || file.replace(/\.md$/, '')
  const tags = (text.match(/^tags:\s*(.+)$/m) || [])[1] || ''
  const body = text.replace(/^---[\s\S]*?---/, '').trim()
  return { file, title: title.trim(), tags: tags.trim(), body }
}

// 打分：标题里的词最算数（那是人写的），tag 次之，正文里到处都有的词最轻。
// 2026-11-07 18:2x 第一版按[命中个数]平权，结果 121/219 全进了[记忆]——因为太多笔记的 tag 里带记忆。
function pickChapter(m) {
  const title = m.title || ''
  const tags = m.tags || ''
  const body = (m.body || '').slice(0, 600)
  let best = null, bestScore = 0
  for (const ch of CHAPTERS) {
    let s = 0
    for (const k of ch.kw) {
      if (!k || k.length < 2) continue
      const generic = (k === '记忆' || k === '插件' || k === '工具' || k === '任务' || k === '画' || k === '声')
      const w = generic ? 0.4 : 1
      // 2026-11-07 21:4x：标题从 ×3 提到 ×8。原先是词频投票，一条记忆正文六百字里
      // 往往横跨两三章，一个标题词打不过三个正文词——「DSH 重启归她」被 DSH 抢去插件、
      // 「关键词发言会顶掉正在聊的话题」被「消息/发送」抢去通道。标题是我自己写的摘要，
      // 最接近「这条讲的是哪件事」，该由它说话；正文降成 0.3，只当补充。
      if (title.indexOf(k) >= 0) s += 8 * w
      if (tags.indexOf(k) >= 0) s += 3 * w
      if (body.indexOf(k) >= 0) s += 0.3 * w
    }
    if (s > bestScore) { bestScore = s; best = ch }
  }
  return bestScore >= 2 ? { chapter: best, score: bestScore } : null
}

const files = (await fs.readdir(NOTES)).filter((f) => f.endsWith('.md'))
const rows = []
let skipped = 0
for (const f of files) {
  try {
    const text = await fs.readFile(path.join(NOTES, f), 'utf8')
    // 墓碑不算：deleted / invalidated 的正文只剩一句[此记忆已删除]，进卡只会把索引撑大
    // 2026-11-07 21:40 修正：原来写的是 `/^status:s*(invalidated|superseded)/`——
    // 那个 `s*` 是「字母 s 重复」，不是 `\s*`（空白），所以这两条正则**从来没匹配上过**；
    // 108 条墓碑全靠下一行「此记忆已删除」兜住。代价是被取代（superseded）但正文还在的条目
    // 漏进卡里，同一件事出现两行（recall-ledger 就重了一次）。
    if (/^deleted:\s*true/m.test(text) || /^status:\s*(invalidated|superseded)/m.test(text)) { skipped++; continue }
    if (/此记忆已删除/.test(text)) { skipped++; continue }
    rows.push(parse(f, text))
  } catch {}
}
if (skipped) console.log('跳过墓碑', skipped, '条')
rows.sort((a, b) => (a.file < b.file ? 1 : -1)) // 新的在前

const byChapter = new Map(CHAPTERS.map((c) => [c, []]))
const unassigned = []
for (const r of rows) {
  const hit = pickChapter(r)
  if (hit) byChapter.get(hit.chapter).push(r)
  else unassigned.push(r)
}

console.log('共', rows.length, '条')
for (const ch of CHAPTERS) console.log('  ' + ch.name.padEnd(5), byChapter.get(ch).length)
console.log('  未分章', unassigned.length)

if (process.argv.includes('--dry')) process.exit(0)

const today = new Date().toISOString().slice(0, 10)
const out = []
out.push('# 记忆卡')
out.push('')
out.push(`> 生成于 ${today}，由 \`dsh-ming-graph/make-memory-card.mjs\` 按关键词分章。`)
out.push('> 这是**索引**：一条一行，指向 `notes/` 里的原文。原文永远在那边，卡不改写它。')
out.push('')
out.push('## 第一章 通道')
out.push('')
out.push('**QQ-Agent** **出站** **掉线** **白名单** **看门狗** 消息怎么进来、怎么出去，卡在哪。')
out.push('')
for (const r of byChapter.get(CHAPTERS[0])) out.push(`- ${r.title}`)
out.push('')

const NUM = ['第二章', '第三章', '第四章', '第五章', '第六章', '第七章', '第八章']
for (let i = 1; i < CHAPTERS.length; i++) {
  const ch = CHAPTERS[i]
  out.push(`## ${NUM[i - 1]} ${ch.name}`)
  out.push('')
  out.push(ch.kw.filter((k) => k.length >= 2).slice(0, 6).map((k) => `**${k}**`).join(' '))
  out.push('')
  for (const r of byChapter.get(ch)) out.push(`- ${r.title}`)
  out.push('')
}
if (unassigned.length) {
  out.push('## 附 未分章')
  out.push('')
  out.push('**未分章** 关键词没打上的。留在这一节，不硬塞。')
  out.push('')
  for (const r of unassigned) out.push(`- ${r.title}`)
  out.push('')
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, out.join('\n'), 'utf8')
console.log('写好：', OUT)
