// 2026-11-08 14:27 补丁四：调用方给了坐标，就别再按前台屏挪。
// 之前为了防止「气泡落副屏她看不见」，一律挪回前台窗口所在屏；
// 现在闲置开口改成跟她的鼠标走（她看得见自己的手），给坐标就该照着用。
// 没给坐标的（手动 say）保持原行为：落前台窗口那块屏。
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
  '记下坐标是不是调用方给的',
  `      $bx = -1
      $by = -1
      if ($null -ne $req.x -and $null -ne $req.y) {
        $bx = [int]$req.x
        $by = [int]$req.y
      } elseif ([DshOverlay]::HasLast) {`,
  `      $bx = -1
      $by = -1
      $coordGiven = ($null -ne $req.x -and $null -ne $req.y)
      if ($coordGiven) {
        $bx = [int]$req.x
        $by = [int]$req.y
      } elseif ([DshOverlay]::HasLast) {`,
)

rep(
  '回屏只对没给坐标的生效',
  `      $fg = [DshInput]::GetForegroundWindow()
      if ($fg -ne [IntPtr]::Zero) {
        $sr = [System.Windows.Forms.Screen]::FromHandle($fg).Bounds`,
  `      $fg = [DshInput]::GetForegroundWindow()
      if (-not $coordGiven -and $fg -ne [IntPtr]::Zero) {
        $sr = [System.Windows.Forms.Screen]::FromHandle($fg).Bounds`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
