# 2026-11-09 18:2x：把 sidecar 干净地停掉（可能同时有好几份，旧的会占着管道）。
$ErrorActionPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*sidecar.ps1*' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force }
Start-Sleep -Milliseconds 700
$left = (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*sidecar.ps1*' }).Count
"stopped=$($procs.Count) left=$left"
