param([string]$Label='batch')
$ErrorActionPreference='Stop'
Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public class LiveWin {
 public delegate bool CB(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll")] static extern bool EnumWindows(CB c,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 public struct R {public int l,t,r,b;}
 public static object Rect(long handle) { R r; GetWindowRect(new IntPtr(handle),out r); return new {x=r.l,y=r.t,w=r.r-r.l,h=r.b-r.t,qpc=System.Diagnostics.Stopwatch.GetTimestamp()}; }
 public static object[] Read(uint pid) { var a=new List<object>(); EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid && IsWindowVisible(h)){R r;GetWindowRect(h,out r);a.Add(new {hwnd=h.ToInt64(),x=r.l,y=r.t,w=r.r-r.l,h=r.b-r.t});}return true;},IntPtr.Zero);return a.ToArray(); }
}
'@
[LiveWin]::SetProcessDpiAwarenessContext([IntPtr](-4))|Out-Null
Add-Type -AssemblyName System.Windows.Forms
$base='http://127.0.0.1:56317/dsh-ming-mousepet/api'
function GetDebug { (Invoke-RestMethod "$base/pet-debug").debug }
function Post($route,$data) {Invoke-RestMethod "$base/$route" -Method Post -ContentType 'application/json' -Body ($data|ConvertTo-Json -Compress)|Out-Null}
$d=GetDebug
[uint32]$owner=0
[LiveWin]::GetWindowThreadProcessId([IntPtr]$d.hwnd,[ref]$owner)|Out-Null
$rows=[Collections.Generic.List[object]]::new()
function Sample($phase) {
 $before=[LiveWin]::Rect([long]$d.hwnd)
 $wins=@([LiveWin]::Read($owner))
 $after=[LiveWin]::Rect([long]$d.hwnd)
 $stable=($before.x -eq $after.x -and $before.y -eq $after.y -and $before.w -eq $after.w -and $before.h -eq $after.h)
 $rows.Add(@{phase=$phase;ms=$clock.ElapsedMilliseconds;cursorBefore=$before;cursorAfter=$after;stable=$stable;sampleMs=(1000.0*($after.qpc-$before.qpc)/[Diagnostics.Stopwatch]::Frequency);windows=$wins})
}
$clock=[Diagnostics.Stopwatch]::StartNew()
$fgBefore=[LiveWin]::GetForegroundWindow().ToInt64()
$monitors=@([Windows.Forms.Screen]::AllScreens|ForEach-Object {@{x=$_.Bounds.X;y=$_.Bounds.Y;w=$_.Bounds.Width;h=$_.Bounds.Height}})
try {
 foreach($size in @(24,64,192)) {
  Post 'settings' @{cursorSize=$size}
  Post 'pet-say' @{text='Overlay acceptance';ms=20000;x=1000;y=650}
  for($j=0;$j -lt 85;$j++){Sample "size-$size-initial";Start-Sleep -Milliseconds 8}
  Start-Sleep -Milliseconds 150
  for($j=0;$j -lt 30;$j++){Sample "size-$size-settled";Start-Sleep -Milliseconds 8}
 }
 Post 'settings' @{cursorSize=64}
 Post 'pet-say' @{text='Overlay acceptance';ms=20000;x=600;y=600}
 for($i=0;$i -lt 18;$i++){Sample 'glide';Start-Sleep -Milliseconds 8}
 Post 'pet-say' @{text='Overlay acceptance';ms=20000;x=1500;y=800}
 for($i=0;$i -lt 100;$i++){Sample 'retarget';Start-Sleep -Milliseconds 8}
 for($i=0;$i -lt 150;$i++){Sample 'idle';Start-Sleep -Milliseconds 8}
} finally {Post 'settings' @{cursorSize=64}}
$report=@{pid=$owner;monitors=$monitors;foregroundBefore=$fgBefore;foregroundAfter=[LiveWin]::GetForegroundWindow().ToInt64();finalDebug=(GetDebug);samples=$rows}
$report|ConvertTo-Json -Depth 8|Set-Content ("C:/dsh/dsh-ming-mousepet/test/live-duration-$Label.json") -Encoding UTF8
@{label=$Label;pid=$owner;samples=$rows.Count;debug=$report.finalDebug}|ConvertTo-Json -Depth 5 -Compress
