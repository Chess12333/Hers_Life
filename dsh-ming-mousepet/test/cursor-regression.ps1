param([string]$Source = 'C:/dsh/dsh-ming-mousepet/sidecar.ps1')
$ErrorActionPreference = 'Stop'
$s = [IO.File]::ReadAllText($Source)
$tokens=$null; $errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($Source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$b=[IO.File]::ReadAllBytes($Source)
if ($b[0] -ne 239 -or $b[1] -ne 187 -or $b[2] -ne 191) { throw 'BOM missing' }
$cs=[regex]::Match($s,'(?ms)^\$cs = @''\r?\n(.*?)\r?\n''@').Groups[1].Value
$bc=[regex]::Match($s,'(?ms)^\$bubbleCs = @''\r?\n(.*?)\r?\n''@').Groups[1].Value
if (!$cs -or !$bc) { throw 'C# extraction failed' }
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,UIAutomationClient,UIAutomationTypes
Add-Type -TypeDefinition ($cs+"`n"+$bc) -ReferencedAssemblies @('System.Windows.Forms','System.Drawing','UIAutomationClient','UIAutomationTypes','WindowsBase')
function Check($ok,$name) { if (!$ok) { throw "FAIL: $name" }; Write-Output "PASS: $name" }
Check ($s -notmatch 'gelapsed \+= glideTimer.Interval') 'elapsed time is not tick counting'
Check ($s -notmatch 'if \(!started\) \{ LastX = x; LastY = y; \}') 'failed start cannot publish destination'
Check ($s -notmatch 'Start-Sleep -Milliseconds \(\$glMs \+ 140\)') 'say does not sleep for guessed arrival'
Check ($s -match 'gx0 = actual.Left; gy0 = actual.Top') 'retarget starts at actual rect'
Check ($s -match 'PublishBounds\(Handle\)') 'placement publishes measured bounds'
$wa=New-Object Drawing.Rectangle -ArgumentList -1920,-1080,1920,1080
$size=New-Object Drawing.Size -ArgumentList 300,80
$far=New-Object Drawing.Point -ArgumentList 4000,4000
foreach($w in @(24,64,192)) {
 $a=New-Object Drawing.Rectangle -ArgumentList -1000,-500,$w,$w
 $p=[DshOverlayGeometry]::BubbleLocation($a,$size,$wa,$far)
 Check ($p.X -eq (-1000+$w/2-150) -and $p.Y -eq -598) "negative anchor width $w"
 $a.Offset(2,-1)
 $q=[DshOverlayGeometry]::BubbleLocation($a,$size,$wa,$far)
 Check ($q.X-$p.X -eq 2 -and $q.Y-$p.Y -eq -1) "drift follow width $w"
}
foreach($xy in @(@(-1920,-1080),@(-24,-24))) {
 $a=New-Object Drawing.Rectangle -ArgumentList $xy[0],$xy[1],64,64
 $p=[DshOverlayGeometry]::BubbleLocation($a,$size,$wa,$far)
 Check ($p.X -ge -1912 -and $p.X+300 -le -8 -and $p.Y -ge -1072 -and $p.Y+80 -le -8) 'monitor edge clamp'
}
Check ([DshOverlayGeometry]::Progress(650,520) -eq 1) 'delayed tick arrives by elapsed deadline'
Check ([Math]::Abs([DshOverlayGeometry]::Progress(260,520)-0.5) -lt 0.0001) 'half elapsed time'
Write-Output 'ALL PASS (isolated compile + geometry; no live sidecar started)'
