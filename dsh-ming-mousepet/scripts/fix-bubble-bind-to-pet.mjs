// 2026-11-08 14:29 补丁五：气泡直接绑死在桌宠（AI 光标）身上，按它的坐标偏移。
// 起因：她说「桌宠没移到鼠标右下、气泡也不在桌宠上方」——给了坐标时桌宠没动，
// 气泡却按那个坐标画，两样东西分家了。
// 现在：给了坐标先把桌宠走过去，然后一律以桌宠**当前**位置为基准画泡（泡在它上方居中，
// 公式在 BubbleForm 里：px = x+32-w/2，py = y-h-18）。
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
  'say 以桌宠实际位置为准',
  `      # 说的时候如果光标不在，顺手把它显出来（不然只有气泡没有我）。
      if ($bx -ge 0 -and -not [DshOverlay]::VisibleNow()) { Show-StateAt 'pointer' $bx $by }
      [DshBubble]::Say($text, $bx, $by, $ms)`,
  `      # 2026-11-08 14:29 她定的：气泡直接绑死在桌宠身上，按它的坐标偏移。
      # 给了坐标就先把桌宠挪过去；然后再统一以桌宠**当前**位置为基准画泡——
      # 传进来的点可能是几步之前的，信它就会泡在这儿、我站那儿。
      if ($bx -ge 0) { Show-StateAt 'pointer' $bx $by }
      if ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      }
      if ($bx -ge 0 -and -not [DshOverlay]::VisibleNow()) { Show-StateAt 'pointer' $bx $by }
      [DshBubble]::Say($text, $bx, $by, $ms)`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
