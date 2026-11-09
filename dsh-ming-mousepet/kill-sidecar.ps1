param([switch]$ListOnly)
$target = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'sidecar.ps1'))
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object {
    if ($_.ProcessId -eq $PID) { return $false }
    $m = [regex]::Match($_.CommandLine, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|([^\s]+))')
    if (!$m.Success) { return $false }
    $path = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
    try { [IO.Path]::GetFullPath($path) -eq $target } catch { $false }
  } |
  ForEach-Object {
    Write-Output ("sidecar pid=" + $_.ProcessId + " " + $_.CommandLine)
    if (!$ListOnly) { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
  }
Write-Output 'done'
