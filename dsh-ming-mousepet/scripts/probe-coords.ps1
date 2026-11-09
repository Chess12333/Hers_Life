$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$p = New-Object W+POINT
[void][W]::GetCursorPos([ref]$p)
"GetCursorPos  (physical) = $($p.X),$($p.Y)"
"Cursor.Position (winforms) = $([System.Windows.Forms.Cursor]::Position.X),$([System.Windows.Forms.Cursor]::Position.Y)"
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) { "screen $($s.DeviceName) $($s.Bounds) primary=$($s.Primary)" }
$cb = [W+EnumProc] {
  param($h, $l)
  if ([W]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][W]::GetClassName($h, $sb, 256)
    $cls = $sb.ToString()
    if ($cls -like '*WindowsForms*') {
      $r = New-Object W+RECT
      [void][W]::GetWindowRect($h, [ref]$r)
      $w = $r.R - $r.L; $hh = $r.B - $r.T
      if ($w -ge 40 -and $w -le 400 -and $hh -ge 40 -and $hh -le 400) {
        $t = New-Object System.Text.StringBuilder 256
        [void][W]::GetWindowText($h, $t, 256)
        "win hwnd=$h rect=$($r.L),$($r.T),$w x $hh title=[$($t.ToString())]"
      }
    }
  }
  return $true
}
[void][W]::EnumWindows($cb, [IntPtr]::Zero)
"done"
