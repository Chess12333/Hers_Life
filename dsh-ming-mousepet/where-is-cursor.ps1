Add-Type -Namespace AstraChk -Name D -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);'
try { [void][AstraChk.D]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

Add-Type -Namespace AstraChk -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
public struct RECT { public int Left, Top, Right, Bottom; }
'@

$target = (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'sidecar\.ps1' } |
  Select-Object -First 1 -ExpandProperty ProcessId)
Write-Output ("sidecar pid=" + $target)

$found = New-Object System.Collections.ArrayList
$cb = [AstraChk.W+EnumWindowsProc]{
  param($h, $p)
  $pid2 = 0
  [void][AstraChk.W]::GetWindowThreadProcessId($h, [ref]$pid2)
  if ($pid2 -eq $target) {
    $r = New-Object AstraChk.W+RECT
    if ([AstraChk.W]::GetWindowRect($h, [ref]$r)) {
      $vis = [AstraChk.W]::IsWindowVisible($h)
      [void]$found.Add(("hwnd={0} visible={1} rect=({2},{3})-({4},{5}) size={6}x{7}" -f $h, $vis, $r.Left, $r.Top, $r.Right, $r.Bottom, ($r.Right-$r.Left), ($r.Bottom-$r.Top)))
    }
  }
  return $true
}
[void][AstraChk.W]::EnumWindows($cb, [IntPtr]::Zero)
$found | ForEach-Object { Write-Output $_ }
