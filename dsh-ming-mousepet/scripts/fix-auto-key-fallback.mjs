// 2026-11-08 14:18 补丁二：key 的 auto 在「窗口消息投不进去」时才回退物理。
// 起因：改成「auto 只投消息」之后实测 PostKey 直接抛 PostMessage key failed，
// 等于把键盘功能改没了。auto 保留回退，但返回 via 写实（physical 就是 physical）。
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
  'key auto 消息失败回退物理',
  `      if ($mode -eq 'message' -or $mode -eq 'auto') {
        $h = [IntPtr]::Zero
        if ($null -ne $req.hwnd) { $h = [IntPtr][long]$req.hwnd }
        if ($h -eq [IntPtr]::Zero) { $h = [DshInput]::GetFocusWindow() }
        foreach ($vk in $vks) { [DshInput]::PostKey($h, [int]$vk, $true, $false, $false) }
        $rel = @($vks)
        [Array]::Reverse($rel)
        foreach ($vk in $rel) { [DshInput]::PostKey($h, [int]$vk, $false, $false, $false) }
        $script:cursorStyle = 'text'
        [DshOverlay]::SetStyle('text')
        return @{ ok = $true; via = 'message'; hwnd = [long]$h; keys = $raw; verified = $false; note = '按键消息已投递（没碰物理键盘）；目标不响应就显式传 mode:"physical"' }
      }`,
  `      if ($mode -eq 'message' -or $mode -eq 'auto') {
        $h = [IntPtr]::Zero
        if ($null -ne $req.hwnd) { $h = [IntPtr][long]$req.hwnd }
        if ($h -eq [IntPtr]::Zero) { $h = [DshInput]::GetFocusWindow() }
        $postErr = $null
        try {
          foreach ($vk in $vks) { [DshInput]::PostKey($h, [int]$vk, $true, $false, $false) }
          $rel = @($vks)
          [Array]::Reverse($rel)
          foreach ($vk in $rel) { [DshInput]::PostKey($h, [int]$vk, $false, $false, $false) }
        } catch {
          $postErr = $_.Exception.Message
        }
        if ($null -eq $postErr) {
          $script:cursorStyle = 'text'
          [DshOverlay]::SetStyle('text')
          return @{ ok = $true; via = 'message'; hwnd = [long]$h; keys = $raw; verified = $false; note = '按键消息已投递（没碰物理键盘）；目标不响应就显式传 mode:"physical"' }
        }
        if ($mode -eq 'message') {
          return @{ ok = $false; reason = 'post-failed'; target = [long]$h; note = ('窗口消息投递失败：' + $postErr) }
        }
        # auto：窗口消息投不进去，才落到下面的物理分支。返回的 via 会写 physical，
        # 不把「物理按的」说成「消息投的」。
      }`,
)

rep(
  'key 物理 note 写实',
  `      return @{ ok = $true; via = 'physical'; keys = $raw; note = '物理按键完成' }`,
  `      return @{ ok = $true; via = 'physical'; keys = $raw; note = '物理按键完成（窗口消息投不进去才走的这条）' }`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log(`dry：2 处都能匹配，${s.length} 字符`); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log(`写好（BOM ${bom ? '保留' : '无'}，CRLF ${crlf}）`)
