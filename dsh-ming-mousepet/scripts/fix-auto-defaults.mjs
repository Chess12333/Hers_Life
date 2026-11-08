// 2026-11-08 14:15 一次性补丁：mousepet 的默认输入不该碰主人的键鼠。
//
// 改三件事：
//   1. key 的 auto 不再直接物理按键（原来没有兜底，直接 PhysicalKeySequence）；
//      先投窗口消息，没反应由调用方显式传 mode:"physical"。
//   2. key 的 message 分支不再用 [Array]::Reverse($vks) 原地翻数组（会污染后续使用），
//      并且优先投给 req.hwnd。
//   3. click / scroll / drag / key / type 走物理路径之后，把 AI 光标亮回来。
//      原来物理分支故意 Hide 完就不管（怕两套光标叠着闪），结果是「一动就消失」。
//
// 用法：node scripts/fix-auto-defaults.mjs [--dry]

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../sidecar.ps1', import.meta.url))
const dry = process.argv.includes('--dry')

let raw = readFileSync(FILE, 'utf8')
const bom = raw.charCodeAt(0) === 0xfeff
if (bom) raw = raw.slice(1)
// sidecar.ps1 是 CRLF；先归一成 LF 再匹配，写回时还原（不然一行都匹配不上）。
const crlf = raw.includes('\r\n')
const norm = crlf ? raw.replace(/\r\n/g, '\n') : raw
let s = norm
const problems = []

function rep(label, from, to) {
  const count = s.split(from).length - 1
  if (count !== 1) {
    problems.push(`${label}: 匹配 ${count} 次（期望 1 次）`)
    return
  }
  s = s.replace(from, to)
}

// ---------- 1. 先把「物理之后恢复光标」的助手函数插在 Show-StateAt 后面 ----------
rep(
  '插入 Restore-AiCursor',
  `function Show-StateAt([string]$state, [int]$x, [int]$y) {
  if ($script:styleNames -contains $state) { $script:cursorStyle = $state }
  [DshOverlay]::SetStyle($script:cursorStyle)
  [DshOverlay]::ShowAt($x, $y)
}`,
  `function Show-StateAt([string]$state, [int]$x, [int]$y) {
  if ($script:styleNames -contains $state) { $script:cursorStyle = $state }
  [DshOverlay]::SetStyle($script:cursorStyle)
  [DshOverlay]::ShowAt($x, $y)
}

# 2026-11-08：物理动作结束后把 AI 光标亮回来。
# 以前物理分支 Hide 完就不管（怕两套光标叠着闪），结果是「她一动，我就消失」。
# 现在放回真实光标旁边、错开 24px：看得见，也不叠着闪。
function Restore-AiCursor {
  if ($script:cursorMode -eq 'clean') { return }
  $pos = [System.Windows.Forms.Cursor]::Position
  Show-StateAt 'pointer' ($pos.X + 24) ($pos.Y + 24)
}`,
)

// ---------- 2. key：auto 也走窗口消息 ----------
rep(
  'key auto 走消息',
  `      if ($mode -eq 'message') {
        $h = [DshInput]::GetFocusWindow()
        foreach ($vk in $vks) { [DshInput]::PostKey($h, [int]$vk, $true, $false, $false) }
        [Array]::Reverse($vks)
        foreach ($vk in $vks) { [DshInput]::PostKey($h, [int]$vk, $false, $false, $false) }
        $script:cursorStyle = 'text'
        [DshOverlay]::SetStyle('text')
        return @{ ok = $true; via = 'message'; hwnd = [long]$h; keys = $raw; verified = $false; note = '按键消息已投递，请截图确认' }
      }`,
  `      # 2026-11-08：auto 不再直接物理按键（那是主人的键盘）。先投消息；
      # 目标不响应就显式传 mode:"physical"，由调用方决定，不替她按。
      if ($mode -eq 'message' -or $mode -eq 'auto') {
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
)

// ---------- 3. key 物理收尾 ----------
rep(
  'key 物理收尾恢复光标',
  `        [DshInput]::PhysicalKeySequence([uint16[]]$vks)
      } finally {
        if ($prev -ne [IntPtr]::Zero) { [DshInput]::FocusWindow($prev) | Out-Null }
      }
      $script:cursorStyle = 'text'
      [DshOverlay]::SetStyle('text')
      return @{ ok = $true; via = 'physical'; keys = $raw; note = '物理按键完成' }`,
  `        [DshInput]::PhysicalKeySequence([uint16[]]$vks)
      } finally {
        if ($prev -ne [IntPtr]::Zero) { [DshInput]::FocusWindow($prev) | Out-Null }
      }
      $script:cursorStyle = 'text'
      [DshOverlay]::SetStyle('text')
      Restore-AiCursor
      return @{ ok = $true; via = 'physical'; keys = $raw; note = '物理按键完成' }`,
)

// ---------- 4. click 物理收尾 ----------
rep(
  'click 物理收尾恢复光标',
  `        [DshInput]::PhysicalClick($x, $y, ($button -eq 'right'), $count)
        # 物理输入已经动了真实光标；不要把 AI 光标压在同一个点上，否则两套光标叠着会闪。
        [DshOverlay]::Hide()
        return @{ ok = $true; via = 'physical'; note = '物理输入完成，光标已还原' }`,
  `        [DshInput]::PhysicalClick($x, $y, ($button -eq 'right'), $count)
        # 物理输入已经动了真实光标；AI 光标回到她手上那颗旁边（错开 24px），
        # 既不叠着闪，也不再一藏就不回来。
        Restore-AiCursor
        return @{ ok = $true; via = 'physical'; note = '物理输入完成，光标已还原' }`,
)

// ---------- 5. scroll 物理收尾 ----------
rep(
  'scroll 物理收尾恢复光标',
  `        [DshInput]::PhysicalScroll($x, $y, $delta)
        [DshOverlay]::Hide()
        return @{ ok = $true; via = 'physical'; delta = $delta; note = '物理滚轮完成，光标已还原' }`,
  `        [DshInput]::PhysicalScroll($x, $y, $delta)
        Restore-AiCursor
        return @{ ok = $true; via = 'physical'; delta = $delta; note = '物理滚轮完成，光标已还原' }`,
)

// ---------- 6. drag 物理收尾 ----------
rep(
  'drag 物理收尾恢复光标',
  `        [DshInput]::PhysicalDrag($x1, $y1, $x2, $y2, $duration)
        [DshOverlay]::Hide()
        return @{ ok = $true; via = 'physical'; note = '物理拖拽完成，光标已还原' }`,
  `        [DshInput]::PhysicalDrag($x1, $y1, $x2, $y2, $duration)
        Restore-AiCursor
        return @{ ok = $true; via = 'physical'; note = '物理拖拽完成，光标已还原' }`,
)

// ---------- 7. type：UIA 聚焦后物理输入 & 物理分支 ----------
rep(
  'type uia-focus 收尾恢复光标',
  `            [DshInput]::PhysicalText($text)
            [DshOverlay]::Hide()
            return @{ ok = $true; via = 'uia-focus+physical'; pattern = 'Focus'; name = $f.name; type = $f.type; note = 'UIA 聚焦后用独立键盘输入，未移动鼠标' }`,
  `            [DshInput]::PhysicalText($text)
            Restore-AiCursor
            return @{ ok = $true; via = 'uia-focus+physical'; pattern = 'Focus'; name = $f.name; type = $f.type; note = 'UIA 聚焦后用独立键盘输入，未移动鼠标' }`,
)

rep(
  'type 物理收尾恢复光标',
  `        if ($hasPoint) { [DshOverlay]::Hide() } else { $script:cursorStyle = 'text'; [DshOverlay]::SetStyle('text') }
        return @{ ok = $true; via = 'physical'; note = '物理键盘输入完成' }`,
  `        if ($hasPoint) { Restore-AiCursor } else { $script:cursorStyle = 'text'; [DshOverlay]::SetStyle('text') }
        return @{ ok = $true; via = 'physical'; note = '物理键盘输入完成' }`,
)

if (problems.length) {
  console.error('没写成：\n' + problems.join('\n'))
  process.exit(1)
}

if (dry) {
  console.log(`dry：8 处都能匹配，长度 ${norm.length} → ${s.length}`)
  process.exit(0)
}

const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log(`写好：${FILE}（BOM ${bom ? '保留' : '无'}，换行 ${crlf ? 'CRLF' : 'LF'}，${raw.length} → ${out.length} 字符）`)
