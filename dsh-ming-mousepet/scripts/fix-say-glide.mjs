// 2026-11-08 14:33 补丁六：说话前让桌宠「滑」过去，而不是瞬间钉到位。
// 浔问「是不是没有缓动」——对，先前用的是 Show-StateAt，直接出现在目标点。
// 改成 Glide（ease-out，520ms），滑完按它的落点画泡。
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
  'say 用缓动过去',
  `      if ($bx -ge 0) { Show-StateAt 'pointer' $bx $by }
      if ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      }`,
  `      if ($bx -ge 0) {
        # 2026-11-08 浔：「是不是没有缓动」——是，先前用 Show-StateAt 直接钉过去的。
        # 改成真滑过去（ease-out 520ms）：先确保它已经在屏幕上，滑完再按落点画泡。
        $script:cursorStyle = 'pointer'
        if (-not [DshOverlay]::VisibleNow() -and [DshOverlay]::HasLast) {
          [DshOverlay]::ShowAt([DshOverlay]::LastX, [DshOverlay]::LastY)
        }
        $glMs = 520
        [DshOverlay]::Glide($bx, $by, $glMs)
        Start-Sleep -Milliseconds ($glMs + 140)
      }
      if ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      }`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
