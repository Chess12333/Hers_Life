// 2026-11-08 14:36 补丁七：say 不带坐标时，现读真实光标，落到它右下方 24px。
// 起因：她「再到我鼠标这来看看」——我这边先读坐标、再发请求，中间隔一两秒，
// 她的手一动，落点就偏了。让 sidecar 自己在动手那一刻读，才跟得上。
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
  'say 没坐标时跟鼠标',
  `      } elseif ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      } else {`,
  `      } elseif ($null -eq $req.x -or $null -eq $req.y) {
        # 2026-11-08：没给坐标 = 「到我鼠标这边说」。
        # 现读真实光标，落在它右下方 24px——外面先读再发请求会晚一两秒，她手一动就偏。
        $c = [DshInput]::CursorPos()
        $bx = [int]$c[0] + 24
        $by = [int]$c[1] + 24
      } elseif ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      } else {`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
