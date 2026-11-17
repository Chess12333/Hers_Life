$ErrorActionPreference = 'Stop'
$procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*sidecar.ps1*' }
if (-not $procs) { "no sidecar process"; exit 0 }
foreach ($p in $procs) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    "killed pid=" + $p.ProcessId
  } catch {
    "failed pid=" + $p.ProcessId + " : " + $_.Exception.Message
  }
}
