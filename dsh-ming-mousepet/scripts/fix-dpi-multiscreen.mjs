// 2026-11-08 14:41 补丁九：偏移改 +74/+44；坐标一律用物理像素；多屏/旋转只看虚拟桌面。
// 浔的原话：「再往右去50px，往下20px」+「做一下 dpi 适配，还有各种屏幕的旋转适配，
// 比如我的副屏是纵向，你就一直读出在屏幕外」。
// 乱在哪儿：外面读到的是 150% 缩放后的逻辑坐标（1056），sidecar 画气泡用的是物理像素（1584），
// 中间差 1.5 倍；再叠上「主屏中心」这种只认主屏的兜底，副屏（纵向）就永远被判成屏外。
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

// 1. 记住这次是不是「跟鼠标」，并改偏移
rep(
  'nearCursor 偏移与标记',
  `      $bx = -1
      $by = -1
      $coordGiven = ($null -ne $req.x -and $null -ne $req.y)
      if ($coordGiven) {`,
  `      $bx = -1
      $by = -1
      $nearCursor = $false
      $coordGiven = ($null -ne $req.x -and $null -ne $req.y)
      if ($coordGiven) {`,
)

rep(
  'nearCursor 用新偏移',
  `        $c = [DshInput]::CursorPos()
        $bx = [int]$c[0] + 24
        $by = [int]$c[1] + 24`,
  `        # 2026-11-08 浔调的偏移：右 74、下 44（原 24/24 再各加 50 / 20）。
        $c = [DshInput]::CursorPos()
        $bx = [int]$c[0] + 74
        $by = [int]$c[1] + 44
        $nearCursor = $true`,
)

// 2. 跟鼠标时不要再被「回前台屏」拽走
rep(
  '回屏跳过 nearCursor',
  `      if (-not $coordGiven -and $fg -ne [IntPtr]::Zero) {`,
  `      if (-not $coordGiven -and -not $nearCursor -and $fg -ne [IntPtr]::Zero) {`,
)

// 3. 兜底：主屏中心 → 虚拟桌面中心（多屏、任意排布都对）
rep(
  '兜底改虚拟桌面中心',
  `        $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $bx = $area.X + [int]($area.Width / 2) - 32
        $by = $area.Y + [int]($area.Height / 2) - 60`,
  `        # 2026-11-08：不认「主屏」了。虚拟桌面 = 所有屏并起来那块（物理像素），
        # 副屏竖着挂、左边挂、上面挂都不用管，落在并集中心就一定看得见。
        $vx = [DshInput]::GetSystemMetrics(76)
        $vy = [DshInput]::GetSystemMetrics(77)
        $vw = [DshInput]::GetSystemMetrics(78)
        $vh = [DshInput]::GetSystemMetrics(79)
        $bx = $vx + [int]($vw / 2) - 32
        $by = $vy + [int]($vh / 2) - 60`,
)

// 4. status 里补上物理屏幕信息，外面不用再猜
rep(
  'status 补 screen',
  `    cursor = @{ x = $cursor[0]; y = $cursor[1] }`,
  `    cursor = @{ x = $cursor[0]; y = $cursor[1] }
    # 2026-11-08：全是物理像素，跟 cursor / winInfo / SetWindowPos 同一套。
    screen = @{
      x = [DshInput]::GetSystemMetrics(76); y = [DshInput]::GetSystemMetrics(77)
      w = [DshInput]::GetSystemMetrics(78); h = [DshInput]::GetSystemMetrics(79)
    }
    dpiScale = [math]::Round(([DshInput]::GetSystemMetrics(78) / [math]::Max(1, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width)), 3)`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
