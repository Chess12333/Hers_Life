Add-Type -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
'@ -Name M -Namespace T
$LDOWN = 0x0002; $LUP = 0x0004
[T.M]::SetCursorPos(600, 600) | Out-Null
Start-Sleep -Milliseconds 180
[T.M]::mouse_event($LDOWN, 0, 0, 0, 0)
for ($i = 1; $i -le 12; $i++) {
  [T.M]::SetCursorPos(600 + 40 * $i, 600 + 25 * $i) | Out-Null
  Start-Sleep -Milliseconds 35
}
[T.M]::mouse_event($LUP, 0, 0, 0, 0)
"drag sent"
