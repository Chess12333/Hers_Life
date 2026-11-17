# 给桌宠窗口发一次「假的鼠标操作」，用来验 sidecar 的轻点/拖动判据。
# 参数走环境变量（PS 5.1 的 -File 传参在这台机器上不稳，2026-11-08 踩过）：
#   TAP_HWND  目标窗口句柄
#   TAP_MODE  click | hold | drag | flick
#     click  按下 60ms 就松 —— 该算轻点
#     hold   按住 400ms 再松，不动 —— 长按，不该算轻点
#     drag   按住 400ms，移到 (30,30) 再松 —— 该算拖动
#     flick  按下 100ms，猛地移到 (40,40) 再松 —— 也算拖动（甩出去了）

$ErrorActionPreference = 'Stop'

$Hwnd = [long]$env:TAP_HWND
$Mode = if ($env:TAP_MODE) { $env:TAP_MODE } else { 'click' }
if ($Hwnd -eq 0) { throw 'TAP_HWND 没给' }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TapProbe {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@

$WM_MOUSEMOVE = 0x0200
$WM_LBUTTONDOWN = 0x0201
$WM_LBUTTONUP = 0x0202
$MK_LBUTTON = 1

function MakeLParam([int]$x, [int]$y) { return [IntPtr](($y -shl 16) -bor ($x -band 0xFFFF)) }

function PostWinMsg([uint32]$msg, [int]$w, [int]$x, [int]$y) {
  [TapProbe]::PostMessage([IntPtr]$Hwnd, $msg, [IntPtr]$w, (MakeLParam $x $y)) | Out-Null
  Start-Sleep -Milliseconds 12
}

PostWinMsg $WM_LBUTTONDOWN $MK_LBUTTON 10 10

switch ($Mode) {
  'click' { Start-Sleep -Milliseconds 60 }
  'hold' { Start-Sleep -Milliseconds 400 }
  'drag' {
    Start-Sleep -Milliseconds 400
    PostWinMsg $WM_MOUSEMOVE $MK_LBUTTON 18 18
    PostWinMsg $WM_MOUSEMOVE $MK_LBUTTON 30 30
    Start-Sleep -Milliseconds 80
  }
  'flick' {
    Start-Sleep -Milliseconds 100
    PostWinMsg $WM_MOUSEMOVE $MK_LBUTTON 40 40
    Start-Sleep -Milliseconds 60
  }
  default { throw "unknown mode: $Mode" }
}

$endX = 10
$endY = 10
if ($Mode -eq 'drag' -or $Mode -eq 'flick') { $endX = 30; $endY = 30 }
PostWinMsg $WM_LBUTTONUP 0 $endX $endY
Write-Output "sent:$Mode"
