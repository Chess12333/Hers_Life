/**
 * make-galaxy-preview.mjs —— 生成一份「双击就开」的星图预览页（数据 + 渲染代码内嵌）
 *
 * 为什么要它：面板要重启 DSH 才加载新代码，而这份 HTML 现在就能打开。
 * 用同一份数据（统一节点模型）、同一份渲染（src/star-view.js），不是两套东西。
 *
 *   node make-galaxy-preview.mjs [输出路径]   → 默认 star-preview.html
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, readDshNotes, readQqObservations, buildNeuron, buildUnified } from './neuron.js'
import { loadLocalConfig } from './index.js'
import { mergePeople } from './people-merge.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const cfg = { ...DEFAULTS, ...loadLocalConfig() }
const outPath = process.argv[2] || 'star-preview.html'

const [dsh, qq] = await Promise.all([
  readDshNotes(cfg.dshMemoryDir),
  cfg.qqObservations ? readQqObservations(cfg.qqObservations) : [],
])
let names = new Map()
try {
  const idx = JSON.parse(await fs.readFile(cfg.peopleIndex, 'utf8'))
  for (const [id, arr] of Object.entries(idx.byId || {})) {
    if (arr && arr[0] && arr[0].name) names.set(String(id), String(arr[0].name))
  }
} catch { /* 没有索引就退回号码 */ }

// 日记：跟 Host 那侧同一条规则（最近 diaryDays 天）
async function readDiaries(dir, days) {
  if (!dir) return []
  const out = []
  const since = Date.now() - Math.max(1, days || 60) * 86400000
  let list = []
  try { list = await fs.readdir(dir) } catch { return [] }
  for (const f of list) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
    if (!m) continue
    const at = Date.parse(m[1] + 'T00:00:00+08:00')
    if (!(at >= since)) continue
    let body = ''
    try { body = await fs.readFile(path.join(dir, f), 'utf8') } catch { continue }
    out.push({ date: m[1], title: m[1], at, body: body.slice(0, 4000) })
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1))
  return out
}

let card = ''
if (cfg.memoryCard) { try { card = await fs.readFile(cfg.memoryCard, 'utf8') } catch { /* 还没生成 */ } }
const diaries = await readDiaries(cfg.diaryDir, cfg.diaryDays)

const graph = mergePeople(buildNeuron({ dsh, qq, cfg, names }))
const unified = buildUnified(graph, { card, diaries })
const view = await fs.readFile(path.join(here, 'src', 'star-view.js'), 'utf8')

const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<title>星图 · 溟</title>
<style>
:root{--dsw-alias-label-primary:#e6e8ee;--dsw-alias-label-secondary:#a8adba;--dsw-alias-label-tertiary:#767c8c;
--dsw-alias-bg-layer-1:#171a21;--dsw-alias-bg-layer-2:#1f232c;--dsw-alias-border-l2:#2a2f3a;--dsw-alias-border-l3:#3a414f;
--dsw-alias-state-error-primary:#ef6b6b;--dsw-alias-separator-secondary:#2a2f3a}
html,body{margin:0;height:100%;background:#0d0f14;color:#e6e8ee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
#app{height:100%}
</style></head>
<body><div id="app"></div>
<script>${view}</script>
<script>
const DATA = ${JSON.stringify(unified)};
const view = __MingStarView.mount(document.getElementById('app'), DATA, {});
window.__STATS = view.stats();
document.title = '星图 · ' + window.__STATS.nodes + ' 点 / ' + window.__STATS.arms + ' 臂 / ' + window.__STATS.size.join('×');
</script>
</body></html>
`

await fs.writeFile(outPath, html, 'utf8')
console.log('写好：', outPath)
console.log('  节点', unified.stats.unified, '· 章', unified.stats.chapters, '· 日记', unified.stats.diaries, '· 源', unified.stats.source)
console.log('  ', (html.length / 1024 / 1024).toFixed(2), 'MB')
