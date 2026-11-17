// 2026-11-08 14:24 补丁三：气泡要落在她现在盯的那块屏上。
// 实测：气泡落在 x=2176（副屏），她在主屏（0..1707）——「说了，但没看见」。
// 判据改成前台窗口所在屏，不是 AI 光标上次在哪。
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
  'say 落到前台屏',
  `      # 2026-11-08：说的时候如果光标不在，顺手把它显出来（不然只有气泡没有我）。
      if ($bx -ge 0 -and -not [DshOverlay]::VisibleNow()) { Show-StateAt 'pointer' $bx $by }
      [DshBubble]::Say($text, $bx, $by, $ms)`,
  `      # 2026-11-08 14:24：气泡落在副屏、她在主屏看——说了但没看见。
      # 判据不是「我的光标在哪」，是「她现在盯的是哪块屏」：取前台窗口所在的显示器，
      # 落点跑到别的屏上就挪回这块屏中间偏上，顺便把 AI 光标也落到那儿。
      $fg = [DshInput]::GetForegroundWindow()
      if ($fg -ne [IntPtr]::Zero) {
        $sr = [System.Windows.Forms.Screen]::FromHandle($fg).Bounds
        if ($bx -lt $sr.Left -or $bx -ge $sr.Right -or $by -lt $sr.Top -or $by -ge $sr.Bottom) {
          $bx = $sr.Left + [int]($sr.Width / 2) - 32
          $by = $sr.Top + [int]($sr.Height * 0.35)
          Show-StateAt 'pointer' $bx $by
        }
      }
      # 说的时候如果光标不在，顺手把它显出来（不然只有气泡没有我）。
      if ($bx -ge 0 -and -not [DshOverlay]::VisibleNow()) { Show-StateAt 'pointer' $bx $by }
      [DshBubble]::Say($text, $bx, $by, $ms)`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
