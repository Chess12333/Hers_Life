$ErrorActionPreference = 'Stop'
$path = '<DSH>\dsh-ming-mousepet\sidecar.ps1'
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors -and $errors.Count -gt 0) {
  "PARSE FAIL: " + $errors.Count
  $errors | Select-Object -First 8 | ForEach-Object { "  line " + $_.Extent.StartLineNumber + ": " + $_.Message }
  exit 1
}
"PARSE OK (" + $tokens.Count + " tokens)"
