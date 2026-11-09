Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern bool GetCursorPos(out System.Drawing.Point p);' -Name W -Namespace T -ReferencedAssemblies System.Drawing
$p = New-Object System.Drawing.Point
[T.W]::GetCursorPos([ref]$p) | Out-Null
$x = $p.X; $y = $p.Y
$offsets = @(120, -120, 120, -120, 120, -120)
foreach ($o in $offsets) { [T.W]::SetCursorPos($x + $o, $y) | Out-Null; Start-Sleep -Milliseconds 55 }
[T.W]::SetCursorPos($x, $y) | Out-Null
"wiggle done at $x,$y"
