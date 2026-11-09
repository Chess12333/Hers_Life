Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out System.Drawing.Point p);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
'@ -Name M2 -Namespace T2 -ReferencedAssemblies System.Drawing
$LDOWN = 0x0002; $LUP = 0x0004
$p = New-Object System.Drawing.Point
[T2.M2]::SetCursorPos(300, 300) | Out-Null
[T2.M2]::GetCursorPos([ref]$p) | Out-Null
"start readback: $($p.X),$($p.Y)"
[T2.M2]::mouse_event($LDOWN, 0, 0, 0, 0)
for ($i = 1; $i -le 10; $i++) {
  [T2.M2]::SetCursorPos(300 + 30 * $i, 300 + 20 * $i) | Out-Null
  Start-Sleep -Milliseconds 40
}
[T2.M2]::GetCursorPos([ref]$p) | Out-Null
"end readback: $($p.X),$($p.Y)"
[T2.M2]::mouse_event($LUP, 0, 0, 0, 0)
