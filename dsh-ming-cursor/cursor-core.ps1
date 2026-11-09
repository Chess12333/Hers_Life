# dsh-ming-cursor —— 轻量版：只有一只会飞的光标和一句气泡
#
# 和 dsh-ming-mousepet 的关系：那一个会截屏、连拍、UIA 点击、拖拽、开卡片；
# 这个只做两件事——把光标画到屏幕上、在桌面上说一句话。没有第三件。
#
# 一条 JSON 一行：stdin 进请求，stdout 出响应。协议见 README。
# Windows PowerShell 5.1 / STA / WinForms。改完记得 `node fix-ps.mjs`（要 UTF-8 BOM + CRLF）。

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch { }

# ---------------------------------------------------------------- 先声明 DPI 感知
# 不先做这一步，高 DPI 屏上 SetWindowPos 的物理像素和 WinForms 的逻辑像素差一倍。
$dpiCode = @'
using System;
using System.Runtime.InteropServices;
public static class DshDpiBootstrap {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    public static void Apply() {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
        try { SetProcessDPIAware(); } catch { }
    }
}
'@
try { Add-Type -TypeDefinition $dpiCode; [DshDpiBootstrap]::Apply() } catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class DshLiteNative
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
    public const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_NOZORDER = 0x0004;
    public const int WM_MOUSEACTIVATE = 0x0021, MA_NOACTIVATE = 3;
}

// ============================================================ 光标
public static class DshLiteCursor
{
    static Thread thread;
    static CursorForm form;
    static readonly ManualResetEvent ready = new ManualResetEvent(false);
    static readonly object outLock = new object();

    public static string Mode = "companion";
    public static int HoldMs = 2600;
    public static int SizePx = 64;
    public static string Style = "pointer";
    static readonly Dictionary<string, Image> sprites = new Dictionary<string, Image>(StringComparer.OrdinalIgnoreCase);

    public static void Emit(string json)
    {
        lock (outLock) { try { Console.Out.WriteLine(json); Console.Out.Flush(); } catch { } }
    }

    public static void LoadSprites(string dir)
    {
        sprites.Clear();
        string[] names = {
            "pointer", "work", "unavailiable", "link", "text",
            "cross", "busy", "move", "vert", "horz",
            "help", "handwriting", "dgn1", "dgn2", "alternate" };
        foreach (string n in names)
        {
            string p = System.IO.Path.Combine(dir, n + ".png");
            if (!System.IO.File.Exists(p)) continue;
            try { sprites[n] = Image.FromFile(p); } catch { }
        }
    }

    public static void Start()
    {
        if (thread != null) return;
        thread = new Thread(ThreadProc);
        thread.IsBackground = true;
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        ready.WaitOne(5000);
    }

    static void ThreadProc()
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object s, ThreadExceptionEventArgs e)
            { try { Console.Error.WriteLine("cursor: " + e.Exception.Message); } catch { } };
            form = new CursorForm();
            form.LoadSprites(sprites);
            ready.Set();
            Application.Run(form);
        }
        catch (Exception ex)
        {
            try { Console.Error.WriteLine("cursor thread: " + ex); } catch { }
            ready.Set();
        }
    }

    public static bool Do(Action a, int timeoutMs)
    {
        if (form == null) return false;
        try
        {
            IAsyncResult r = form.BeginInvoke(a);
            return r.AsyncWaitHandle.WaitOne(timeoutMs > 0 ? timeoutMs : 2000);
        }
        catch { return false; }
    }

    public static void SetMode(string mode, int holdMs)
    {
        Mode = (mode == "clean") ? "clean" : "companion";
        if (holdMs > 0) HoldMs = holdMs;
        Do(delegate { form.ApplyMode(Mode, HoldMs); }, 1200);
    }

    public static void SetSize(int px)
    {
        SizePx = Math.Max(24, Math.Min(192, px));
        Do(delegate { form.ApplySize(SizePx); }, 1500);
    }

    public static void SetStyle(string style)
    {
        Style = string.IsNullOrEmpty(style) ? "pointer" : style.ToLowerInvariant();
        Do(delegate { form.ApplyStyle(Style); }, 1200);
    }

    // show / move：x,y 是屏幕物理像素，指光标左上角。
    public static void ShowAt(int x, int y)
    {
        Start();
        Do(delegate { form.PlaceAt(x, y); form.MakeVisible(true); }, 1500);
    }
    public static void GlideTo(int x, int y, int ms)
    {
        Start();
        Do(delegate { form.GlideTo(x, y, ms); }, 1500);
    }
    public static void Hide()
    {
        if (form == null) return;
        Do(delegate { form.MakeVisible(false); }, 1200);
    }

    public static string StateJson()
    {
        if (form == null) return "{\"visible\":false,\"started\":false}";
        object[] box = new object[1];
        Do(delegate { box[0] = form.StateJson(); }, 800);
        return box[0] as string ?? "{\"visible\":false,\"started\":true}";
    }

    // -------------------------------------------------------- 窗体
    sealed class CursorForm : Form
    {
        const int CELL = 64;              // 素材是 8 列 × 3 行的雪碧图，每格 64×64
        Image sprite;
        int display = 64;
        int frame = 0;
        int frameCount = 1;
        bool pausedState = false;
        readonly System.Windows.Forms.Timer hideTimer;
        readonly System.Windows.Forms.Timer animTimer;
        readonly System.Windows.Forms.Timer glideTimer;
        int gx0, gy0, gx1, gy1, gms;
        readonly System.Diagnostics.Stopwatch glideClock = new System.Diagnostics.Stopwatch();
        int curX, curY;
        bool hasPos = false;

        public CursorForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(display, display);
            BackColor = Color.Fuchsia;
            TransparencyKey = Color.Fuchsia;
            Visible = false;
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.AllPaintingInWmPaint
                   | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);

            hideTimer = new System.Windows.Forms.Timer();
            hideTimer.Tick += delegate { hideTimer.Stop(); MakeVisible(false); };

            // 雪碧图有 24 格，不切帧的话屏幕上就是一整张 512×192 缩到 64px —— 「糊一团」就是这么来的。
            animTimer = new System.Windows.Forms.Timer();
            animTimer.Interval = 60;
            animTimer.Tick += delegate { if (frameCount > 1) { frame = (frame + 1) % frameCount; Invalidate(); } };

            glideTimer = new System.Windows.Forms.Timer();
            glideTimer.Interval = 16;
            glideTimer.Tick += delegate { GlideTick(); };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                // 不抢焦点、不进 Alt+Tab；穿透点击——光标是画上去的，不该挡住下面的窗口。
                cp.ExStyle |= 0x00000080;  // WS_EX_TOOLWINDOW
                cp.ExStyle |= 0x08000000;  // WS_EX_NOACTIVATE
                cp.ExStyle |= 0x00000020;  // WS_EX_TRANSPARENT
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == DshLiteNative.WM_MOUSEACTIVATE) { m.Result = (IntPtr)DshLiteNative.MA_NOACTIVATE; return; }
            base.WndProc(ref m);
        }

        Dictionary<string, Image> all;

        public void LoadSprites(Dictionary<string, Image> images)
        {
            all = images ?? new Dictionary<string, Image>();
            Pick(DshLiteCursor.Style);
            Invalidate();
        }

        void Pick(string style)
        {
            if (all == null || all.Count == 0) return;
            string key = string.IsNullOrEmpty(style) ? "pointer" : style.ToLowerInvariant();
            if (!all.ContainsKey(key)) key = all.ContainsKey("pointer") ? "pointer" : (new List<string>(all.Keys))[0];
            sprite = all[key];
            DshLiteCursor.Style = key;
            // 这张图是若干格拼的，算出总格数并开始循环
            int cols = Math.Max(1, sprite.Width / CELL);
            int rows = Math.Max(1, sprite.Height / CELL);
            frameCount = cols * rows;
            if (frame >= frameCount) frame = 0;
            try { animTimer.Start(); } catch { }
        }

        public void ApplyStyle(string style)
        {
            Pick(style);
            Invalidate();
        }

        public void ApplySize(int px)
        {
            display = px;
            Size = new Size(display, display);
            Invalidate();
        }

        public void ApplyMode(string mode, int holdMs)
        {
            if (mode == "clean" && Visible)
            {
                hideTimer.Stop();
                hideTimer.Interval = Math.Max(200, holdMs);
                hideTimer.Start();
            }
            else hideTimer.Stop();
        }

        public void PlaceAt(int x, int y)
        {
            curX = x; curY = y; hasPos = true;
            DshLiteNative.SetWindowPos(Handle, DshLiteNative.HWND_TOPMOST, x, y, display, display,
                DshLiteNative.SWP_NOACTIVATE | DshLiteNative.SWP_SHOWWINDOW);
        }

        public void GlideTo(int x, int y, int ms)
        {
            if (!hasPos || ms <= 0) { PlaceAt(x, y); return; }
            gx0 = curX; gy0 = curY; gx1 = x; gy1 = y; gms = Math.Max(60, ms);
            glideClock.Restart();
            glideTimer.Start();
        }

        void GlideTick()
        {
            double t = Math.Min(1.0, glideClock.Elapsed.TotalMilliseconds / gms);
            double e = 1 - Math.Pow(1 - t, 3);          // ease-out cubic
            int x = (int)Math.Round(gx0 + (gx1 - gx0) * e);
            int y = (int)Math.Round(gy0 + (gy1 - gy0) * e);
            curX = x; curY = y;
            DshLiteNative.SetWindowPos(Handle, DshLiteNative.HWND_TOPMOST, x, y, display, display,
                DshLiteNative.SWP_NOACTIVATE | DshLiteNative.SWP_SHOWWINDOW);
            if (t >= 1.0) glideTimer.Stop();
        }

        public void MakeVisible(bool on)
        {
            if (on)
            {
                if (!hasPos)
                {
                    Point p; DshLiteNative.GetCursorPos(out p);
                    curX = p.X + 24; curY = p.Y + 24; hasPos = true;
                }
                Visible = true;
                DshLiteNative.SetWindowPos(Handle, DshLiteNative.HWND_TOPMOST, curX, curY, display, display,
                    DshLiteNative.SWP_NOACTIVATE | DshLiteNative.SWP_SHOWWINDOW);
                Invalidate();
                if (DshLiteCursor.Mode == "clean")
                {
                    hideTimer.Stop();
                    hideTimer.Interval = Math.Max(200, DshLiteCursor.HoldMs);
                    hideTimer.Start();
                }
            }
            else { hideTimer.Stop(); glideTimer.Stop(); Visible = false; }
        }

        public string StateJson()
        {
            return "{\"visible\":" + (Visible ? "true" : "false")
                 + ",\"started\":true,\"x\":" + curX + ",\"y\":" + curY
                 + ",\"size\":" + display
                 + ",\"style\":\"" + DshLiteCursor.Style + "\""
                 + ",\"mode\":\"" + DshLiteCursor.Mode + "\",\"paused\":" + (pausedState ? "true" : "false") + "}";
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (sprite == null) return;
            e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
            e.Graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
            // 只画当前这一格（不切帧就是把整张 8×3 的图缩成 64px —— 「糊一团」的由来）
            int cols = Math.Max(1, sprite.Width / CELL);
            int fr = frameCount > 1 ? (frame / cols) : 0;
            int fc = frameCount > 1 ? (frame % cols) : 0;
            e.Graphics.DrawImage(sprite,
                new Rectangle(0, 0, display, display),
                new Rectangle(fc * CELL, fr * CELL, CELL, CELL),
                GraphicsUnit.Pixel);
        }
    }
}

// ============================================================ 气泡
public static class DshLiteBubble
{
    public static string LastText = "";
    public static string LastAt = "";

    public static void Say(string text, int x, int y, int ms, int anchorX, int anchorY)
    {
        // 自己起一个 STA 线程：气泡是「说一句就走」，不该跟光标抢那条 UI 线程。
        Thread t = new Thread(delegate()
        {
            try
            {
                BubbleForm f = new BubbleForm(text, ms);
                f.ShowNear(x, y, anchorX, anchorY);
                Application.Run(f);
            }
            catch (Exception ex) { try { Console.Error.WriteLine("bubble: " + ex.Message); } catch { } }
        });
        t.IsBackground = true;
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
    }

    sealed class BubbleForm : Form
    {
        readonly System.Windows.Forms.Timer life;
        readonly string text;
        public BubbleForm(string t, int ms)
        {
            text = t ?? "";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(24, 24, 30);
            Opacity = 0.96;
            Padding = new Padding(12, 9, 12, 9);
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            Font = new Font("Microsoft YaHei UI", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
            Size = Measure(text);
            life = new System.Windows.Forms.Timer();
            life.Interval = Math.Max(600, ms);
            life.Tick += delegate { life.Stop(); Close(); };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00000080;  // TOOLWINDOW
                cp.ExStyle |= 0x08000000;  // NOACTIVATE：不抢焦点
                return cp;
            }
        }

        Size Measure(string t)
        {
            using (Graphics g = CreateGraphics())
            {
                SizeF sz = g.MeasureString(t, Font, 420);
                return new Size(Math.Max(80, (int)Math.Ceiling(sz.Width) + Padding.Horizontal + 6),
                                Math.Max(30, (int)Math.Ceiling(sz.Height) + Padding.Vertical + 6));
            }
        }

        public void ShowNear(int x, int y, int anchorX, int anchorY)
        {
            int ax = x, ay = y;
            if (ax == int.MinValue || ay == int.MinValue)
            {
                Point p; DshLiteNative.GetCursorPos(out p);
                ax = p.X; ay = p.Y;
                anchorX = 0; anchorY = 0;
            }
            // 浮在锚点上方；不许出屏。
            int left = ax - Width / 2;
            int top = ay - Height - 18;
            Rectangle vs = Screen.FromPoint(new Point(ax, ay)).WorkingArea;
            if (left < vs.Left + 4) left = vs.Left + 4;
            if (left + Width > vs.Right - 4) left = vs.Right - Width - 4;
            if (top < vs.Top + 4) top = ay + 26;
            Location = new Point(left, top);
            DshLiteBubble.LastAt = left + "," + top + " " + Width + "x" + Height;
            life.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var pen = new Pen(Color.FromArgb(70, 120, 200, 255), 1f))
            using (var path = Round(new Rectangle(0, 0, Width - 1, Height - 1), 10))
                e.Graphics.DrawPath(pen, path);
            using (var br = new SolidBrush(Color.FromArgb(240, 240, 246)))
                e.Graphics.DrawString(text, Font, br, new RectangleF(Padding.Left, Padding.Top, Width - Padding.Horizontal, Height - Padding.Vertical));
        }

        static System.Drawing.Drawing2D.GraphicsPath Round(Rectangle r, int rad)
        {
            var p = new System.Drawing.Drawing2D.GraphicsPath();
            int d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $cs -ReferencedAssemblies @('System.Windows.Forms.dll', 'System.Drawing.dll') -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine("compile failed: " + $_.Exception.Message)
  exit 1
}

# ---------------------------------------------------------------- 光标素材
$assetDir = Join-Path $PSScriptRoot 'assets\cursors'
if (Test-Path $assetDir) { [DshLiteCursor]::LoadSprites($assetDir) }

# 默认档位从环境变量来（插件 config 也会用 set* 覆盖）
if ($env:DSH_CURSOR_MODE -eq 'clean') { [DshLiteCursor]::Mode = 'clean' }
if ($env:DSH_CURSOR_HOLD_MS) { try { [DshLiteCursor]::HoldMs = [int]$env:DSH_CURSOR_HOLD_MS } catch { } }
if ($env:DSH_CURSOR_SIZE) { try { [DshLiteCursor]::SizePx = [Math]::Max(24, [Math]::Min(192, [int]$env:DSH_CURSOR_SIZE)) } catch { } }
if ($env:DSH_CURSOR_STYLE) { [DshLiteCursor]::Style = ([string]$env:DSH_CURSOR_STYLE).ToLower() }

# ---------------------------------------------------------------- 主循环
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  $id = $null
  $resp = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $cmd = [string]$req.cmd
    switch ($cmd) {
      'ping' { $resp = @{ ok = $true; pong = $true } }
      'show' {
        [DshLiteCursor]::Start()
        [DshLiteCursor]::ShowAt([int]$req.x, [int]$req.y)
        $resp = @{ ok = $true; state = ([DshLiteCursor]::StateJson() | ConvertFrom-Json) }
      }
      'move' {
        [DshLiteCursor]::Start()
        $ms = 0; if ($null -ne $req.ms) { $ms = [int]$req.ms }
        if ($ms -gt 0) { [DshLiteCursor]::GlideTo([int]$req.x, [int]$req.y, $ms) }
        else { [DshLiteCursor]::ShowAt([int]$req.x, [int]$req.y) }
        $resp = @{ ok = $true; state = ([DshLiteCursor]::StateJson() | ConvertFrom-Json) }
      }
      'hide' { [DshLiteCursor]::Hide(); $resp = @{ ok = $true } }
      'style' { [DshLiteCursor]::SetStyle([string]$req.name); $resp = @{ ok = $true; style = [DshLiteCursor]::Style } }
      'size' { [DshLiteCursor]::SetSize([int]$req.px); $resp = @{ ok = $true; size = [DshLiteCursor]::SizePx } }
      'mode' {
        $hold = 0; if ($null -ne $req.holdMs) { $hold = [int]$req.holdMs }
        [DshLiteCursor]::SetMode([string]$req.mode, $hold)
        $resp = @{ ok = $true; mode = [DshLiteCursor]::Mode; holdMs = [DshLiteCursor]::HoldMs }
      }
      'status' { $resp = @{ ok = $true; state = ([DshLiteCursor]::StateJson() | ConvertFrom-Json) } }
      'say' {
        $ms = 3200; if ($null -ne $req.ms) { $ms = [int]$req.ms }
        $bx = [int]::MinValue; $by = [int]::MinValue
        if ($null -ne $req.x) { $bx = [int]$req.x }
        if ($null -ne $req.y) { $by = [int]$req.y }
        [DshLiteBubble]::Say([string]$req.text, $bx, $by, $ms, 0, 0)
        # 气泡在自己那条 STA 线程上 Show，这里等它把位置写下来再回话——
        # 不然回执里的 at 是上一次的（等于说「弹出去了」又没有证据）。
        Start-Sleep -Milliseconds 260
        $resp = @{ ok = $true; text = [string]$req.text; at = [DshLiteBubble]::LastAt }
      }
      'shutdown' { $resp = @{ ok = $true }; break }
      default { throw "unknown cmd: $cmd" }
    }
  } catch {
    $resp = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  if ($null -eq $resp) { $resp = @{ id = $id; ok = $false; error = 'no response' } }
  if ($null -eq $resp['id']) { $resp['id'] = $id }
  [DshLiteCursor]::Emit((ConvertTo-Json $resp -Compress -Depth 8))
  if ($cmd -eq 'shutdown') { break }
}
