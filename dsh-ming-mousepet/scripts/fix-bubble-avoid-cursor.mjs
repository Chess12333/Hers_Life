// 2026-11-08 14:45 补丁十：气泡不许压在真实鼠标上。
// 她：「用户鼠标会把气泡挡住」。真光标永远画在最上层，泡跟它重叠那一块就是花的。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../sidecar.ps1', import.meta.url))
const dry = process.argv.includes('--dry')
let raw = readFileSync(FILE, 'utf8')
const bom = raw.charCodeAt(0) === 0xfeff
if (bom) raw = raw.slice(1)
const crlf = raw.includes('\r\n')
let s = crlf ? raw.replace(/\r\n/g, '\n') : raw
const problems = []
function rep(label, from, to) {
  const c = s.split(from).length - 1
  if (c !== 1) { problems.push(`${label}: 匹配 ${c} 次`); return }
  s = s.replace(from, to)
}

rep(
  '气泡避开真实光标',
  `            if (px + sz.Width > wa.Right - 8) px = wa.Right - 8 - sz.Width;`,
  `            // 2026-11-08 她：「用户鼠标会把气泡挡住」。真实光标永远画在最上层，
            // 泡跟它热区一重叠，那一小块就是花的。压上了就整体挪到它右下方。
            Point cp0 = Cursor.Position;
            Rectangle hot = new Rectangle(cp0.X - 2, cp0.Y - 2, 30, 36);
            if (new Rectangle(px, py, sz.Width, sz.Height).IntersectsWith(hot))
            {
                px = cp0.X + 34;
                py = cp0.Y + 36;
            }
            if (px + sz.Width > wa.Right - 8) px = wa.Right - 8 - sz.Width;`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
