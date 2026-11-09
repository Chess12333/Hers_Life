// 2026-11-09 17:0x：把 sessions/ask/pick/card 四个动作从 pet_input 挪回 pet。
// 起因：宿主上 pet{action:"sessions"} 回「未知 action」，而 pet_input{sessions} 真能列会话——
// 四个分支被写进了鼠标键盘那只工具的 execute，schema 却写在 pet 上。
// 这一步只搬家，不改任何判据；挪完拿 node --check 和同一批契约测试验。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../index.js', import.meta.url)
const src = readFileSync(file, 'utf8')

const startMarker = "        if (action === 'sessions') {"
// 终点 = 这四个分支之后 pet_input 自己的下一个分支（status）。
const endMarker = "\n        if (action === 'status') {"

const start = src.indexOf(startMarker)
if (start < 0) throw new Error('找不到 sessions 分支')
const end = src.indexOf(endMarker, start + startMarker.length)
if (end < 0) throw new Error('找不到挪动终点（pet_input 的 status 分支）')
const block = src.slice(start, end)
for (const k of ['sessions', 'ask', 'pick', 'card']) {
  if (!block.includes(`if (action === '${k}') {`)) throw new Error('要挪的块里缺 ' + k)
}
if (block.includes('未知 action')) throw new Error('切过头了，块里混进了 fallback')

const anchor = "        if (action === 'look') {"
const at = src.indexOf(anchor)
if (at < 0) throw new Error('找不到 pet 的 look 分支')
if (at < end) throw new Error('锚点在切点之前，顺序不对')

let out = src.slice(0, start) + src.slice(end)
const at2 = out.indexOf(anchor)
out = out.slice(0, at2) + block + out.slice(at2)

copyFileSync(file, new URL('../backup/index.js.20261109-move-card-actions.bak', import.meta.url))
writeFileSync(file, out)
console.log('挪完了：' + block.split('\n').length + ' 行从 pet_input → pet')
