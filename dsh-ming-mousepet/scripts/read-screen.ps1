param(
  [int]$X = -1,
  [int]$Y = -1,
  [int]$W = 0,
  [int]$H = 0,
  [int]$MaxLines = 40
)
# 2026-11-08：静默读屏。截一张、OCR 出文字、输出一行 JSON，然后什么都不留。
# 单独起进程跑，不占插件那边的线程（WinRT 的异步等待会卡住消息循环）。

# 先声明 DPI 感知再加载 GDI：sidecar 是 per-monitor aware，它给的 rect 是物理像素；
# 这个脚本不声明的话，-X/-Y 会被当成逻辑坐标，高 DPI 屏上截偏 1.4 倍。
Add-Type 'using System; using System.Runtime.InteropServices; public static class ScreenDpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v); [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); public static void Apply(){ try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch {} try { SetProcessDPIAware(); } catch {} } }'
try { [ScreenDpi]::Apply() } catch { }

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]

function Await($op, $resultType) {
  $m = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $task = $m.MakeGenericMethod($resultType).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}

try {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { Write-Output '{"ok":false,"error":"no-ocr-engine"}'; exit 0 }

  $area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).Bounds
  if ($X -ge 0 -and $Y -ge 0 -and $W -gt 0 -and $H -gt 0) {
    $area = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
  }

  # 整屏太大时缩一半，OCR 更快也更稳
  $scale = 1.0
  if ($area.Width -gt 3200) { $scale = 0.75 }
  $w = [int]($area.Width * $scale)
  $h = [int]($area.Height * $scale)

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.CopyFromScreen($area.X, $area.Y, 0, 0, (New-Object System.Drawing.Size $w, $h), [System.Drawing.CopyPixelOperation]::SourceCopy)
  $g.Dispose()

  $tmp = Join-Path $env:TEMP ('ming-screen-' + [guid]::NewGuid().ToString('N') + '.png')
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sbmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($sbmp)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  Remove-Item $tmp -ErrorAction SilentlyContinue

  $lines = @()
  foreach ($line in $result.Lines) {
    $t = ($line.Text -replace '\s+', ' ').Trim()
    if ($t.Length -ge 2) { $lines += $t }
    if ($lines.Count -ge $MaxLines) { break }
  }

  $payload = @{ ok = $true; count = $lines.Count; lines = $lines; text = ($lines -join ' / ') }
  Write-Output ($payload | ConvertTo-Json -Compress -Depth 4)
}
catch {
  $msg = $_.Exception.Message -replace '"', "'"
  Write-Output ('{"ok":false,"error":"' + $msg + '"}')
}
