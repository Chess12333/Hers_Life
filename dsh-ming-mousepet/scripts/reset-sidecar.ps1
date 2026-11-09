# 2026-11-09 18:3x：她那边鼠标不见了、托盘点不动——按最可能的原因先救：把 sidecar 全清掉。
# 光标消失 + UI 不响应 = 某个 WinForms 线程被卡住、还攥着鼠标捕获。
$ErrorActionPreference = 'SilentlyContinue'
$before = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*sidecar.ps1*' })
foreach ($p in $before) { Stop-Process -Id $p.ProcessId -Force }
Start-Sleep -Milliseconds 800
$after = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*sidecar.ps1*' })
Write-Host ("killed=" + $before.Count + " left=" + $after.Count)
exit 0
