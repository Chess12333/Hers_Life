# dsh-independent-input sidecar
# Windows PowerShell 5.1, STA. 一条 JSON 一行请求/响应。
# 设计目标：默认不碰主人的真实光标和键盘焦点（UIA / 窗口消息），
# 物理输入只作为显式回退，并且主人一碰鼠标键盘就立刻暂停、还原光标。

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  $OutputEncoding = [Console]::OutputEncoding
} catch { }

# AI 光标模式：companion = 一直陪着；clean = 用一下就收。
# 插件 config / 环境变量都可以改，运行中还能用 setCursorMode 切换。
$script:cursorMode = if ($env:DSH_INPUT_CURSOR_MODE -eq 'clean') { 'clean' } else { 'companion' }
$script:cursorHoldMs = 2600
if ($env:DSH_INPUT_CURSOR_HOLD_MS) {
  try { $script:cursorHoldMs = [int]$env:DSH_INPUT_CURSOR_HOLD_MS } catch { }
}
# AI 光标大小（像素，24–192）。素材是 64×64，按最近邻放大/缩小。
$script:cursorSize = 64
if ($env:DSH_INPUT_CURSOR_SIZE) {
  try { $script:cursorSize = [int]$env:DSH_INPUT_CURSOR_SIZE } catch { }
}
if ($script:cursorSize -lt 24) { $script:cursorSize = 24 }
if ($script:cursorSize -gt 192) { $script:cursorSize = 192 }
# AI 光标样式：主人给的 15 只光标里选一只。
$script:styleNames = @('pointer','work','unavailiable','link','text','cross','busy','move','vert','horz','help','handwriting','dgn1','dgn2','alternate')
$script:cursorStyle = 'pointer'
if ($env:DSH_INPUT_CURSOR_STYLE) {
  $wanted = ([string]$env:DSH_INPUT_CURSOR_STYLE).ToLower()
  if ($script:styleNames -contains $wanted) { $script:cursorStyle = $wanted }
}

# 先声明 DPI 感知，再加载 WinForms / UIA。否则高 DPI 屏上截图坐标和
# UIA FromPoint 会差一个缩放比，点不中目标。
$dpiCode = @'
using System;
using System.Runtime.InteropServices;
public static class DshDpiBootstrap {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Apply() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
    try { SetProcessDPIAware(); } catch { }
  }
}
'@
try { Add-Type -TypeDefinition $dpiCode; [DshDpiBootstrap]::Apply() } catch { }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$script:uia = $true
try {
  Add-Type -AssemblyName WindowsBase
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  $script:uia = $false
}

$refs = @(
  [System.Windows.Forms.Form].Assembly.Location,
  [System.Drawing.Bitmap].Assembly.Location,
  [System.Drawing.Point].Assembly.Location,
  # 2026-11-09：指一下要算「该框哪块」，得在 C# 里直接问 UIA——
  # PS 主循环阻塞在 ReadLine 上，接不住 hover 事件。
  [System.Windows.Automation.AutomationElement].Assembly.Location,
  [System.Windows.Automation.AutomationPattern].Assembly.Location,
  [System.Windows.Point].Assembly.Location
)

$cs = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class DshInput
{
    public const int WH_KEYBOARD_LL = 13;
    public const int WH_MOUSE_LL = 14;

    public const int WM_KEYDOWN = 0x0100;
    public const int WM_KEYUP = 0x0101;
    public const int WM_CHAR = 0x0102;
    public const uint WM_SETTEXT = 0x000C;
    public const int WM_SYSKEYDOWN = 0x0104;
    public const int WM_SYSKEYUP = 0x0105;
    public const int WM_MOUSEMOVE = 0x0200;
    public const int WM_LBUTTONDOWN = 0x0201;
    public const int WM_LBUTTONUP = 0x0202;
    public const int WM_LBUTTONDBLCLK = 0x0203;
    public const int WM_RBUTTONDOWN = 0x0204;
    public const int WM_RBUTTONUP = 0x0205;
    public const int WM_RBUTTONDBLCLK = 0x0206;
    public const int WM_MOUSEWHEEL = 0x020A;
    public const int WM_HOTKEY = 0x0312;
    public const int WM_QUIT = 0x0012;

    public const int MK_LBUTTON = 0x0001;
    public const int MK_RBUTTON = 0x0002;

    public const int GW_OWNER = 4;
    public const int GA_ROOT = 2;
    public const int GWL_STYLE = -16;

    public const int SM_XVIRTUALSCREEN = 76;
    public const int SM_YVIRTUALSCREEN = 77;
    public const int SM_CXVIRTUALSCREEN = 78;
    public const int SM_CYVIRTUALSCREEN = 79;

    public const int SW_RESTORE = 9;
    public const int SWP_NOACTIVATE = 0x0010;
    public const int SWP_SHOWWINDOW = 0x0040;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    public const uint LLMHF_INJECTED = 0x00000001;
    public const uint LLKHF_INJECTED = 0x00000010;

    public const int MOD_ALT = 0x0001;
    public const int MOD_CONTROL = 0x0002;
    public const int MOD_NOREPEAT = 0x4000;
    public const int VK_MENU = 0x12;
    public const int VK_Q = 0x51;
    public const int HOTKEY_ID = 0x4453;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO
    {
        public uint cbSize;
        public uint flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }

    public delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG lpMsg);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLengthW(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    [DllImport("user32.dll")]
    public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")]
    public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [DllImport("kernel32.dll")]
    public static extern ulong GetTickCount64();
    [DllImport("user32.dll")]
    public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
    // 2026-11-08 17:2x astra：真正的 DPI 比例只能问系统要（dpi/96）。
    [DllImport("user32.dll")]
    public static extern uint GetDpiForSystem();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")]
    public static extern IntPtr SetWindowLongPtrW(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hWnd);

    static readonly DateTime StartTime = DateTime.UtcNow;
    static long lastUserInputTicks = 0;
    static long lastInjectedTick = 0;

    public static volatile bool Paused = false;
    public static volatile bool PhysicalActive = false;
    public static string PauseReason = "";
    public static int UserActiveMs = 800;

    static readonly object heldLock = new object();
    static readonly List<ushort> heldKeys = new List<ushort>();
    static bool leftDown = false;
    static bool rightDown = false;

    static POINT savedCursor;
    static bool hasSavedCursor = false;

    static IntPtr mouseHook = IntPtr.Zero;
    static IntPtr keyHook = IntPtr.Zero;
    static Thread hookThread = null;
    static uint hookThreadId = 0;
    static Thread hotkeyThread = null;
    static uint hotkeyThreadId = 0;
    static LowLevelProc mouseProc = MouseHookProc;
    static LowLevelProc keyProc = KeyHookProc;
    public static bool HotkeyRegistered = false;

    static DshInput()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch { try { SetProcessDPIAware(); } catch { } }
        int size = Marshal.SizeOf(typeof(INPUT));
        if (IntPtr.Size == 8 && size != 40) throw new Exception("INPUT size " + size + " is not 40");
    }

    public static long LastUserInputAgeMs()
    {
        try
        {
            LASTINPUTINFO info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            if (GetLastInputInfo(ref info))
            {
                uint now = (uint)(GetTickCount64() & 0xFFFFFFFF);
                return (long)((now - info.dwTime) & 0xFFFFFFFF);
            }
        }
        catch { }
        long last = Interlocked.Read(ref lastUserInputTicks);
        if (last == 0) return -1;
        return (long)((DateTime.UtcNow.Ticks - last) / TimeSpan.TicksPerMillisecond);
    }

    public static int[] CursorPos()
    {
        POINT p;
        GetCursorPos(out p);
        return new int[] { p.X, p.Y };
    }

    public static void SetUserActiveMs(int ms)
    {
        if (ms < 0) ms = 0;
        UserActiveMs = ms;
    }

    static void TouchUserInput()
    {
        Interlocked.Exchange(ref lastUserInputTicks, DateTime.UtcNow.Ticks);
    }

    public static void SimulateUserInput()
    {
        TouchUserInput();
    }

    static IntPtr MouseHookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            MSLLHOOKSTRUCT data = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            if ((data.flags & LLMHF_INJECTED) == 0)
            {
                TouchUserInput();
                if (PhysicalActive)
                {
                    Paused = true;
                    PauseReason = "user-mouse";
                }
            }
        }
        return CallNextHookEx(mouseHook, nCode, wParam, lParam);
    }

    static IntPtr KeyHookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            if ((data.flags & LLKHF_INJECTED) == 0)
            {
                TouchUserInput();
                if (PhysicalActive)
                {
                    Paused = true;
                    PauseReason = "user-keyboard";
                }
            }
        }
        return CallNextHookEx(keyHook, nCode, wParam, lParam);
    }

    public static void StartHotkey()
    {
        if (hotkeyThread != null) return;
        hotkeyThread = new Thread(HotkeyThreadProc);
        hotkeyThread.IsBackground = true;
        hotkeyThread.SetApartmentState(ApartmentState.STA);
        hotkeyThread.Start();
    }

    static void HotkeyThreadProc()
    {
        hotkeyThreadId = GetCurrentThreadId();
        try
        {
            HotkeyRegistered = RegisterHotKey(IntPtr.Zero, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_Q);
        }
        catch { HotkeyRegistered = false; }
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_HOTKEY && msg.wParam.ToInt32() == HOTKEY_ID)
            {
                TogglePause("hotkey");
            }
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
        UnregisterHotKey(IntPtr.Zero, HOTKEY_ID);
        hotkeyThreadId = 0;
    }

    public static void StopHotkey()
    {
        if (hotkeyThreadId != 0)
        {
            PostThreadMessage(hotkeyThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            hotkeyThreadId = 0;
        }
        hotkeyThread = null;
    }

    public static void StartHooks()
    {
        if (hookThread != null) return;
        hookThread = new Thread(HookThreadProc);
        hookThread.IsBackground = true;
        hookThread.SetApartmentState(ApartmentState.STA);
        hookThread.Start();
    }

    static void HookThreadProc()
    {
        hookThreadId = GetCurrentThreadId();
        IntPtr hmod = GetModuleHandle(null);
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, hmod, 0);
        if (mouseHook == IntPtr.Zero) mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, IntPtr.Zero, 0);
        keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, hmod, 0);
        if (keyHook == IntPtr.Zero) keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, IntPtr.Zero, 0);

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
        if (mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
        if (keyHook != IntPtr.Zero) { UnhookWindowsHookEx(keyHook); keyHook = IntPtr.Zero; }
        hookThreadId = 0;
    }

    public static void StopHooks()
    {
        if (hookThreadId != 0)
        {
            PostThreadMessage(hookThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            hookThreadId = 0;
        }
        hookThread = null;
    }

    public static void TogglePause(string reason)
    {
        if (Paused) Resume();
        else Pause(reason);
    }

    public static void Pause(string reason)
    {
        Paused = true;
        PauseReason = reason;
        ReleaseAll();
        DshOverlay.SetPaused(true);
    }

    public static void Resume()
    {
        Paused = false;
        PauseReason = "";
        DshOverlay.SetPaused(false);
    }

    public static void ReleaseAll()
    {
        lock (heldLock)
        {
            for (int i = heldKeys.Count - 1; i >= 0; i--)
            {
                try { SendKeyRaw(heldKeys[i], false, false); } catch { }
            }
            heldKeys.Clear();
            if (leftDown) { try { SendMouseRaw(MOUSEEVENTF_LEFTUP, 0, 0, 0); } catch { } leftDown = false; }
            if (rightDown) { try { SendMouseRaw(MOUSEEVENTF_RIGHTUP, 0, 0, 0); } catch { } rightDown = false; }
        }
        RestoreCursor();
    }

    static void SaveCursor()
    {
        if (!hasSavedCursor)
        {
            POINT p;
            if (GetCursorPos(out p))
            {
                savedCursor = p;
                hasSavedCursor = true;
            }
        }
    }

    static void RestoreCursor()
    {
        if (hasSavedCursor)
        {
            try { SetCursorPos(savedCursor.X, savedCursor.Y); } catch { }
            hasSavedCursor = false;
        }
    }

    static void CheckReadyForPhysical()
    {
        if (Paused) throw new Exception("paused: " + PauseReason);
        long hookLast = Interlocked.Read(ref lastUserInputTicks);
        if (hookLast != 0)
        {
            long hookAge = (long)((DateTime.UtcNow.Ticks - hookLast) / TimeSpan.TicksPerMillisecond);
            if (hookAge >= 0 && hookAge < UserActiveMs) throw new Exception("user-active");
        }
        long age = LastUserInputAgeMs();
        if (age >= 0 && age < UserActiveMs)
        {
            long injected = Interlocked.Read(ref lastInjectedTick);
            bool ownInjection = false;
            if (injected != 0)
            {
                long now = (long)(GetTickCount64() & 0xFFFFFFFF);
                long since = (now - injected) & 0xFFFFFFFF;
                ownInjection = Math.Abs(age - since) <= 80;
            }
            if (!ownInjection) throw new Exception("user-active");
        }
    }

    static void MoveRaw(int x, int y)
    {
        int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int width = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
        int height = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
        int nx = (int)Math.Round((x - left) * 65535.0 / Math.Max(1, width - 1));
        int ny = (int)Math.Round((y - top) * 65535.0 / Math.Max(1, height - 1));
        SendMouseRaw(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny, 0);
        Thread.Sleep(12);
    }

    // 2026-11-08 17:2x astra：坐标空间一直是猜的，这里把它量出来。
    //   给 (x,y) → MoveRaw → GetCursorPos 读回，误差即两个空间的比例信息。
    //   调完立刻 RestoreCursor，不留在外面。
    public static int[] Calibrate(int x, int y)
    {
        SaveCursor();
        try
        {
            MoveRaw(x, y);
            System.Threading.Thread.Sleep(60);
            POINT p;
            bool ok = GetCursorPos(out p);
            int rx = ok ? p.X : -1;
            int ry = ok ? p.Y : -1;
            return new int[] { rx, ry, rx - x, ry - y };
        }
        finally { RestoreCursor(); }
    }

    static void SendMouseRaw(uint flags, int dx, int dy, int data)
    {
        INPUT input = new INPUT();
        input.type = INPUT_MOUSE;
        input.u.mi.dx = dx;
        input.u.mi.dy = dy;
        input.u.mi.mouseData = (uint)data;
        input.u.mi.dwFlags = flags;
        input.u.mi.time = 0;
        input.u.mi.dwExtraInfo = IntPtr.Zero;
        INPUT[] inputs = new INPUT[] { input };
        if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new Exception("SendInput mouse failed");
        Interlocked.Exchange(ref lastInjectedTick, (long)(GetTickCount64() & 0xFFFFFFFF));
    }

    static void SendKeyRaw(ushort vk, bool down, bool extended)
    {
        INPUT input = new INPUT();
        input.type = INPUT_KEYBOARD;
        input.u.ki.wVk = vk;
        input.u.ki.wScan = 0;
        input.u.ki.dwFlags = (down ? 0u : KEYEVENTF_KEYUP) | (extended ? KEYEVENTF_EXTENDEDKEY : 0u);
        input.u.ki.time = 0;
        input.u.ki.dwExtraInfo = IntPtr.Zero;
        INPUT[] inputs = new INPUT[] { input };
        if (SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new Exception("SendInput keyboard failed");
        Interlocked.Exchange(ref lastInjectedTick, (long)(GetTickCount64() & 0xFFFFFFFF));
    }

    static void SendUnicodeChar(char ch)
    {
        INPUT down = new INPUT();
        down.type = INPUT_KEYBOARD;
        down.u.ki.wVk = 0;
        down.u.ki.wScan = (ushort)ch;
        down.u.ki.dwFlags = KEYEVENTF_UNICODE;
        INPUT up = down;
        up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
        INPUT[] inputs = new INPUT[] { down, up };
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2)
            throw new Exception("SendInput unicode failed");
        Interlocked.Exchange(ref lastInjectedTick, (long)(GetTickCount64() & 0xFFFFFFFF));
    }

    // 2026-11-09：菜单里点一下之后，光标必须留在原地。
    //   子菜单是「鼠标停在父项上」撑着的；点完立刻把光标拽回她手上，子菜单就塌掉，
    //   于是「右键 → 新建 → 新建文件夹」这种两步动作永远走不完。
    public static bool IsMenuAt(int x, int y)
    {
        POINT p;
        p.X = x;
        p.Y = y;
        IntPtr h = WindowFromPoint(p);
        if (h == IntPtr.Zero) return false;
        string cls = WindowClass(h);
        return cls == "#32768" || cls.IndexOf("Menu", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    public static bool PhysicalClick(int x, int y, bool right, int count)
    {
        if (count < 1) count = 1;
        CheckReadyForPhysical();
        StartHooks();
        SaveCursor();
        PhysicalActive = true;
        bool keep = false;
        try
        {
            MoveRaw(x, y);
            // 2026-11-09：落位后停一下再按。菜单/悬停类界面靠 WM_MOUSEMOVE 先认「在哪个项上」，
            //   12ms 就按下去，菜单还在处理移动，点击会被当成落在分隔缝上。
            Thread.Sleep(150);
            for (int i = 0; i < count; i++)
            {
                if (Paused) throw new Exception("paused: " + PauseReason);
                if (right)
                {
                    SendMouseRaw(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0);
                    rightDown = true;
                    Thread.Sleep(30);
                    SendMouseRaw(MOUSEEVENTF_RIGHTUP, 0, 0, 0);
                    rightDown = false;
                }
                else
                {
                    SendMouseRaw(MOUSEEVENTF_LEFTDOWN, 0, 0, 0);
                    leftDown = true;
                    Thread.Sleep(30);
                    SendMouseRaw(MOUSEEVENTF_LEFTUP, 0, 0, 0);
                    leftDown = false;
                }
                Thread.Sleep(80);
            }
        }
        finally
        {
            keep = false;
            try { keep = IsMenuAt(x, y); } catch { }
            PhysicalActive = false;
            ReleaseAll();
            if (!keep) RestoreCursor();
            StopHooks();
        }
        return keep;
    }

    public static void PhysicalText(string text)
    {
        CheckReadyForPhysical();
        StartHooks();
        PhysicalActive = true;
        try
        {
            int i = 0;
            foreach (char ch in text)
            {
                if (Paused) throw new Exception("paused: " + PauseReason);
                SendUnicodeChar(ch);
                i++;
                if ((i % 24) == 0) Thread.Sleep(4);
            }
        }
        finally
        {
            PhysicalActive = false;
            StopHooks();
        }
    }

    public static void PhysicalKeySequence(ushort[] keys)
    {
        if (keys == null || keys.Length == 0) throw new Exception("keys required");
        CheckReadyForPhysical();
        StartHooks();
        PhysicalActive = true;
        try
        {
            lock (heldLock)
            {
                for (int i = 0; i < keys.Length; i++)
                {
                    if (Paused) throw new Exception("paused: " + PauseReason);
                    SendKeyRaw(keys[i], true, false);
                    heldKeys.Add(keys[i]);
                    Thread.Sleep(15);
                }
            }
            Thread.Sleep(35);
        }
        finally
        {
            PhysicalActive = false;
            ReleaseAll();
            StopHooks();
        }
    }

    public static void PhysicalScroll(int x, int y, int delta)
    {
        CheckReadyForPhysical();
        StartHooks();
        SaveCursor();
        PhysicalActive = true;
        try
        {
            MoveRaw(x, y);
            SendMouseRaw(MOUSEEVENTF_WHEEL, 0, 0, delta);
            Thread.Sleep(90);
        }
        finally
        {
            PhysicalActive = false;
            RestoreCursor();
            StopHooks();
        }
    }

    static void DragLog(string s)
    {
        try
        {
            string p = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "ming-mousepet", "drag.log");
            System.IO.File.AppendAllText(p, DateTime.Now.ToString("HH:mm:ss.fff") + " " + s + "\r\n");
        }
        catch { }
    }
    static string CurPos()
    {
        POINT p; GetCursorPos(out p); return p.X + "," + p.Y;
    }

    // 2026-11-09：拖拽参数可调（~/.dsh/ming-mousepet/drag.json），换引擎/换目标不用改代码重编译
    static string DragCfgText()
    {
        try
        {
            string p = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "ming-mousepet", "drag.json");
            if (System.IO.File.Exists(p)) return System.IO.File.ReadAllText(p);
        }
        catch { }
        return "";
    }
    static int IntAfter(string s, string key, int def)
    {
        int i = s.IndexOf("\"" + key + "\"");
        if (i < 0) return def;
        int c = s.IndexOf(':', i);
        if (c < 0) return def;
        int j = c + 1; int v = 0; bool any = false;
        while (j < s.Length && (s[j] == ' ' || s[j] == '\t')) j++;
        while (j < s.Length && s[j] >= '0' && s[j] <= '9') { v = v * 10 + (s[j] - '0'); any = true; j++; }
        return any ? v : def;
    }
    static int DragCfgHold(int def) { return IntAfter(DragCfgText(), "hold", def); }
    static bool DragCfgRelative()
    {
        string s = DragCfgText();
        if (s.IndexOf("\"relative\":false") >= 0) return false;
        if (s.IndexOf("\"relative\": false") >= 0) return false;
        return true;
    }

    public static void PhysicalDrag(int x1, int y1, int x2, int y2, int durationMs, int holdMs)
    {
        CheckReadyForPhysical();
        StartHooks();
        SaveCursor();
        PhysicalActive = true;
        try
        {
            // 2026-11-09：拖拽前先把起点下面的窗口提到前台。
            // 实测：MuMu 里点击能到（DOWN/UP 走窗口命中），但按下之后的移动到不了（非前台窗口收不到 WM_MOUSEMOVE），
            // 表现就是「点了没事、拖了不动」。先激活再按。
            POINT startPt; startPt.X = x1; startPt.Y = y1;
            IntPtr dragTarget = WindowFromPoint(startPt);
            if (dragTarget != IntPtr.Zero) dragTarget = GetAncestor(dragTarget, (uint)GA_ROOT);
            if (dragTarget != IntPtr.Zero) { try { FocusWindow(dragTarget); } catch { } Thread.Sleep(250); }
            DragLog("start target=" + dragTarget + " hold=" + holdMs + " rel=" + DragCfgRelative());
            // 2026-11-09：按下之前必须确认光标真的落在起点上。
            // 实测日志：激活窗口后的第一发 MoveRaw 不生效，光标停在 0,0，于是「按下」发生在左上角，
            // 拖动看起来完全没反应（点击没事，因为点击路径不是这个形状）。
            bool landed = false;
            for (int t = 0; t < 10; t++)
            {
                Thread.Sleep(40);
                POINT cp; GetCursorPos(out cp);
                if (Math.Abs(cp.X - x1) <= 1 && Math.Abs(cp.Y - y1) <= 1) { landed = true; break; }
                MoveRaw(x1, y1);
            }
            DragLog("moved-to " + CurPos() + " want=" + x1 + "," + y1 + " landed=" + landed);
            if (!landed) throw new Exception("cursor-mismatch: want " + x1 + "," + y1 + " got " + CurPos());
            Thread.Sleep(80);
            SendMouseRaw(MOUSEEVENTF_LEFTDOWN, 0, 0, 0);
            leftDown = true;
            DragLog("down at " + CurPos());
            // 2026-11-09 浔：「拖动功能需要先按住，再进行拖动」。
            // Android 桌面/启动器要长按（约 400-600ms）才进入拖拽态，按完立刻移动会被当成滑动。
            if (holdMs <= 0) { holdMs = DragCfgHold(800); }
            Thread.Sleep(holdMs);
            bool relDrag = DragCfgRelative();
            int steps = Math.Max(8, Math.Min(120, durationMs / 12));
            int px = x1, py = y1;
            for (int i = 1; i <= steps; i++)
            {
                if (Paused) throw new Exception("paused: " + PauseReason);
                int x = x1 + (x2 - x1) * i / steps;
                int y = y1 + (y2 - y1) * i / steps;
                if (relDrag) { SendMouseRaw(MOUSEEVENTF_MOVE, x - px, y - py, 0); px = x; py = y; }
                else { MoveRaw(x, y); }
                if (i % 12 == 0) DragLog("step " + i + "/" + steps + " pos=" + CurPos());
                Thread.Sleep(12);
            }
            // 落点停一下再松手：目标要能收到 hover/进入状态
            DragLog("pre-up " + CurPos());
            Thread.Sleep(120);
            SendMouseRaw(MOUSEEVENTF_LEFTUP, 0, 0, 0);
            leftDown = false;
            Thread.Sleep(60);
        }
        finally
        {
            PhysicalActive = false;
            ReleaseAll();
            RestoreCursor();
            StopHooks();
        }
    }

    public static IntPtr FocusWindow(IntPtr hwnd)
    {
        IntPtr prev = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return prev;
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        SendKeyRaw(VK_MENU, true, false);
        try { SetForegroundWindow(hwnd); }
        finally { SendKeyRaw(VK_MENU, false, false); }
        Thread.Sleep(70);
        return prev;
    }

    public static IntPtr GetFocusWindow()
    {
        GUITHREADINFO gti = new GUITHREADINFO();
        gti.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
        if (GetGUIThreadInfo(0, ref gti))
        {
            if (gti.hwndFocus != IntPtr.Zero) return gti.hwndFocus;
            if (gti.hwndActive != IntPtr.Zero) return gti.hwndActive;
        }
        return GetForegroundWindow();
    }

    public static IntPtr WindowAt(int x, int y)
    {
        POINT p;
        p.X = x;
        p.Y = y;
        return WindowFromPoint(p);
    }

    public static IntPtr RootOf(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return IntPtr.Zero;
        IntPtr root = GetAncestor(hwnd, (uint)GA_ROOT);
        return root == IntPtr.Zero ? hwnd : root;
    }

    public static string WindowTitle(IntPtr hwnd)
    {
        int length = GetWindowTextLengthW(hwnd);
        if (length <= 0) return "";
        StringBuilder sb = new StringBuilder(length + 2);
        GetWindowTextW(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string WindowClass(IntPtr hwnd)
    {
        StringBuilder sb = new StringBuilder(512);
        GetClassNameW(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    public static int WindowPid(IntPtr hwnd)
    {
        int pid;
        GetWindowThreadProcessId(hwnd, out pid);
        return pid;
    }

    public static int[] WindowRect(IntPtr hwnd)
    {
        RECT r;
        if (DwmGetWindowAttribute(hwnd, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0)
        {
            if (!GetWindowRect(hwnd, out r)) return new int[] { 0, 0, 0, 0 };
        }
        return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }

    public static long WindowExStyle(IntPtr hwnd)
    {
        return (long)GetWindowLongPtrW(hwnd, -20);
    }

    public static IntPtr[] EnumTopWindows()
    {
        List<IntPtr> list = new List<IntPtr>();
        EnumWindows(delegate(IntPtr h, IntPtr l) { list.Add(h); return true; }, IntPtr.Zero);
        return list.ToArray();
    }

    public static void PostMouseClick(IntPtr hwnd, int x, int y, bool right, int count)
    {
        if (count < 1) count = 1;
        POINT p;
        p.X = x;
        p.Y = y;
        if (!ScreenToClient(hwnd, ref p)) throw new Exception("ScreenToClient failed");
        int lp = (p.Y << 16) | (p.X & 0xFFFF);
        uint down = right ? (uint)WM_RBUTTONDOWN : (uint)WM_LBUTTONDOWN;
        uint up = right ? (uint)WM_RBUTTONUP : (uint)WM_LBUTTONUP;
        uint dbl = right ? (uint)WM_RBUTTONDBLCLK : (uint)WM_LBUTTONDBLCLK;
        int mk = right ? MK_RBUTTON : MK_LBUTTON;
        PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, new IntPtr(lp));
        Thread.Sleep(8);
        for (int i = 0; i < count; i++)
        {
            uint msg = (i == 1) ? dbl : down;
            if (!PostMessage(hwnd, msg, new IntPtr(mk), new IntPtr(lp))) throw new Exception("PostMessage down failed");
            Thread.Sleep(28);
            if (!PostMessage(hwnd, up, IntPtr.Zero, new IntPtr(lp))) throw new Exception("PostMessage up failed");
            Thread.Sleep(55);
        }
    }

    public static void PostMouseScroll(IntPtr hwnd, int x, int y, int delta)
    {
        int lp = (y << 16) | (x & 0xFFFF);
        int wp = (delta << 16);
        if (!PostMessage(hwnd, WM_MOUSEWHEEL, new IntPtr(wp), new IntPtr(lp))) throw new Exception("PostMessage wheel failed");
    }

    public static void PostMouseDrag(IntPtr hwnd, int x1, int y1, int x2, int y2, int steps)
    {
        if (steps < 2) steps = 2;
        POINT a;
        a.X = x1;
        a.Y = y1;
        if (!ScreenToClient(hwnd, ref a)) throw new Exception("ScreenToClient failed");
        int lp1 = (a.Y << 16) | (a.X & 0xFFFF);
        PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, new IntPtr(lp1));
        PostMessage(hwnd, WM_LBUTTONDOWN, new IntPtr(MK_LBUTTON), new IntPtr(lp1));
        for (int i = 1; i <= steps; i++)
        {
            int sx = x1 + (x2 - x1) * i / steps;
            int sy = y1 + (y2 - y1) * i / steps;
            POINT p;
            p.X = sx;
            p.Y = sy;
            if (!ScreenToClient(hwnd, ref p)) continue;
            int lp = (p.Y << 16) | (p.X & 0xFFFF);
            PostMessage(hwnd, WM_MOUSEMOVE, new IntPtr(MK_LBUTTON), new IntPtr(lp));
            Thread.Sleep(16);
        }
        POINT b;
        b.X = x2;
        b.Y = y2;
        if (ScreenToClient(hwnd, ref b))
        {
            int lp2 = (b.Y << 16) | (b.X & 0xFFFF);
            PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, new IntPtr(lp2));
        }
    }

    public static void PostKey(IntPtr hwnd, int vk, bool down, bool extended, bool sys)
    {
        int scan = (int)MapVirtualKey((uint)vk, 0);
        int lParam = 1 | (scan << 16);
        if (extended) lParam |= (1 << 24);
        if (!down) lParam |= (1 << 30);
        if (!down) lParam |= unchecked((int)(1u << 31));
        uint msg = down ? (sys ? (uint)WM_SYSKEYDOWN : (uint)WM_KEYDOWN) : (sys ? (uint)WM_SYSKEYUP : (uint)WM_KEYUP);
        if (!PostMessage(hwnd, msg, new IntPtr(vk), new IntPtr(lParam))) throw new Exception("PostMessage key failed");
    }

    public static void PostText(IntPtr hwnd, string text)
    {
        foreach (char ch in text)
        {
            if (!PostMessage(hwnd, WM_CHAR, new IntPtr((int)ch), new IntPtr(1))) throw new Exception("PostMessage char failed");
            Thread.Sleep(2);
        }
    }

    public static string GetWindowText(IntPtr hwnd)
    {
        return WindowTitle(hwnd);
    }

    public static bool SetTextMessage(IntPtr hwnd, string text)
    {
        SendMessageW(hwnd, WM_SETTEXT, IntPtr.Zero, text);
        return true;
    }

    public static string CapturePng(string path, int x, int y, int w, int h)
    {
        if (w <= 0 || h <= 0)
        {
            x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        }
        using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
            }
            bmp.Save(path, ImageFormat.Png);
        }
        return path;
    }
}

public static class DshOverlayGeometry
{
    public static double Progress(double elapsedMs, int durationMs)
    { return Math.Max(0.0, Math.Min(1.0, elapsedMs / Math.Max(1, durationMs))); }

    static Point Clamp(Point p, Size size, Rectangle wa)
    {
        return new Point(Math.Max(wa.Left + 8, Math.Min(p.X, wa.Right - 8 - size.Width)),
            Math.Max(wa.Top + 8, Math.Min(p.Y, wa.Bottom - 8 - size.Height)));
    }

    public static Point BubbleLocation(Rectangle anchor, Size size, Rectangle wa, Point cursor)
    {
        Rectangle hot = new Rectangle(cursor.X - 2, cursor.Y - 2, 30, 36);
        Rectangle pet = Rectangle.Inflate(anchor, 4, 4);
        Point[] candidates = new Point[] {
            new Point(anchor.Left + anchor.Width / 2 - size.Width / 2, anchor.Top - size.Height - 18),
            new Point(anchor.Left + anchor.Width / 2 - size.Width / 2, anchor.Bottom + 18),
            new Point(anchor.Right + 12, anchor.Top - size.Height - 12),
            new Point(anchor.Left - size.Width - 12, anchor.Top - size.Height - 12),
            new Point(anchor.Right + 12, anchor.Top),
            new Point(anchor.Left - size.Width - 12, anchor.Top)
        };
        Point fallback = Clamp(candidates[0], size, wa);
        foreach (Point candidate in candidates)
        {
            Point p = Clamp(candidate, size, wa);
            Rectangle r = new Rectangle(p, size);
            if (!r.IntersectsWith(hot) && !r.IntersectsWith(pet)) return p;
        }
        return fallback;
    }
}

public static class DshOverlay
{
    static readonly object boundsLock = new object();
    static Rectangle actualBounds;
    static bool hasBounds;
    public static bool TryGetBounds(out Rectangle bounds)
    {
        lock (boundsLock) { bounds = actualBounds; return hasBounds; }
    }
    public static void PublishBounds(IntPtr handle)
    {
        DshInput.RECT r;
        if (!DshInput.GetWindowRect(handle, out r)) return;
        lock (boundsLock)
        {
            actualBounds = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
            hasBounds = true;
            LastX = r.Left; LastY = r.Top; HasLast = true;
        }
    }
    public static void OnUi(Action action)
    {
        Start();
        form.BeginInvoke(action);
    }

    // 要「做完再回话」的界面动作（开卡片、写一行、量尺寸）走这条：等 UI 线程跑完再返回。
    public static bool Do(Action action, int timeoutMs)
    {
        Start();
        return Run(action, timeoutMs > 0 ? timeoutMs : 3000);
    }
    static Thread thread = null;
    static OverlayForm form = null;
    static ManualResetEvent ready = new ManualResetEvent(false);
    static bool pausedState = false;
    static readonly Dictionary<string, Image> styleImages = new Dictionary<string, Image>(StringComparer.OrdinalIgnoreCase);
    public static bool LastSetWindowPosOk = false;
    public static int LastSetWindowPosError = 0;
    public static int LastX = 0;
    public static int LastY = 0;
    public static bool HasLast = false;
    // 2026-11-08 21:1x 浔：「点按桌宠直接进行一次不记次数的活动，长按拖动」。
    // 轻点 → 往 stdout 抛一行事件，Node 侧收到就叫桌宠说一句（不占自动开口配额）。
    // 写管道和主循环写响应会撞车，统一走这把锁。
    static readonly object outLock = new object();
    public static void EmitLine(string json)
    {
        if (string.IsNullOrEmpty(json)) return;
        lock (outLock)
        {
            try { Console.Out.WriteLine(json); Console.Out.Flush(); } catch { }
        }
    }
    public static void EmitTap(int x, int y)
    {
        EmitLine("{\"event\":\"tap\",\"x\":" + x + ",\"y\":" + y + "}");
    }
    static string cursorStyle = "pointer";
    static string cursorMode = "companion";
    static int cursorHoldMs = 2600;
    internal static int cursorSize = 64;

    static readonly string[] StyleNames = {
        "pointer", "work", "unavailiable", "link", "text",
        "cross", "busy", "move", "vert", "horz",
        "help", "handwriting", "dgn1", "dgn2", "alternate"
    };

    public static void ConfigureStyles(string assetDir)
    {
        styleImages.Clear();
        for (int i = 0; i < StyleNames.Length; i++)
        {
            string name = StyleNames[i];
            string path = System.IO.Path.Combine(assetDir, name + ".png");
            if (!System.IO.File.Exists(path)) continue;
            try { styleImages[name] = Image.FromFile(path); } catch { }
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
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
            {
                try { Console.Error.WriteLine("overlay: " + e.Exception); } catch { }
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                try { Console.Error.WriteLine("overlay fatal: " + e.ExceptionObject); } catch { }
            };
            form = new OverlayForm();
            form.LoadSprites(styleImages);
            form.ApplyStyle(cursorStyle);
            form.Paused = pausedState;
            form.ApplyMode(cursorMode, cursorHoldMs);
            form.ApplySize(cursorSize);
            form.Location = new Point(-10000, -10000);
            form.Show();
            form.Hide();
            ready.Set();
            try { Application.Run(); }
            catch (Exception ex) { try { Console.Error.WriteLine("overlay run: " + ex); } catch { } }
        }
        catch { ready.Set(); }
    }

    static bool Run(Action action, int timeoutMs)
    {
        if (form == null) return false;
        try
        {
            using (ManualResetEvent done = new ManualResetEvent(false))
            {
                form.BeginInvoke(new Action(delegate() { try { action(); } finally { done.Set(); } }));
                return done.WaitOne(timeoutMs);
            }
        }
        catch { return false; }
    }

    public static void ShowAt(int x, int y)
    {
        Start();
        Run(delegate() { form.DisplayAt(x, y); }, 900);
    }

    public static void SetMode(string mode, int holdMs)
    {
        cursorMode = (mode == "clean") ? "clean" : "companion";
        cursorHoldMs = holdMs > 0 ? holdMs : 2600;
        if (form == null) return;
        Run(delegate() { form.ApplyMode(cursorMode, cursorHoldMs); }, 400);
    }

    public static void SetSize(int size)
    {
        cursorSize = Math.Max(24, Math.Min(192, size));
        if (form == null) return;
        Run(delegate() { form.ApplySize(cursorSize); }, 900);
    }

    public static void SetStyle(string style)
    {
        string key = string.IsNullOrEmpty(style) ? "pointer" : style.ToLowerInvariant();
        bool known = false;
        for (int i = 0; i < StyleNames.Length; i++) { if (StyleNames[i] == key) { known = true; break; } }
        cursorStyle = known ? key : "pointer";
        if (form == null) return;
        Run(delegate() { form.ApplyStyle(cursorStyle); }, 500);
    }

    public static void SetPaused(bool paused)
    {
        pausedState = paused;
        if (form == null) return;
        Run(delegate() { form.Paused = paused; }, 400);
    }

    // 2026-11-08 16:3x 浔：「让光标自己去点、右键、拖动」
    // 光标先飞到目标旁边（右下 24,22 —— 别挡住自己要点的地方），再发真实鼠标事件，
    // 完了停在动作结束的位置。真实光标由 Physical* 自己保存/恢复，这里不插手。

        // 2026-11-08 21:2x 浔：「不要飘到右下，飘到左上吧。」
        //   素材热点是 (0,0)：箭头尖 = 摆放点，所以往左上让 24,22。
        //   靠近屏幕边缘时夹回工作区，免得整支箭头滑出去看不见。
        static Point ParkUpperLeft(int x, int y)
        {
            Rectangle wa = Screen.FromPoint(new Point(x, y)).WorkingArea;
            int px = x - 24, py = y - 22;
            if (px < wa.Left) px = wa.Left;
            if (py < wa.Top) py = wa.Top;
            if (px > wa.Right - 32) px = wa.Right - 32;
            if (py > wa.Bottom - 32) py = wa.Bottom - 32;
            return new Point(px, py);
        }

    public static void Act(string action, int x, int y, int x2, int y2, int duration, int delta, int hold)
    {
        Start();
        Run(delegate()
        {
            try
            {
                if (form != null) { Point p1 = ParkUpperLeft(x, y); form.DisplayAt(p1.X, p1.Y); }
                System.Threading.Thread.Sleep(150);
                switch (action)
                {
                    case "rightclick": DshInput.PhysicalClick(x, y, true, 1); break;
                    case "doubleclick": DshInput.PhysicalClick(x, y, false, 2); break;
                    case "scroll": DshInput.PhysicalScroll(x, y, delta); break;
                    case "drag": DshInput.PhysicalDrag(x, y, x2, y2, duration > 0 ? duration : 420, hold); break;
                    default: DshInput.PhysicalClick(x, y, false, 1); break;
                }
                int ex = action == "drag" ? x2 : x;
                int ey = action == "drag" ? y2 : y;
                if (form != null) { Point p2 = ParkUpperLeft(ex, ey); form.DisplayAt(p2.X, p2.Y); }
            }
            catch { }
        }, 6000);
    }

    public static void Hide()
    {
        if (form == null) return;
        Run(delegate() { form.HideNow(); }, 500);
    }

    public static bool driftEnabled = true;
    // 2026-11-08：光标不在屏幕中心钉着，跟着她的鼠标走（右下 44,34）。
    public static bool followCursor = false;
    // 2026-11-08 16:5x：定位之后的两秒里不许 drift 改写基点。
    //   不加这个，followCursor 打开时「glide 到目标」永远会被拽回真实光标旁边。
    public static bool holdPos = false;
    public static void HoldPosition(int ms)
    {
        holdPos = true;
        System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
        t.Interval = Math.Max(300, ms);
        t.Tick += delegate { t.Stop(); holdPos = false; };
        t.Start();
    }
    // 2026-11-08：锁定之后鼠标拖不动它。
    public static bool locked = false;
    // 2026-11-09 21:1x：框选/指认之后用哪一档回答。quick=气泡一句话，full=卡片完整回答。
    public static string AnswerMode = "quick";

    public static void SetAnswerMode(string mode)
    {
        string m = (mode == "full") ? "full" : "quick";
        if (m == AnswerMode) return;
        AnswerMode = m;
        try { EmitLine("{\"event\":\"menu\",\"action\":\"answer\",\"mode\":\"" + m + "\"}"); } catch { }
    }   // 2026-11-08 浔：「别跟随，自己晃就可以了」

    // 2026-11-08：关掉之后得告诉她怎么再打开。提示窗在光标那边自己弹，不靠插件。
    public static void Tip(string text)
    {
        Run(delegate()
        {
            try
            {
                Form f = new Form();
                f.FormBorderStyle = FormBorderStyle.None;
                f.StartPosition = FormStartPosition.Manual;
                f.BackColor = Color.FromArgb(42, 52, 72);
                f.TopMost = true;
                f.ShowInTaskbar = false;
                Label lb = new Label();
                lb.Text = text;
                lb.ForeColor = Color.FromArgb(238, 242, 248);
                lb.Dock = DockStyle.Fill;
                lb.TextAlign = ContentAlignment.MiddleCenter;
                lb.Font = new Font("Microsoft YaHei UI", 10f);
                f.Controls.Add(lb);
                f.Size = new Size(420, 72);
                Rectangle wa = Screen.FromPoint(Cursor.Position).WorkingArea;
                f.Location = new Point(wa.X + (wa.Width - f.Width) / 2, wa.Y + wa.Height - 180);
                f.Show();
                System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
                t.Interval = 4500;
                t.Tick += delegate { t.Stop(); f.Close(); };
                t.Start();
            }
            catch { }
        }, 1500);
    }

    // 2026-11-08 17:0x 诊断：把光标放到 (x,y)，返回「记成哪」和「窗口实际在哪」
    public static int[] Probe(int x, int y)
    {
        Start();
        Run(delegate() { form.DisplayAt(x, y); }, 3000);
        System.Threading.Thread.Sleep(350);
        int fx = -1, fy = -1;
        try { if (form != null) { fx = form.Left; fy = form.Top; } } catch { }
        return new int[] { LastX, LastY, fx, fy };
    }

    public static void Glide(int x, int y, int ms)
    {
        if (form == null) Start();
        Run(delegate() { form.GlideTo(x, y, ms); }, 2000);
        // Failure does not publish the requested destination.
    }

    public static void SetSkin(string path)
    {
        if (form == null) return;
        Run(delegate() { form.SetSkin(path); }, 1200);
    }

    public static void SetDrift(bool on)
    {
        driftEnabled = on;
        if (form == null) return;
        Run(delegate() { form.SetDrift(on); }, 800);
    }

    public static bool VisibleNow()
    {
        if (form == null) return false;
        try { return form.Visible; } catch { return false; }
    }

    public static int[] Bounds()
    {
        if (form == null) return new int[] { 0, 0, 0, 0 };
        try { return new int[] { form.Left, form.Top, form.Width, form.Height }; } catch { return new int[] { 0, 0, 0, 0 }; }
    }

    public static long HandleId()
    {
        if (form == null) return 0;
        try { return (long)form.Handle; } catch { return 0; }
    }

    public static void Stop()
    {
        if (form == null) return;
        Run(delegate() { form.HideNow(); Application.ExitThread(); }, 800);
    }

    sealed class OverlayForm : Form
    {
        const int Cell = 64;
        const int Cols = 8;
        readonly System.Windows.Forms.Timer animTimer;
        readonly System.Windows.Forms.Timer hideTimer;
        string mode = "companion";
        int holdMs = 2600;
        Image sprite;
        Dictionary<string, Image> sprites;
        string baseStyle = "pointer";
        int displaySize = 64;
        int lastX = 0;
        int lastY = 0;
        int frame = 0;
        int frameCount = 1;
        bool paused = false;
        // 2026-11-08：活着的光标会轻轻晃，像人在等。
        readonly System.Windows.Forms.Timer driftTimer;
        readonly System.Windows.Forms.Timer glideTimer;
        int gx0, gy0, gx1, gy1, gms;
        readonly System.Diagnostics.Stopwatch glideClock = new System.Diagnostics.Stopwatch();
        int baseX = 0;
        int baseY = 0;
        // 2026-11-09：base 只有一个写入口（SetBase）。这里记「最近一次是谁写的」，只为追时序。
        string baseSource = "init";
        double phase = 0.0;
        bool driftOn = true;

        public OverlayForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(displaySize, displaySize);
            BackColor = Color.Fuchsia;
            TransparencyKey = Color.Fuchsia;
            Visible = false;
            SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            animTimer = new System.Windows.Forms.Timer();
            animTimer.Interval = 60;
            animTimer.Tick += delegate { if (frameCount > 1) { frame = (frame + 1) % frameCount; ApplyFrameRegion(); Invalidate(); } };
            hideTimer = new System.Windows.Forms.Timer();
            hideTimer.Tick += delegate { hideTimer.Stop(); HideNow(); };
            driftTimer = new System.Windows.Forms.Timer();
            driftTimer.Interval = 80;
            driftTimer.Tick += delegate { DriftTick(); };
            glideTimer = new System.Windows.Forms.Timer();
            glideTimer.Interval = 16;
            glideTimer.Tick += delegate { GlideTick(); };
        }

        public void ApplyMode(string m, int h)
        {
            mode = (m == "clean") ? "clean" : "companion";
            holdMs = h > 0 ? h : 2600;
            if (mode == "clean" && Visible)
            {
                hideTimer.Stop();
                hideTimer.Interval = holdMs;
                hideTimer.Start();
            }
            else
            {
                hideTimer.Stop();
            }
        }

        public void LoadSprites(Dictionary<string, Image> images)
        {
            sprites = images != null ? images : new Dictionary<string, Image>();
            if (!sprites.ContainsKey(baseStyle))
            {
                string first = null;
                foreach (string key in sprites.Keys) { first = key; break; }
                baseStyle = first != null ? first : "pointer";
            }
            if (sprites.ContainsKey(baseStyle)) ApplySprite(sprites[baseStyle]);
        }

        public void ApplyStyle(string style)
        {
            if (sprites == null || sprites.Count == 0) return;
            string key = string.IsNullOrEmpty(style) ? "pointer" : style.ToLowerInvariant();
            if (!sprites.ContainsKey(key)) key = sprites.ContainsKey("pointer") ? "pointer" : baseStyle;
            baseStyle = key;
            if (!paused && sprites.ContainsKey(key)) ApplySprite(sprites[key]);
        }

        void ApplySprite(Image img)
        {
            if (img == null) return;
            sprite = img;
            frame = 0;
            frameCount = Math.Max(1, (img.Width / Cell) * (img.Height / Cell));
            Invalidate();
        }

        public void ApplySize(int size)
        {
            size = Math.Max(24, Math.Min(192, size));
            if (size == displaySize && Width == size && Height == size) return;
            displaySize = size;
            if (!Visible) Size = new Size(size, size);
            ApplySprite(sprite);
            if (Visible)
            {
                if (DshBubble.MoveTogether(Handle, DshInput.HWND_TOPMOST, lastX, lastY, size, size,
                    (uint)(DshInput.SWP_NOACTIVATE | DshInput.SWP_SHOWWINDOW)))
                    DshOverlay.PublishBounds(Handle);
            }
        }

        void ApplyFrameRegion()
        {
            // color-key 透明方案不需要 Region；保留空方法避免大改调用点。
        }

        public bool Paused
        {
            get { return paused; }
            set
            {
                paused = value;
                if (sprites == null) return;
                if (paused && sprites.ContainsKey("unavailiable")) ApplySprite(sprites["unavailiable"]);
                else if (sprites.ContainsKey(baseStyle)) ApplySprite(sprites[baseStyle]);
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                // 2026-11-08：去掉 WS_EX_TRANSPARENT —— 浔要能左键拖动、右键锁定，
                // 穿透的窗口收不到鼠标事件。代价是这 64×64 会挡住底下的点击。
                cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
                return cp;
            }
        }

        public void DisplayAt(int x, int y)
        {
            // 2026-11-08 19:52：淡出（FadeOut）会把 Opacity 收到 0 再 Hide，
            //   而 DisplayAt 原来只 Show、从不还原 Opacity —— 窗口「可见」却全透明。
            //   probe 实测：64x64 vis=True alpha=0，屏幕上什么都没有。显示前必须拉回 1。
            try { Opacity = 1.0; } catch { }
            // 2026-11-08 17:2x astra：上一次 glide 还没走完时又被定位，
            //   下一帧 GlideTick 会把窗口拽回旧目标 —— 必须在这里收掉。
            glideTimer.Stop();
            // Publish only the measured window position after placement.
            // 素材热点是 (0,0)：箭头尖就是点击点，所以光标窗口左上角对准 (x,y)
            lastX = x;
            lastY = y;
            SetBase(x, y, "place");
            phase = 0.0;
            bool wasVisible = Visible;
            if (!Visible) { Bounds = new Rectangle(x, y, displaySize, displaySize); Show(); }
            TopMost = false;
            TopMost = true;
            BringToFront();
            bool ok = DshBubble.MoveTogether(Handle, DshInput.HWND_TOPMOST, x, y, displaySize, displaySize,
                (uint)(DshInput.SWP_NOACTIVATE | DshInput.SWP_SHOWWINDOW));
            DshOverlay.LastSetWindowPosOk = ok;
            DshOverlay.LastSetWindowPosError = Marshal.GetLastWin32Error();
            if (ok) DshOverlay.PublishBounds(Handle);
            frame = 0;
            ApplyFrameRegion();
            animTimer.Start();
            if (driftOn) driftTimer.Start();
            hideTimer.Stop();
            if (mode == "clean")
            {
                hideTimer.Interval = holdMs;
                hideTimer.Start();
            }
            Invalidate();
            Update();
            DshOverlay.HoldPosition(2000);   // 2000ms 内 drift 不许改写基点
            // 刚冒出来就淡进来；本来就在的话先淡一档再回满——看着像「移过去」，不像「闪一下」
            BeginFade(wasVisible ? 0.82f : 0.05f);
        }

        public void HideNow()
        {
            hideTimer.Stop();
            animTimer.Stop();
            driftTimer.Stop();
            Hide();
        }

        public void SetSkin(string path)
        {
            // 2026-11-08：用户自己加的光标。任意尺寸，压到 64×64 再走原来的绘制路径。
            try
            {
                using (Image src = Image.FromFile(path))
                {
                    Bitmap bmp = new Bitmap(Cell, Cell);
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(src, new Rectangle(0, 0, Cell, Cell));
                    }
                    ApplySprite(bmp);
                    if (Visible) PlaceAt(baseX, baseY);
                }
            }
            catch { }
        }

        // 2026-11-09：baseX/baseY 的唯一写入口。
        // 原来三处各写各的（定位、glide 收尾、拖动），踩过的坑是：
        // glide 还没走完就开始拖，下一帧 GlideTick 会把窗口拽回旧目标 —— 手感就是「拖不动、被抢回去」。
        // 现在拖动视为人接管：进 SetBase 先把 glide 和 drift 收掉。
        void SetBase(int x, int y, string source)
        {
            baseX = x;
            baseY = y;
            baseSource = source;
            if (source == "drag")
            {
                try { glideTimer.Stop(); } catch { }
                try { driftTimer.Stop(); } catch { }
            }
        }

        public void GlideTo(int x, int y, int ms)
        {
            glideTimer.Stop();
            DshInput.RECT actual;
            if (!DshInput.GetWindowRect(Handle, out actual)) return;
            gx0 = actual.Left; gy0 = actual.Top;
            gx1 = x; gy1 = y;
            DshOverlay.HoldPosition(Math.Max(2000, ms + 1200));
            gms = Math.Max(120, ms);
            glideClock.Restart();
            driftTimer.Stop();
            glideTimer.Start();
        }

        void GlideTick()
        {
            double t = DshOverlayGeometry.Progress(glideClock.Elapsed.TotalMilliseconds, gms);
            // 2026-11-08：smoothstep 看着像线性，换成 ease-out —— 先快，快到目标时收住。
            double e = 1.0 - Math.Pow(1.0 - t, 3.0);
            int x = (int)Math.Round(gx0 + (gx1 - gx0) * e);
            int y = (int)Math.Round(gy0 + (gy1 - gy0) * e);
            PlaceAt(x, y);
            if (t >= 1.0)
            {
                glideTimer.Stop();
                SetBase(gx1, gy1, "glide");
                // PlaceAt publishes actual coordinates, never the intended destination.
                if (driftOn) driftTimer.Start();
            }
        }

        // ---- 2026-11-08 鼠标交互：轻点＝叫它一次（不记次数），按住＝拖动，右键锁定 ----
        // 2026-11-08 21:1x 浔：「点按桌宠直接进行一次不记次数的活动，长按拖动」。
        // 按下不再立刻进入拖动：先当「可能是点击」，等到按久了、或手真的移开了，才转成拖动。
        bool pressing = false;
        bool dragging = false;
        bool movedWhilePressing = false;
        Point dragOffset;
        Point pressPoint;
        int pressStartedAt = 0;
        const int DragHoldMs = 220;   // 按住超过这么久之后的移动才算拖动
        const int DragSlopPx = 6;     // 手抖不算移动
        const int TapMaxMs = 350;     // 松开时按住没超过这么久，才算轻点（再久就是按住不放，不叫点）

        public void SetLocked(bool on)
        {
            DshOverlay.locked = on;
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                if (DshOverlay.locked) return;
                pressing = true;
                dragging = false;
                movedWhilePressing = false;
                pressPoint = new Point(e.X, e.Y);
                dragOffset = pressPoint;
                pressStartedAt = Environment.TickCount;
                driftTimer.Stop();
                glideTimer.Stop();
                Capture = true;
            }
            else if (e.Button == MouseButtons.Right)
            {
                ContextMenuStrip menu = new ContextMenuStrip();
                menu.Items.Add(DshOverlay.locked ? "取消锁定" : "锁定", null, delegate
                {
                    DshOverlay.locked = !DshOverlay.locked;
                });
                // 2026-11-09 21:1x 浔：做成二级栏——晃一下鼠标管开/关，下面再管回答走气泡还是卡片。
                ToolStripMenuItem shakeMenu = new ToolStripMenuItem(DshShake.Enabled ? "晃动检测 ✓" : "晃动检测");
                ToolStripMenuItem shakeOn = new ToolStripMenuItem("开");
                shakeOn.Checked = DshShake.Enabled;
                shakeOn.Click += delegate { DshShake.SetEnabled(true); DshOverlay.EmitLine("{\"event\":\"menu\",\"action\":\"shake\",\"on\":true}"); };
                ToolStripMenuItem shakeOff = new ToolStripMenuItem("关");
                shakeOff.Checked = !DshShake.Enabled;
                shakeOff.Click += delegate { DshShake.SetEnabled(false); DshOverlay.EmitLine("{\"event\":\"menu\",\"action\":\"shake\",\"on\":false}"); };
                ToolStripMenuItem ansQuick = new ToolStripMenuItem("简易回答（气泡）");
                ansQuick.Checked = DshOverlay.AnswerMode != "full";
                ansQuick.Click += delegate { DshOverlay.SetAnswerMode("quick"); };
                ToolStripMenuItem ansFull = new ToolStripMenuItem("完整回答（卡片）");
                ansFull.Checked = DshOverlay.AnswerMode == "full";
                ansFull.Click += delegate { DshOverlay.SetAnswerMode("full"); };
                shakeMenu.DropDownItems.Add(shakeOn);
                shakeMenu.DropDownItems.Add(shakeOff);
                shakeMenu.DropDownItems.Add(new ToolStripSeparator());
                shakeMenu.DropDownItems.Add(ansQuick);
                shakeMenu.DropDownItems.Add(ansFull);
                menu.Items.Add(shakeMenu);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("关闭显示", null, delegate
                {
                    // 2026-11-08：用正常的说话气泡，跟在光标上方；先让它出来，过一秒多再收光标。
                    DshBubble.Say("要再打开我：「她的一生」→ 桌宠 → 显示", DshOverlay.LastX, DshOverlay.LastY, 1200);
                    System.Windows.Forms.Timer tt = new System.Windows.Forms.Timer();
                    tt.Interval = 1000;
                    tt.Tick += delegate { tt.Stop(); FadeOutAndHide(); };
                    tt.Start();
                });
                menu.Show(this, new Point(e.X, e.Y));
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (!pressing || DshOverlay.locked) return;
            int dx = e.X - pressPoint.X;
            int dy = e.Y - pressPoint.Y;
            if (!dragging)
            {
                int dist2 = dx * dx + dy * dy;
                if (dist2 < DragSlopPx * DragSlopPx) return;      // 手抖，不算动手
                int held = unchecked(Environment.TickCount - pressStartedAt);
                // 按得够久才拖；短促但甩出去很远（超过 12px）也当拖动，别把人家的地拖丢了。
                if (held < DragHoldMs && dist2 < 144) return;
                dragging = true;
                movedWhilePressing = true;
                Capture = true;
            }
            int nx = Left + e.X - dragOffset.X;
            int ny = Top + e.Y - dragOffset.Y;
            SetBase(nx, ny, "drag");
            if (DshBubble.MoveTogether(Handle, DshInput.HWND_TOPMOST, nx, ny, displaySize, displaySize,
                (uint)(DshInput.SWP_NOACTIVATE | DshInput.SWP_SHOWWINDOW)))
                DshOverlay.PublishBounds(Handle);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (!pressing) return;
            pressing = false;
            Capture = false;
            int held = unchecked(Environment.TickCount - pressStartedAt);
            if (dragging)
            {
                dragging = false;
                movedWhilePressing = true;
                DshOverlay.PublishBounds(Handle);
            }
            else if (!movedWhilePressing && held >= 0 && held <= TapMaxMs)
            {
                // 轻点一下：叫它一次。位置给 Node 侧当参考，气泡在那儿附近弹。
                DshOverlay.EmitTap(Left + e.X, Top + e.Y);
            }
            if (driftOn) driftTimer.Start();
        }

        public void FadeOutAndHide()
        {
            System.Windows.Forms.Timer ft = new System.Windows.Forms.Timer();
            ft.Interval = 18;
            double op = 1.0;
            ft.Tick += delegate
            {
                op -= 0.08;
                if (op <= 0.05)
                {
                    ft.Stop();
                    HideNow();
                    try { Opacity = 1.0; } catch { }
                }
                else
                {
                    try { Opacity = op; } catch { }
                }
            };
            ft.Start();
        }

        public void SetDrift(bool on)
        {
            driftOn = on;
            if (!on)
            {
                driftTimer.Stop();
                if (Visible) PlaceAt(baseX, baseY);
            }
            else if (Visible)
            {
                driftTimer.Start();
            }
        }

        void PlaceAt(int x, int y)
        {
            try
            {
                if (DshBubble.MoveTogether(Handle, DshInput.HWND_TOPMOST, x, y, displaySize, displaySize,
                    (uint)DshInput.SWP_NOACTIVATE)) DshOverlay.PublishBounds(Handle);
            }
            catch { }
        }

        void DriftTick()
        {
            if (!Visible || !driftOn) return;
            // 2026-11-08 17:2x astra：holdPos 之前只有写没有读，那层保护是不存在的。
            if (DshOverlay.holdPos) return;
            // 2026-11-08 16:5x：**整块删掉**。她 11-08 就说过「别跟随，自己晃就可以了」，
            //   可 followCursor 又被某个调用打开了，于是每帧把光标拽到她真实光标的右下，
            //   glide 到哪都被拉回去（实测：目标 489,65 → 读数 997,1355 = 她光标+44/+34）。
            //   跟随这个功能不要了：光标只在自己基点附近晃，让去哪就停在哪。

            phase += 0.13;
            int dx = (int)Math.Round(Math.Sin(phase) * 2.4);
            int dy = (int)Math.Round(Math.Sin(phase * 0.61 + 1.3) * 1.7);
            PlaceAt(baseX + dx, baseY + dy);
        }

        // 2026-11-08 16:1x 浔：「突然出现差点吓到我了」——出现时淡入，移动时先淡一下再回来。
        // 用绘制层的 alpha（ColorMatrix），不动窗口的透明属性：那会重建 region，挖好的边会变方。
        float paintAlpha = 1f;
        System.Windows.Forms.Timer fadeTimer;

        void BeginFade(float from)
        {
            paintAlpha = from;
            if (fadeTimer == null)
            {
                fadeTimer = new System.Windows.Forms.Timer();
                fadeTimer.Interval = 16;
                fadeTimer.Tick += delegate
                {
                    float d = 1f - paintAlpha;
                    if (d <= 0.02f) { paintAlpha = 1f; fadeTimer.Stop(); }
                    else paintAlpha += d * 0.30f;
                    Invalidate();
                };
            }
            fadeTimer.Stop();
            fadeTimer.Start();
        }

        static ImageAttributes AlphaAttrs(float a)
        {
            ImageAttributes ia = new ImageAttributes();
            ColorMatrix cm = new ColorMatrix();
            cm.Matrix33 = a;
            ia.SetColorMatrix(cm, ColorMatrixFlag.Default, ColorAdjustType.Bitmap);
            return ia;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(BackColor);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (sprite != null)
            {
                int col = frame % Cols;
                int row = frame / Cols;
                if (row * Cell + Cell <= sprite.Height)
                {
                    e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
                    e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
                    Rectangle dst = new Rectangle(0, 0, displaySize, displaySize);
                    Rectangle srcRect = new Rectangle(col * Cell, row * Cell, Cell, Cell);
                    if (paintAlpha >= 0.995f)
                    {
                        e.Graphics.DrawImage(sprite, dst, srcRect, GraphicsUnit.Pixel);
                    }
                    else
                    {
                        using (ImageAttributes ia = AlphaAttrs(paintAlpha))
                        {
                            e.Graphics.DrawImage(sprite, dst, srcRect.X, srcRect.Y, srcRect.Width, srcRect.Height,
                                GraphicsUnit.Pixel, ia);
                        }
                    }
                    return;
                }
            }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Color ring = Paused ? Color.Orange : Color.DeepSkyBlue;
            using (Pen pen = new Pen(ring, 3))
            {
                e.Graphics.DrawEllipse(pen, 8, 8, Width - 17, Height - 17);
            }
            using (SolidBrush dot = new SolidBrush(Color.White))
            {
                e.Graphics.FillEllipse(dot, Width / 2 - 3, Height / 2 - 3, 6, 6);
            }
        }
    }
}


    // ---------------------------------------------------------------- 晃一下鼠标
    // 2026-11-09 浔的想法：晃鼠标 → 溟的光标飞过来 → 气泡说一句。
    // 只读光标位置，不装钩子、不记轨迹；鼠标按着的时候不计（那是拖动/框选）。
    // 检测到就抛一行 {"event":"shake",x,y}，跟 tap 走同一条出口。
    public static class DshShake
    {
        [DllImport("user32.dll")] static extern bool GetCursorPos(out SH_POINT p);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
        [DllImport("user32.dll")] static extern bool GetCursorInfo(ref SH_CURSORINFO ci);

        public struct SH_POINT { public int X; public int Y; }
        public struct SH_CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public SH_POINT ptScreenPos; }

        const int CURSOR_SHOWING = 1;
        const int POLL_MS = 16;
        const int COOLDOWN_MS = 1500;
        const int MAX_VERTICAL = 120;

        static int windowMs = 450;
        static int needReversals = 3;
        static int amplitude = 40;
        static readonly object gate = new object();
        static readonly System.Collections.Generic.List<long[]> samples = new System.Collections.Generic.List<long[]>();
        static System.Threading.Timer timer;
        static long lastFire = 0;
        static volatile bool enabled = false;
        static volatile bool selfDriving = false;
        static int fires = 0;

        public static bool Enabled { get { return enabled; } }
        public static int Fired { get { return fires; } }
        static string levelName = "medium";
        public static string Level { get { return levelName; } }

        // 右键菜单用：保留当前灵敏度，只切开关。
        public static void SetEnabled(bool on) { Configure(on, levelName); }

        public static void Configure(bool on, string level)
        {
            lock (gate)
            {
                if (level == "low") { windowMs = 400; needReversals = 4; amplitude = 60; levelName = "low"; }
                else if (level == "high") { windowMs = 500; needReversals = 3; amplitude = 28; levelName = "high"; }
                else { windowMs = 450; needReversals = 3; amplitude = 40; levelName = "medium"; }
                enabled = on;
                samples.Clear();
            }
            if (on)
            {
                if (timer == null)
                    timer = new System.Threading.Timer(Tick, null, POLL_MS, POLL_MS);
            }
            else if (timer != null)
            {
                timer.Dispose();
                timer = null;
            }
        }

        // 我们自己动光标的时候（拖、点、滑）不计，不然会把自己触发。
        // 解除后再静 400ms 才恢复检测——AI 光标 glide 是异步的，命令返回时光标还在滑。
        static long selfUntil = 0;
        public static void SetSelfDriving(bool v)
        {
            if (v) { selfDriving = true; lock (gate) { samples.Clear(); } }
            else { selfDriving = false; selfUntil = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond + 400; lock (gate) { samples.Clear(); } }
        }

        // 2026-11-09：全屏游戏里晃鼠标不该触发——那儿弹不出框，只会白说一句。
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out SH_RECT r);
        public struct SH_RECT { public int Left; public int Top; public int Right; public int Bottom; }

        public static bool ForegroundFullscreen()
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            SH_RECT r;
            if (!GetWindowRect(fg, out r)) return false;
            System.Drawing.Rectangle scr = System.Windows.Forms.SystemInformation.VirtualScreen;
            // 盖满整个虚拟屏幕（含任务栏那条）才算全屏；最大化窗口会留出任务栏，不算。
            return r.Left <= scr.Left && r.Top <= scr.Top && r.Right >= scr.Left + scr.Width && r.Bottom >= scr.Top + scr.Height;
        }

        static bool ButtonDown()
        {
            return (GetAsyncKeyState(1) & 0x8000) != 0
                || (GetAsyncKeyState(2) & 0x8000) != 0
                || (GetAsyncKeyState(4) & 0x8000) != 0;
        }

        static void Tick(object st)
        {
            try
            {
                if (!enabled || selfDriving) return;
                // 框选进行中不许再判晃动：她拖框时来回找位置，会被当成第二次晃。
                if (DshSelect.Busy) { lock (gate) { samples.Clear(); } return; }
                long now0 = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
                if (now0 < selfUntil) return;
                SH_POINT p;
                if (!GetCursorPos(out p)) return;
                if (ButtonDown()) { lock (gate) { samples.Clear(); } return; }
                SH_CURSORINFO ci = new SH_CURSORINFO();
                ci.cbSize = System.Runtime.InteropServices.Marshal.SizeOf(typeof(SH_CURSORINFO));
                if (!GetCursorInfo(ref ci)) return;
                if ((ci.flags & CURSOR_SHOWING) == 0) { lock (gate) { samples.Clear(); } return; }

                long now = DateTime.UtcNow.Ticks / TimeSpan.TicksPerMillisecond;
                bool hit = false;
                lock (gate)
                {
                    samples.Add(new long[] { now, p.X, p.Y });
                    int cut = 0;
                    while (cut < samples.Count && now - samples[cut][0] > windowMs) cut++;
                    if (cut > 0) samples.RemoveRange(0, cut);
                    if (samples.Count >= 6 && now - lastFire >= COOLDOWN_MS)
                    {
                        int reversals = 0;
                        int dir = 0;
                        long extreme = samples[0][1];
                        long minY = samples[0][2];
                        long maxY = samples[0][2];
                        for (int i = 1; i < samples.Count; i++)
                        {
                            long x = samples[i][1];
                            long y = samples[i][2];
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                            if (dir == 0)
                            {
                                if (Math.Abs(x - extreme) >= amplitude) { dir = Math.Sign(x - extreme); extreme = x; }
                                continue;
                            }
                            if ((x - extreme) * dir > 0) { extreme = x; continue; }
                            if (Math.Abs(extreme - x) >= amplitude) { reversals++; dir = -dir; extreme = x; }
                        }
                        if (reversals >= needReversals && maxY - minY <= MAX_VERTICAL && !ForegroundFullscreen())
                        {
                            lastFire = now;
                            samples.Clear();
                            fires++;
                            hit = true;
                        }
                    }
                }
                if (hit) DshOverlay.EmitLine("{\"event\":\"shake\",\"x\":" + p.X + ",\"y\":" + p.Y + "}");
            }
            catch { }
        }
    }


    // ---------------------------------------------------------------- 框选一块
    // 2026-11-09：晃完鼠标，她拖一下框住要看的那块，我就只看那块。
    // 全屏置顶、洋红抠成透明，只画一个白框。Esc / 右键退出，超时自己关。
    public static class DshSelect
    {
        // 异步：另起一个 STA 线程弹窗口，主循环不被卡住（框选期间还要能 say）。
        // 结果用事件抛回去：select-done / select-none。
        // 2026-11-09 浔：晃两次会叠两个框，上面那个关了下面那个还在等，看着像「框了没反应」。
        // 同一时间只许一个。
        static volatile bool active = false;
        public static bool Busy { get { return active; } }

        public static void Start(int timeoutMs)
        {
            if (active) return;
            active = true;
            var th = new System.Threading.Thread(delegate()
            {
                try
                {
                    using (var f = new SelectForm())
                    {
                        f.TimeoutMs = timeoutMs > 0 ? timeoutMs : 20000;
                        f.ShowDialog();
                        if (f.Result != null)
                        {
                            DshOverlay.EmitLine("{\"event\":\"select-done\",\"rect\":\"" + f.Result + "\"}");
                            DshCard.Resume();
                        }
                        else
                        {
                            DshOverlay.EmitLine("{\"event\":\"select-none\",\"why\":\"d" + f.Downs + ",m" + f.Moves + ",u" + f.Ups + "\"}");
                            DshCard.Resume();
                        }
                    }
                }
                catch (Exception ex)
                {
                    DshOverlay.EmitLine("{\"event\":\"select-none\",\"why\":\"" + ex.Message.Replace("\"", "'") + "\"}");
                    DshCard.Resume();
                }
                finally
                {
                    active = false;
                }
            });
            th.SetApartmentState(System.Threading.ApartmentState.STA);
            th.IsBackground = true;
            th.Start();
        }

        public class SelectForm : Form
        {
            // 鼠标事件的 e.Location 会被 DPI 虚拟化放大（实测 1.49 倍），跟截图用的物理像素对不上。
            // 所以坐标一律直接读 GetCursorPos，事件只用来判断"按没按"。
            [DllImport("user32.dll")] static extern bool GetCursorPos(out DshInput.POINT p);
            static Point CursorPt()
            {
                DshInput.POINT p;
                if (!GetCursorPos(out p)) return Point.Empty;
                return new Point(p.X, p.Y);
            }

            public string Result = null;
            public int Downs = 0;
            public int Moves = 0;
            public int Ups = 0;
            public int TimeoutMs = 20000;
            Point start = Point.Empty;
            Point end = Point.Empty;
            bool dragging = false;
            Rectangle screen;
            System.Windows.Forms.Timer kill;

            [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);

            // 穿透：WS_EX_TRANSPARENT 让鼠标事件漏到底下的窗口（DSH、模拟器）
            // WS_EX_NOACTIVATE 不抢焦点；这样她拖的时候，下面那个程序照常收。
            // 2026-11-09 浔：「框选过程中会选择文本/拖动」——穿透会让拖动漏到底下的程序。
            // 改成不穿透：窗口自己吃下拖动，下面收不到。但必须强制置顶+激活，
            // 否则 DSH 这种置顶窗口会压在上面（第一版就是这么失败的）。
            protected override CreateParams CreateParams
            {
                get
                {
                    CreateParams cp = base.CreateParams;
                    cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
                    cp.ExStyle |= 0x00000008; // WS_EX_TOPMOST
                    return cp;
                }
            }

            [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
            [DllImport("user32.dll")] static extern IntPtr SetForegroundWindow(IntPtr h);

            System.Windows.Forms.Timer poll;

            public SelectForm()
            {
                screen = SystemInformation.VirtualScreen;
                FormBorderStyle = FormBorderStyle.None;
                StartPosition = FormStartPosition.Manual;
                Bounds = screen;
                TopMost = true;
                ShowInTaskbar = false;
                // 不能用 TransparencyKey：那会让整块变成点击穿透，鼠标事件全跑到底下的窗口。
                // 改成整体压暗（像截图工具那样），才收得到拖动。
                BackColor = Color.FromArgb(16, 18, 24);
                Opacity = 0.35;
                Cursor = Cursors.Cross;
                DoubleBuffered = true;
                KeyPreview = true;
                kill = new System.Windows.Forms.Timer();
                kill.Interval = Math.Max(1000, TimeoutMs);
                kill.Tick += delegate { kill.Stop(); Close(); };
                kill.Start();
                // 窗口收不到鼠标事件（穿透），所以自己看按键和光标。
                poll = new System.Windows.Forms.Timer();
                poll.Interval = 16;
                poll.Tick += delegate { Poll(); };
                poll.Start();
            }

            bool wasDown = false;
            void Poll()
            {
                bool down = (GetAsyncKeyState(1) & 0x8000) != 0;
                Point p = CursorPt();
                if (down && !wasDown)
                {
                    Downs++;
                    start = p;
                    end = p;
                    dragging = true;
                    Invalidate();
                }
                else if (down && dragging)
                {
                    if (p != end) { Moves++; end = p; Invalidate(); }
                }
                else if (!down && dragging)
                {
                    Ups++;
                    dragging = false;
                    end = p;
                    Finish();
                }
                wasDown = down;
            }

            void Finish()
            {
                Rectangle r = Current();
                // 2026-11-09 浔：「框歪了就歪了，不用重新拖」——松开就是最终结果。
                if (r.Width >= 12 && r.Height >= 12)
                    Result = r.X + "," + r.Y + "," + r.Width + "," + r.Height;
                if (poll != null) poll.Stop();
                kill.Stop();
                Close();
            }

            protected override bool ProcessCmdKey(ref Message msg, Keys key)
            {
                if (key == Keys.Escape) { kill.Stop(); Close(); return true; }
                return base.ProcessCmdKey(ref msg, key);
            }

            Rectangle Current()
            {
                if (start.IsEmpty || end.IsEmpty) return Rectangle.Empty;
                int x = Math.Min(start.X, end.X);
                int y = Math.Min(start.Y, end.Y);
                return new Rectangle(x, y, Math.Abs(start.X - end.X), Math.Abs(start.Y - end.Y));
            }

            protected override void OnShown(EventArgs e)
            {
                base.OnShown(e);
                // 抢到最上面：HWND_TOPMOST(-1) + 显示，再要前台。抢不到也不至于崩。
                try
                {
                    SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0040 | 0x0001); // SWP_SHOWWINDOW | SWP_NOSIZE
                    Activate();
                    SetForegroundWindow(Handle);
                }
                catch { }
                DshOverlay.EmitLine("{\"event\":\"select-ready\",\"x\":" + Bounds.X + ",\"y\":" + Bounds.Y + ",\"w\":" + Bounds.Width + ",\"h\":" + Bounds.Height + ",\"top\":" + (TopMost ? 1 : 0) + ",\"fg\":" + (GetForegroundWindow() == Handle ? 1 : 0) + "}");
            }
            [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();

            protected override void OnPaint(PaintEventArgs e)
            {
                base.OnPaint(e);
                e.Graphics.SmoothingMode = SmoothingMode.None;
                using (Font f = new Font("Microsoft YaHei UI", 11f))
                using (SolidBrush b = new SolidBrush(Color.White))
                {
                    e.Graphics.DrawString("拖一个框；Esc 或右键取消", f, b, new PointF(40, 40));
                }
                Rectangle rs = Current();
                if (rs.IsEmpty) return;
                Rectangle r = new Rectangle(rs.X - Bounds.X, rs.Y - Bounds.Y, rs.Width, rs.Height);
                using (SolidBrush hole = new SolidBrush(Color.FromArgb(90, 255, 255, 255)))
                    e.Graphics.FillRectangle(hole, r);
                using (Pen p = new Pen(Color.White, 2))
                {
                    p.DashStyle = DashStyle.Dash;
                    e.Graphics.DrawRectangle(p, r);
                }
                using (Font f = new Font("Microsoft YaHei UI", 9f))
                using (SolidBrush b = new SolidBrush(Color.White))
                    e.Graphics.DrawString(r.Width + " x " + r.Height, f, b, new PointF(r.X + 4, Math.Max(4, r.Y - 20)));
            }

            protected override void OnMouseDown(MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Right) { Close(); return; }
                Downs++;
                if (e.Button != MouseButtons.Left) return;
                start = CursorPt();
                end = start;
                dragging = true;
                Invalidate();
                base.OnMouseDown(e);
            }

            protected override void OnMouseMove(MouseEventArgs e)
            {
                if (dragging)
                {
                    Moves++;
                    end = CursorPt();
                    Invalidate();
                }
                base.OnMouseMove(e);
            }

            protected override void OnMouseUp(MouseEventArgs e)
            {
                Ups++;
                if (e.Button != MouseButtons.Left || !dragging) { base.OnMouseUp(e); return; }
                dragging = false;
                end = CursorPt();
                Rectangle r = Current();
                if (r.Width >= 12 && r.Height >= 12)
                {
                    Result = r.X + "," + r.Y + "," + r.Width + "," + r.Height;
                    kill.Stop();
                    Close();
                    return;
                }
                start = Point.Empty;
                end = Point.Empty;
                Invalidate();
                base.OnMouseUp(e);
            }

        }
    }


    // ---------------------------------------------------------------- 网页取文接收端
    // 2026-11-09：浏览器扩展在网页里选中一段，POST 到这里。
    // 只绑 127.0.0.1，只收 POST /webpick，收到就落一个文件并抛一行事件。
    public static class DshWebPick
    {
        static System.Net.Sockets.TcpListener listener;
        static System.Threading.Thread thread;
        static volatile bool running = false;
        public static int Count = 0;
        public static string LastFile = "";
        public static volatile string LastError = "";
        public static int Port = 47322;

        public static void Start(int port)
        {
            if (running) return;
            running = true;
            Port = port > 0 ? port : 47322;
            thread = new System.Threading.Thread(delegate()
            {
                try
                {
                    listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, Port);
                    listener.Start();
                    LastError = "";
                    while (running)
                    {
                        var client = listener.AcceptTcpClient();
                        try { Handle(client); } catch (Exception ex)
                        {
                            LastError = "handle:" + ex.Message;
                            try { DshOverlay.EmitLine("{\"event\":\"wp-error\",\"msg\":\"" + ex.Message.Replace("\"", "'") + "\"}"); } catch { }
                        }
                        try { client.Close(); } catch { }
                    }
                }
                catch (Exception ex) { LastError = ex.Message; running = false; }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        public static void Stop()
        {
            running = false;
            try { if (listener != null) listener.Stop(); } catch { }
        }

        static void Reply(System.Net.Sockets.NetworkStream s, string status, string body)
        {
            byte[] data = System.Text.Encoding.UTF8.GetBytes(body ?? "");
            string head = "HTTP/1.1 " + status + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Headers: content-type\r\n"
                + "Access-Control-Allow-Methods: POST, OPTIONS\r\n"
                + "Content-Length: " + data.Length + "\r\n"
                + "Connection: close\r\n\r\n";
            byte[] h = System.Text.Encoding.ASCII.GetBytes(head);
            s.Write(h, 0, h.Length);
            if (data.Length > 0) s.Write(data, 0, data.Length);
            s.Flush();
        }

        static void Handle(System.Net.Sockets.TcpClient client)
        {
            var s = client.GetStream();
            s.ReadTimeout = 3000;
            var ms = new System.IO.MemoryStream();
            byte[] buf = new byte[8192];
            int headerEnd = -1;
            int contentLen = 0;
            // 2026-11-09：Content-Length 是字节数，不是字符数。中文一个三字节，
            // 按字符数读会永远读不够、卡到超时——这就是前面几次「连接被重置」的原因。
            while (true)
            {
                if (headerEnd < 0 && ms.Length > 0)
                {
                    byte[] all0 = ms.ToArray();
                    for (int i = 0; i + 3 < all0.Length; i++)
                    {
                        if (all0[i] == 13 && all0[i + 1] == 10 && all0[i + 2] == 13 && all0[i + 3] == 10)
                        {
                            headerEnd = i;
                            string head = System.Text.Encoding.UTF8.GetString(all0, 0, i);
                            foreach (string line in head.Split('\n'))
                            {
                                string l = line.Trim();
                                if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                                    int.TryParse(l.Substring(15).Trim(), out contentLen);
                            }
                            break;
                        }
                    }
                }
                if (headerEnd >= 0 && ms.Length >= headerEnd + 4 + contentLen) break;
                if (ms.Length > 400000) break;
                int n = s.Read(buf, 0, buf.Length);
                if (n <= 0) break;
                ms.Write(buf, 0, n);
            }
            byte[] all = ms.ToArray();
            if (headerEnd < 0) { Reply(s, "400 Bad Request", "{\"ok\":false}"); return; }
            string headText = System.Text.Encoding.UTF8.GetString(all, 0, headerEnd);
            string first = headText.Split('\n')[0].Trim();
            int bodyStart = headerEnd + 4;
            int bodyLen = Math.Min(contentLen, Math.Max(0, all.Length - bodyStart));
            string body = System.Text.Encoding.UTF8.GetString(all, bodyStart, bodyLen);

            if (first.StartsWith("OPTIONS")) { Reply(s, "204 No Content", ""); return; }
            if (!first.StartsWith("POST"))
            {
                Reply(s, "405 Method Not Allowed", "{\"ok\":false,\"why\":\"POST only\"}");
                return;
            }

            string dir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "ming-mousepet");
            System.IO.Directory.CreateDirectory(dir);
            string file = System.IO.Path.Combine(dir, "webpick.json");
            System.IO.File.WriteAllText(file, body, new System.Text.UTF8Encoding(false));
            Count++;
            LastFile = file;
            Reply(s, "200 OK", "{\"ok\":true,\"len\":" + bodyLen + "}");
            try { DshOverlay.EmitLine("{\"event\":\"webpick\",\"file\":\"" + file.Replace("\\", "\\\\") + "\"}"); } catch { }
        }
    }

'@

$bubbleCs = @'

public static class DshCard
{
    // 2026-11-09：能追问的小卡片。Pointy 那张卡绑在 DSH 会话上，因为它没有别的脑子；
    // 我们有 llm.stream，所以卡片自己会说话，追问直接续，不走会话桥。
    // 没有模型服务时它退化成一块只读的字，不报错。
    sealed class CardForm : Form
    {
        readonly Label head;
        readonly Label hint;
        readonly RichTextBox body;
        readonly TextBox input;
        readonly Panel bar;
        readonly Button xBtn;
        readonly Button cBtn;
        int expandedH = 360;
        bool collapsed = false;
        bool busy = false;
        bool drag = false;
        Point dragAt;
        bool follow = true;
        readonly System.Windows.Forms.Timer followTimer;

        protected override CreateParams CreateParams
        {
            get
            {
                System.Windows.Forms.CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW：不进 ALT+TAB
                return cp;
            }
        }

        public CardForm(string title, int x, int y)
        {
            Text = "溟";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(28, 34, 46);
            Padding = new Padding(1);
            Size = new Size(440, expandedH);
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);

            head = new Label();
            head.Dock = DockStyle.Top;
            head.Height = 30;
            head.Text = "  " + (string.IsNullOrEmpty(title) ? "溟" : title);
            head.ForeColor = Color.FromArgb(143, 182, 217);
            head.BackColor = Color.FromArgb(28, 34, 46);
            head.Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
            head.TextAlign = ContentAlignment.MiddleLeft;
            head.MouseDown += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) { drag = true; dragAt = e.Location; follow = false; } };
            head.MouseMove += delegate(object s, MouseEventArgs e)
            {
                if (!drag) return;
                Point p = PointToScreen(e.Location);
                Location = new Point(p.X - dragAt.X, p.Y - dragAt.Y);
            };
            head.MouseUp += delegate { drag = false; };

            xBtn = Glyph("×");
            xBtn.Dock = DockStyle.Right;
            xBtn.Click += delegate { Close(); };
            cBtn = Glyph("–");
            cBtn.Dock = DockStyle.Right;
            cBtn.Click += delegate { SetCollapsed(!collapsed); };
            head.Controls.Add(cBtn);
            head.Controls.Add(xBtn);

            body = new RichTextBox();
            body.Dock = DockStyle.Fill;
            body.BorderStyle = BorderStyle.None;
            body.BackColor = Color.FromArgb(28, 34, 46);
            body.ForeColor = Color.FromArgb(230, 238, 248);
            body.Font = new Font("Microsoft YaHei UI", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
            body.ReadOnly = true;
            body.ScrollBars = RichTextBoxScrollBars.Vertical;
            body.DetectUrls = false;
            body.TabStop = false;
            body.ShortcutsEnabled = true;

            input = new TextBox();
            input.Dock = DockStyle.Top;
            input.BorderStyle = BorderStyle.None;
            input.BackColor = Color.FromArgb(38, 46, 60);
            input.ForeColor = Color.FromArgb(234, 244, 255);
            input.Font = new Font("Microsoft YaHei UI", 10.5f, FontStyle.Regular, GraphicsUnit.Point);
            input.KeyDown += OnInputKey;

            hint = new Label();
            hint.Dock = DockStyle.Bottom;
            hint.Height = 16;
            hint.Text = "Enter 发送 · Esc 关";
            hint.ForeColor = Color.FromArgb(112, 130, 152);
            hint.BackColor = Color.FromArgb(38, 46, 60);
            hint.Font = new Font("Microsoft YaHei UI", 8f, FontStyle.Regular, GraphicsUnit.Point);
            hint.TextAlign = ContentAlignment.MiddleLeft;

            bar = new Panel();
            bar.Dock = DockStyle.Bottom;
            bar.Height = 54;
            bar.BackColor = Color.FromArgb(38, 46, 60);
            bar.Padding = new Padding(10, 6, 10, 4);
            bar.Controls.Add(hint);
            bar.Controls.Add(input);

            Controls.Add(body);
            Controls.Add(bar);
            Controls.Add(head);

            Rectangle wa = Screen.FromPoint(new Point(x, y)).WorkingArea;
            int px = x + 40;
            int py = y - expandedH / 2;
            if (px + Width > wa.Right) px = x - Width - 20;
            if (px < wa.Left) px = wa.Left + 8;
            if (py < wa.Top) py = wa.Top + 8;
            if (py + Height > wa.Bottom) py = wa.Bottom - Height - 8;
            Location = new Point(px, py);

            // 2026-11-09 17:2x：跟着桌宠走，锚点和气泡是同一个（DshOverlay 的框）。
            // 她自己拖一下标题栏，follow 就关掉——手动放的位置比自动的更算数。
            followTimer = new System.Windows.Forms.Timer();
            followTimer.Interval = 250;
            followTimer.Tick += delegate { if (!follow || collapsed || !Visible) return; FollowTick(); };

            Show();
            followTimer.Start();
            FollowTick();
            try { Region = Round(new Rectangle(0, 0, Width, Height), 14); } catch { }
            Activate();
            try { input.Focus(); } catch { }
        }

        static Button Glyph(string glyph)
        {
            Button b = new Button();
            b.Text = glyph;
            b.Width = 30;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = Color.FromArgb(46, 56, 72);
            b.BackColor = Color.FromArgb(28, 34, 46);
            b.ForeColor = Color.FromArgb(150, 168, 190);
            b.Font = new Font("Segoe UI", 10f, FontStyle.Regular, GraphicsUnit.Point);
            b.TabStop = false;
            b.Cursor = Cursors.Hand;
            return b;
        }

        static Region Round(Rectangle r, int radius)
        {
            System.Drawing.Drawing2D.GraphicsPath path = new System.Drawing.Drawing2D.GraphicsPath();
            int d = radius * 2;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return new Region(path);
        }

        public bool Follow { get { return follow; } set { follow = value; if (value) FollowTick(); } }

        public void FollowTick()
        {
            Rectangle anchor;
            if (!DshOverlay.TryGetBounds(out anchor)) return;
            Rectangle wa = Screen.FromPoint(new Point(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2)).WorkingArea;
            Point want = CardLocation(anchor, Size, wa);
            if (Location != want) Location = want;
        }

        static Point CardLocation(Rectangle anchor, Size size, Rectangle wa)
        {
            // 先在桌宠右上方；右边放不下就翻到左边，上面放不下就落到底下。
            int x = anchor.Right + 10;
            if (x + size.Width > wa.Right) x = anchor.Left - 10 - size.Width;
            int y = anchor.Top - size.Height - 10;
            if (y < wa.Top) y = anchor.Bottom + 10;
            if (x < wa.Left + 8) x = wa.Left + 8;
            if (x + size.Width > wa.Right - 8) x = wa.Right - size.Width - 8;
            if (y < wa.Top + 8) y = wa.Top + 8;
            if (y + size.Height > wa.Bottom - 8) y = wa.Bottom - size.Height - 8;
            return new Point(x, y);
        }

        public void SetCollapsed(bool on)
        {
            if (on == collapsed) return;
            collapsed = on;
            if (on) { expandedH = Height; body.Visible = false; bar.Visible = false; Height = 32; }
            else { Height = expandedH; body.Visible = true; bar.Visible = true; }
            try { Region = Round(new Rectangle(0, 0, Width, Height), 14); } catch { }
        }

        public bool Collapsed { get { return collapsed; } }

        void OnInputKey(object s, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; Close(); return; }
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            string q = input.Text == null ? "" : input.Text.Trim();
            if (q.Length == 0) return;
            input.Text = "";
            AppendMine(q);
            SetBusy(true);
            DshOverlay.EmitLine("{\"event\":\"ask\",\"text\":\"" + Esc(q) + "\"}");
        }

        public void SetBusy(bool on)
        {
            busy = on;
            hint.Text = on ? "在想…" : "Enter 发送 · Esc 关";
        }

        public bool Busy { get { return busy; } }

        void AppendMine(string q)
        {
            if (body.TextLength > 0) body.AppendText(Environment.NewLine + Environment.NewLine);
            int start = body.TextLength;
            body.AppendText("你：" + q);
            body.Select(start, body.TextLength - start);
            body.SelectionColor = Color.FromArgb(143, 182, 217);
            body.SelectionLength = 0;
            body.SelectionStart = body.TextLength;
            body.ScrollToCaret();
        }

        public void Append(string t)
        {
            if (string.IsNullOrEmpty(t)) return;
            if (body.TextLength > 24000) { body.Clear(); body.AppendText("（太长，前面的滚掉了）" + Environment.NewLine); }
            body.SelectionStart = body.TextLength;
            body.SelectionLength = 0;
            body.SelectionColor = Color.FromArgb(230, 238, 248);
            body.AppendText(t);
            body.SelectionStart = body.TextLength;
            body.ScrollToCaret();
        }

        public int Lines { get { return body.Lines == null ? 0 : body.Lines.Length; } }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            try { followTimer.Stop(); followTimer.Dispose(); } catch { }
            DshOverlay.EmitLine("{\"event\":\"card-closed\"}");
            base.OnFormClosed(e);
        }

        public static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "'").Replace("\r", " ").Replace("\n", " ");
        }
    }

    static CardForm card = null;

    static int lastX = 0;
    static int lastY = 0;

    public static bool IsOpen { get { return card != null && !card.IsDisposed && card.Visible; } }
    public static bool IsCollapsed { get { try { return IsOpen && card.Collapsed; } catch { return false; } } }
    public static bool IsBusy { get { try { return IsOpen && card.Busy; } catch { return false; } } }
    static bool suspended = false;

    // 框选/指认期间把卡片收成小条：她要的那块屏幕先空出来。
    public static void Suspend()
    {
        DshOverlay.Do(delegate() { try { if (IsOpen && !card.Collapsed) { card.SetCollapsed(true); suspended = true; } } catch { } }, 2000);
    }

    public static void Resume()
    {
        DshOverlay.Do(delegate() { try { if (suspended) { suspended = false; if (IsOpen) card.SetCollapsed(false); } } catch { } }, 2000);
    }

    public static bool Follow
    {
        get { try { return IsOpen && card.Follow; } catch { return false; } }
        set { try { if (IsOpen) card.Follow = value; } catch { } }
    }
    public static int Lines { get { try { return IsOpen ? card.Lines : 0; } catch { return 0; } } }
    public static string BoundsText
    {
        get
        {
            try
            {
                if (!IsOpen) return "";
                Rectangle r = card.Bounds;
                return r.X + "," + r.Y + "," + r.Width + "," + r.Height;
            }
            catch { return ""; }
        }
    }

    public static bool Open(string title, int x, int y)
    {
        lastX = x; lastY = y;
        bool done = DshOverlay.Do(delegate()
        {
            try
            {
                if (card != null && !card.IsDisposed && card.Visible)
                {
                    // 框选/指认期间保持收着：等她选完再展开。
                    if (!suspended) card.SetCollapsed(false);
                    card.Activate();
                    return;
                }
                card = new CardForm(title, x, y);
            }
            catch (Exception e) { DshBubble.Trace("card open: " + e.ToString()); }
        }, 3000);
        return done && IsOpen;
    }

    public static bool Append(string text)
    {
        if (!IsOpen) return false;
        return DshOverlay.Do(delegate() { try { card.Append(text); } catch { } }, 2000);
    }

    public static bool SetState(string text)
    {
        if (!IsOpen) return false;
        return DshOverlay.Do(delegate() { try { card.SetBusy(false); } catch { } }, 2000);
    }

    public static bool SetBusy(bool on)
    {
        if (!IsOpen) return false;
        return DshOverlay.Do(delegate() { try { card.SetBusy(on); } catch { } }, 2000);
    }

    public static bool Collapse(bool on)
    {
        if (!IsOpen) return false;
        return DshOverlay.Do(delegate() { try { card.SetCollapsed(on); } catch { } }, 2000);
    }

    public static bool Close()
    {
        if (card == null) return true;
        DshOverlay.Do(delegate() { try { if (card != null && !card.IsDisposed) card.Close(); } catch { } }, 2000);
        card = null;
        return true;
    }
}

public static class DshPick
{
    // 2026-11-09：指一下，不拖框。
    // 判据（照 Pointy 的 shake→pick 思路，但换成「悬停 + 回车」）：
    //   · 光标停在哪，就框哪一块：UIA 从光标下那个元素往上走，挑第一个
    //     「够大（≥40×16）但不是整块屏」的祖先；
    //   · UIA 问不出来（自绘窗口、Chromium 壳）就给一个 720×320 的聚焦框，[ ] 收放；
    //   · 回车＝框这块，Esc＝算了；遮罩点穿透，不吃她在别的窗口里的点击；
    //   · 全屏时不启动——那多半在看片、打游戏，别突然罩一层上去。
    public sealed class PickInfo
    {
        public int X;
        public int Y;
        public int W;
        public int H;
        public string Name = "";
        public string Type = "";
        public int Level = 0;
        public int Levels = 0;
        public bool Fallback = false;
    }

    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out PKPOINT p);
    [StructLayout(LayoutKind.Sequential)] struct PKPOINT { public int X; public int Y; }
    static readonly IntPtr HWND_TOPMOST_PK = new IntPtr(-1);
    const uint SWP_NOACTIVATE_PK = 0x0010;
    const uint SWP_SHOWWINDOW_PK = 0x0040;

    const int VK_ESC = 0x1B;
    const int VK_ENTER = 0x0D;
    const int VK_LBRACKET = 0xDB;
    const int VK_RBRACKET = 0xDD;

    static PickForm form = null;
    public static PickInfo Last = null;

    public static bool Busy { get { PickForm f = form; return f != null && !f.IsDisposed && f.Visible; } }

    public static string Esc_(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "'").Replace("\r", " ").Replace("\n", " ");
    }

    // 纯计算：给屏幕坐标和收放档位，返回「该框哪块」。不画界面，测试可以直接调。
    public static PickInfo BlockAt(int x, int y, int level)
    {
        Rectangle screen = SystemInformation.VirtualScreen;
        List<Rectangle> cands = new List<Rectangle>();
        List<string> names = new List<string>();
        List<string> types = new List<string>();
        try
        {
            System.Windows.Automation.AutomationElement el =
                System.Windows.Automation.AutomationElement.FromPoint(new System.Windows.Point(x, y));
            System.Windows.Automation.TreeWalker walker = System.Windows.Automation.TreeWalker.ControlViewWalker;
            int guard = 0;
            while (el != null && guard < 8)
            {
                guard += 1;
                System.Windows.Rect r = System.Windows.Rect.Empty;
                try { r = el.Current.BoundingRectangle; } catch { r = System.Windows.Rect.Empty; }
                if (!r.IsEmpty && r.Width >= 24 && r.Height >= 12 && !double.IsInfinity(r.Width))
                {
                    Rectangle rr = new Rectangle((int)r.X, (int)r.Y, (int)r.Width, (int)r.Height);
                    if (rr.Width <= screen.Width + 4 && rr.Height <= screen.Height + 4)
                    {
                        string nm = "";
                        string tp = "";
                        try { nm = el.Current.Name == null ? "" : el.Current.Name; } catch { }
                        try { tp = el.Current.ControlType.ProgrammaticName == null ? "" : el.Current.ControlType.ProgrammaticName; } catch { }
                        cands.Add(rr);
                        names.Add(nm);
                        types.Add(tp);
                    }
                }
                try { el = walker.GetParent(el); } catch { el = null; }
            }
        }
        catch { }

        if (cands.Count > 0)
        {
            // 「有意义的块」= 够大、但不是整个窗口/整个屏。
            // Electron 这类自绘应用常常只报一个整窗节点，那时候框整窗没意义，
            // 宁可退到聚焦框，让她用 [ ] 自己收。
            // 判据跟着「窗口」走，不跟屏幕走：一个块要有意义，
            // 至少得比它所在的那个整窗小一圈（自绘窗口常常只报一个整窗节点）。
            double screenArea = (double)screen.Width * (double)screen.Height;
            Rectangle frame = cands[cands.Count - 1];
            double frameArea = (double)frame.Width * (double)frame.Height;
            int baseIdx = -1;
            for (int i = 0; i < cands.Count; i++)
            {
                Rectangle c = cands[i];
                double area = (double)c.Width * (double)c.Height;
                bool wholeScreen = c.Width >= screen.Width - 8 || c.Height >= screen.Height - 8;
                bool coversFrame = frameArea > 0 && area > frameArea * 0.85;
                bool tooBig = area > screenArea * 0.85;
                if (!wholeScreen && !coversFrame && !tooBig && c.Width >= 40 && c.Height >= 16)
                {
                    baseIdx = i;
                    break;
                }
            }
            if (baseIdx >= 0)
            {
                int idx = baseIdx + level;
                if (idx < 0) idx = 0;
                if (idx > cands.Count - 1) idx = cands.Count - 1;
                Rectangle pick = cands[idx];
                PickInfo info = new PickInfo();
                info.X = pick.X;
                info.Y = pick.Y;
                info.W = pick.Width;
                info.H = pick.Height;
                info.Name = names[idx];
                info.Type = types[idx];
                info.Level = idx;
                info.Levels = cands.Count;
                info.Fallback = false;
                return info;
            }
        }

        // 问不出来：给一个能收放的聚焦框（720×320 起，每档 ×1.15）
        double fw = 720;
        double fh = 320;
        for (int i = 0; i < level; i++) { fw = fw * 1.15; fh = fh * 1.15; }
        for (int i = 0; i > level; i--) { fw = fw / 1.15; fh = fh / 1.15; }
        if (fw > screen.Width) fw = screen.Width;
        if (fh > screen.Height) fh = screen.Height;
        PickInfo fb = new PickInfo();
        fb.W = (int)fw;
        fb.H = (int)fh;
        fb.X = x - fb.W / 2;
        fb.Y = y - fb.H / 2;
        if (fb.X < screen.Left) fb.X = screen.Left;
        if (fb.Y < screen.Top) fb.Y = screen.Top;
        fb.Fallback = true;
        fb.Level = level;
        return fb;
    }

    public static bool Start(int timeoutMs)
    {
        if (Busy) return false;
        try { if (DshShake.ForegroundFullscreen()) return false; } catch { }
        bool ok = DshOverlay.Do(delegate()
        {
            try { form = new PickForm(timeoutMs); }
            catch (Exception e) { DshBubble.Trace("pick start: " + e.ToString()); }
        }, 4000);
        return ok && Busy;
    }

    public static void Stop()
    {
        try
        {
            if (form != null && !form.IsDisposed)
                DshOverlay.Do(delegate() { try { form.Close(); } catch { } }, 2000);
        }
        catch { }
    }

    public static string Describe()
    {
        PickInfo i = Last;
        if (i == null) return "";
        return i.X + "," + i.Y + "," + i.W + "," + i.H;
    }

    sealed class PickForm : Form
    {
        readonly System.Windows.Forms.Timer tick;
        readonly int timeoutMs;
        readonly long started;
        int level = 0;
        int lastX = int.MinValue;
        int lastY = int.MinValue;
        bool kEsc, kEnter, kL, kR;
        PickInfo info = null;
        bool done = false;

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                System.Windows.Forms.CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE：不抢焦点
                cp.ExStyle |= 0x00000020; // WS_EX_TRANSPARENT：点击穿过去
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW：不进 ALT+TAB
                return cp;
            }
        }

        public PickForm(int ms)
        {
            timeoutMs = ms > 2000 ? ms : 30000;
            started = Environment.TickCount;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Bounds = SystemInformation.VirtualScreen;
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta;
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);

            tick = new System.Windows.Forms.Timer();
            tick.Interval = 60;
            tick.Tick += OnTick;
            Show();
            SetWindowPos(Handle, HWND_TOPMOST_PK, Bounds.X, Bounds.Y, Bounds.Width, Bounds.Height, SWP_NOACTIVATE_PK | SWP_SHOWWINDOW_PK);
            tick.Start();
        }

        static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

        void OnTick(object sender, EventArgs e)
        {
            if (done) return;
            if (Environment.TickCount - started > timeoutMs) { Finish(null, "timeout"); return; }
            PKPOINT p;
            int x = lastX;
            int y = lastY;
            if (GetCursorPos(out p)) { x = p.X; y = p.Y; }

            bool esc = Down(VK_ESC);
            bool enter = Down(VK_ENTER);
            bool lb = Down(VK_LBRACKET);
            bool rb = Down(VK_RBRACKET);
            if (esc && !kEsc) { Finish(null, "cancel"); return; }
            if (lb && !kL) { level -= 1; lastX = int.MinValue; }
            if (rb && !kR) { level += 1; lastX = int.MinValue; }
            if (enter && !kEnter)
            {
                if (info != null) Finish(info, "");
                return;
            }
            kEsc = esc; kEnter = enter; kL = lb; kR = rb;

            if (x != lastX || y != lastY)
            {
                lastX = x;
                lastY = y;
                info = BlockAt(x, y, level);
                try { Invalidate(); } catch { }
            }
        }

        void Finish(PickInfo i, string why)
        {
            if (done) return;
            done = true;
            try { tick.Stop(); tick.Dispose(); } catch { }
            if (i != null)
            {
                Last = i;
                DshOverlay.EmitLine("{\"event\":\"pick\",\"rect\":\"" + i.X + "," + i.Y + "," + i.W + "," + i.H
                    + "\",\"name\":\"" + Esc_(i.Name) + "\",\"type\":\"" + Esc_(i.Type)
                    + "\",\"fallback\":" + (i.Fallback ? "true" : "false") + "}");
            }
            else
            {
                DshOverlay.EmitLine("{\"event\":\"pick-none\",\"why\":\"" + Esc_(why) + "\"}");
            }
            form = null;
            try { Hide(); } catch { }
            try { Close(); } catch { }
            DshCard.Resume();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (info == null || info.W <= 0 || info.H <= 0) return;
            Rectangle r = new Rectangle(info.X - Bounds.X, info.Y - Bounds.Y, info.W, info.H);
            using (Pen pen = new Pen(Color.FromArgb(110, 196, 255), 2f))
            {
                pen.DashStyle = DashStyle.Dash;
                e.Graphics.DrawRectangle(pen, r);
            }
            string tag = info.Fallback
                ? "聚焦框"
                : (info.Type == null ? "" : info.Type.Replace("ControlType.", "")) + (string.IsNullOrEmpty(info.Name) ? "" : "：" + info.Name);
            if (tag.Length > 40) tag = tag.Substring(0, 40);
            tag = tag + "  · 回车框这块 · [ ] 收放 · Esc 取消";
            using (Font f = new Font("Microsoft YaHei UI", 9f))
            using (SolidBrush b = new SolidBrush(Color.FromArgb(110, 196, 255)))
            using (SolidBrush bg = new SolidBrush(Color.FromArgb(28, 34, 46)))
            {
                int ly = r.Top - 22 >= 0 ? r.Top - 22 : r.Top + 4;
                SizeF sz = e.Graphics.MeasureString(tag, f);
                e.Graphics.FillRectangle(bg, r.Left, ly, sz.Width + 6, sz.Height + 2);
                e.Graphics.DrawString(tag, f, b, r.Left + 3, ly + 1);
            }
        }
    }
}

public static class DshSec
{
    // 2026-11-09：前台程序是不是「管理员权限」跑着的。
    // 为什么要看这个：提权窗口里的字（安装器、系统设置、某些安全软件）不该被读出来交给模型，
    // 而且我们这种普通权限进程本来就拿不到它的完整内容——读一半反而更像幻觉。
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int needed);

    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint TOKEN_QUERY = 0x0008;
    const int TokenElevation = 20;

    public static bool ForegroundElevated()
    {
        try
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            uint pid = 0;
            GetWindowThreadProcessId(fg, out pid);
            if (pid == 0) return false;
            IntPtr proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (proc == IntPtr.Zero) return false;
            IntPtr token = IntPtr.Zero;
            try
            {
                if (!OpenProcessToken(proc, TOKEN_QUERY, out token)) return false;
                int elevated = 0;
                int needed = 0;
                if (!GetTokenInformation(token, TokenElevation, out elevated, 4, out needed)) return false;
                return elevated != 0;
            }
            finally
            {
                if (token != IntPtr.Zero) CloseHandle(token);
                CloseHandle(proc);
            }
        }
        catch { return false; }
    }
}

public static class DshBubble
{
    [DllImport("user32.dll")]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_SHOWWINDOW = 0x0040;

    public static void Trace(string line)
    {
        try
        {
            string p = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dsh-bubble.log");
            System.IO.File.AppendAllText(p, DateTime.Now.ToString("HH:mm:ss") + " " + line + Environment.NewLine);
        }
        catch { }
    }

    public static void Say(string text, int x, int y, int ms)
    {
        DshOverlay.OnUi(delegate()
        {
            try { new BubbleForm(text, x, y, ms); }
            catch (Exception e) { Trace("ERR " + e.ToString()); }
        });
        Trace("say start x=" + x + " y=" + y + " ms=" + ms + " text=" + text);
    }

    static readonly List<BubbleForm> active = new List<BubbleForm>();
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr BeginDeferWindowPos(int count);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr DeferWindowPos(IntPtr batch, IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll", SetLastError=true)] static extern bool EndDeferWindowPos(IntPtr batch);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    public static bool MoveTogether(IntPtr cursor, IntPtr after, int x, int y, int w, int h, uint flags)
    {
        // All forms are unowned top-level windows on the overlay STA (GA_PARENT=1).
        var bubbles = active.FindAll(delegate(BubbleForm f) { return !f.IsDisposed && f.Visible; });
        IntPtr parent = GetAncestor(cursor, 1);
        foreach (BubbleForm f in bubbles) if (GetAncestor(f.Handle, 1) != parent) return false;
        Rectangle anchor = new Rectangle(x, y, w, h);
        IntPtr batch = BeginDeferWindowPos(1 + bubbles.Count);
        if (batch == IntPtr.Zero) return false;
        batch = DeferWindowPos(batch, cursor, after, x, y, w, h, flags | SWP_NOACTIVATE);
        if (batch == IntPtr.Zero) return false;
        foreach (BubbleForm f in bubbles)
        {
            Point p = f.FollowLocation(anchor);
            batch = DeferWindowPos(batch, f.Handle, HWND_TOPMOST, p.X, p.Y, f.Width, f.Height, SWP_NOACTIVATE);
            if (batch == IntPtr.Zero) return false;
        }
        return EndDeferWindowPos(batch);
    }
    sealed class BubbleForm : Form
    {
        const int MaxWidth = 380;
        const int Pad = 14;
        readonly System.Windows.Forms.Timer life;
        readonly Rectangle fallbackAnchor;

        Point FollowLocation()
        {
            Rectangle anchor;
            if (!DshOverlay.TryGetBounds(out anchor)) anchor = fallbackAnchor;
            return FollowLocation(anchor);
        }
        public Point FollowLocation(Rectangle anchor)
        {
            Rectangle wa = Screen.FromPoint(new Point(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2)).WorkingArea;
            return DshOverlayGeometry.BubbleLocation(anchor, ClientSize, wa, Cursor.Position);
        }

        readonly string msg;
        readonly Font font;

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
                cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
                return cp;
            }
        }

        public BubbleForm(string text, int x, int y, int ms)
        {
            msg = text == null ? "" : text;
            font = new Font("Microsoft YaHei UI", 11f, FontStyle.Regular, GraphicsUnit.Point);

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);
            // 2026-11-08：原来 30,34,42 跟 DSH 的深色界面糊在一起，看不出来。提亮 + 加边。
            BackColor = Color.FromArgb(42, 52, 72);

            Size sz = Measure();
            ClientSize = sz;

            fallbackAnchor = new Rectangle(x, y, DshOverlay.cursorSize, DshOverlay.cursorSize);
            Point pos = FollowLocation();
            int px = pos.X, py = pos.Y;
            Location = pos;
            DshBubble.Trace("bubble at " + px + "," + py + " size " + sz.Width + "x" + sz.Height + " vis " + Visible);

            // 2026-11-08：先不要圆角。Region 一旦被裁空，窗体就是「存在但看不见」。

            life = new System.Windows.Forms.Timer();
            life.Interval = ms > 400 ? ms : 400;
            // 2026-11-08：消失前淡出，不要「啪」地没了。
            life.Tick += delegate { life.Stop(); FadeOut(); };
            life.Start();
            // 2026-11-08：别指望 Application.Run 帮我们 Show，显式来一次。
            Show();
            // 2026-11-08：光有 TopMost 属性不够，照 overlay 的做法用 SetWindowPos 强制置顶。
            bool ok = SetWindowPos(Handle, HWND_TOPMOST, px, py, sz.Width, sz.Height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            // 2026-11-08：置顶之后再上圆角——顺序反了会被重设掉。
            try { Region = Rounded(new Rectangle(0, 0, sz.Width, sz.Height), 12); } catch { }
            DshBubble.Trace("after show: vis=" + Visible + " handle=" + Handle + " topmost=" + TopMost + " setpos=" + ok);
            active.Add(this);
            FormClosed += delegate { active.Remove(this); life.Stop(); life.Dispose(); font.Dispose(); };
        }

        void FadeOut()
        {
            System.Windows.Forms.Timer ft = new System.Windows.Forms.Timer();
            ft.Interval = 16;
            double op = 1.0;
            ft.Tick += delegate
            {
                op -= 0.09;
                if (op <= 0.05)
                {
                    ft.Stop();
                    Hide();
                    Close();
                }
                else
                {
                    try { Opacity = op; } catch { }
                }
            };
            ft.Start();
        }

        Size Measure()
        {
            int max = MaxWidth - Pad * 2;
            Size s = TextRenderer.MeasureText(msg, font, new Size(max, 2000), TextFormatFlags.WordBreak);
            int w = s.Width + Pad * 2;
            int h = s.Height + Pad * 2;
            if (w > MaxWidth) w = MaxWidth;
            if (w < 120) w = 120;
            if (h < 44) h = 44;
            return new Size(w, h);
        }

        static GraphicsPath RoundPath(int x, int y, int w, int h, int radius)
        {
            try
            {
                GraphicsPath p = new GraphicsPath();
                int d = radius * 2;
                p.AddArc(x, y, d, d, 180, 90);
                p.AddArc(x + w - d, y, d, d, 270, 90);
                p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
                p.AddArc(x, y + h - d, d, d, 90, 90);
                p.CloseFigure();
                return p;
            }
            catch { return null; }
        }

        static Region Rounded(Rectangle r, int radius)
        {
            GraphicsPath p = new GraphicsPath();
            int d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return new Region(p);
        }

        static int paintCount = 0;

        protected override void OnPaint(PaintEventArgs e)
        {
            if (paintCount < 1) { paintCount++; DshBubble.Trace("paint " + ClientSize.Width + "x" + ClientSize.Height); }
            e.Graphics.Clear(BackColor);
            // 2026-11-08 浔：「边框不好看，要不不要了」——去掉，只留圆角底。
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            TextRenderer.DrawText(e.Graphics, msg, font,
                new Rectangle(Pad, Pad, ClientSize.Width - Pad * 2, ClientSize.Height - Pad * 2),
                Color.FromArgb(238, 242, 248),
                TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
        }
    }
}

public static class DshEye
{
    // 抽样比较两张同尺寸位图，返回 0-100 的变化百分比。
    public static int DiffPct(Bitmap a, Bitmap b)
    {
        if (a == null || b == null) return 100;
        int w = Math.Min(a.Width, b.Width);
        int h = Math.Min(a.Height, b.Height);
        int step = Math.Max(1, Math.Min(w, h) / 64);
        int diff = 0, total = 0;
        for (int y = 0; y < h; y += step)
        {
            for (int x = 0; x < w; x += step)
            {
                Color ca = a.GetPixel(x, y);
                Color cb = b.GetPixel(x, y);
                int d = Math.Abs(ca.R - cb.R) + Math.Abs(ca.G - cb.G) + Math.Abs(ca.B - cb.B);
                if (d > 24) diff++;
                total++;
            }
        }
        return total == 0 ? 0 : (int)(diff * 100.0 / total);
    }
}
'@

# 2026-11-08：气泡和光标窗并成同一个编译单元——不然右键菜单调不到气泡。
Add-Type -TypeDefinition ($cs + [Environment]::NewLine + $bubbleCs) -ReferencedAssemblies $refs

# ---------------------------------------------------------------- mousepet: 气泡 + 帧差
# 2026-11-08 加：这个插件除了「动手」，还要能在桌面上待着、偶尔说一句话。
# 气泡走自己的 STA 线程，不阻塞请求循环，也不抢焦点（WS_EX_NOACTIVATE）。


# （$petCs 已并入上面的 $bubbleCs）

# ---------------------------------------------------------------- UIA helpers

function Get-UiaElementAt([int]$x, [int]$y) {
  if (-not $script:uia) { return $null }
  try {
    $pt = [System.Windows.Point]::new([double]$x, [double]$y)
    return [System.Windows.Automation.AutomationElement]::FromPoint($pt)
  } catch { return $null }
}

function Get-UiaName($el) {
  try { return [string]$el.Current.Name } catch { return '' }
}

function Get-UiaType($el) {
  try { return [string]$el.Current.ControlType.ProgrammaticName } catch { return '' }
}

function Invoke-UiaClick([int]$x, [int]$y) {
  $el = Get-UiaElementAt $x $y
  if ($null -eq $el) { return @{ ok = $false; reason = 'uia-no-element' } }
  $name = Get-UiaName $el
  $type = Get-UiaType $el
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $cur = $el
  for ($i = 0; $i -lt 6 -and $null -ne $cur; $i++) {
    $n = Get-UiaName $cur
    $t = Get-UiaType $cur
    try {
      $p = $cur.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $p.Invoke()
      return @{ ok = $true; via = 'uia'; pattern = 'Invoke'; name = $n; type = $t }
    } catch { }
    try {
      $p = $cur.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      $p.Toggle()
      return @{ ok = $true; via = 'uia'; pattern = 'Toggle'; name = $n; type = $t }
    } catch { }
    try {
      $p = $cur.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $p.Select()
      return @{ ok = $true; via = 'uia'; pattern = 'Select'; name = $n; type = $t }
    } catch { }
    try { $cur = $walker.GetParent($cur) } catch { $cur = $null }
  }
  return @{ ok = $false; reason = 'uia-no-pattern'; name = $name; type = $type }
}

function Set-UiaText([int]$x, [int]$y, [string]$text, [bool]$replace) {
  $el = Get-UiaElementAt $x $y
  if ($null -eq $el) { return @{ ok = $false; reason = 'uia-no-element' } }
  $name = Get-UiaName $el
  $type = Get-UiaType $el
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($replace) { $vp.SetValue($text) }
    else { $vp.SetValue([string]$vp.Current.Value + $text) }
    return @{ ok = $true; via = 'uia'; pattern = 'Value'; name = $name; type = $type }
  } catch { }
  try {
    $legacy = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    $legacy.SetValue($text)
    return @{ ok = $true; via = 'uia'; pattern = 'LegacyValue'; name = $name; type = $type }
  } catch { }
  return @{ ok = $false; reason = 'uia-no-value'; name = $name; type = $type }
}

function Set-UiaFocus([int]$x, [int]$y) {
  $el = Get-UiaElementAt $x $y
  if ($null -eq $el) { return @{ ok = $false; reason = 'uia-no-element' } }
  $name = Get-UiaName $el
  $type = Get-UiaType $el
  try {
    $el.SetFocus()
    return @{ ok = $true; via = 'uia'; pattern = 'Focus'; name = $name; type = $type }
  } catch {
    return @{ ok = $false; reason = 'uia-no-focus'; name = $name; type = $type }
  }
}

function Invoke-UiaScroll([int]$x, [int]$y, [int]$delta) {
  $el = Get-UiaElementAt $x $y
  if ($null -eq $el) { return @{ ok = $false; reason = 'uia-no-element' } }
  $name = Get-UiaName $el
  $type = Get-UiaType $el
  $amount = if ($delta -gt 0) { [System.Windows.Automation.ScrollAmount]::SmallIncrement } else { [System.Windows.Automation.ScrollAmount]::SmallDecrement }
  try {
    $sp = $el.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
    $sp.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, $amount)
    return @{ ok = $true; via = 'uia'; pattern = 'Scroll'; name = $name; type = $type }
  } catch { }
  try {
    $si = $el.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern)
    $si.ScrollIntoView()
    return @{ ok = $true; via = 'uia'; pattern = 'ScrollItem'; name = $name; type = $type }
  } catch { }
  return @{ ok = $false; reason = 'uia-no-scroll'; name = $name; type = $type }
}

# ---------------------------------------------------------------- window list

function Get-WindowsList {
  $result = @()
  $foreground = [long][DshInput]::GetForegroundWindow()
  foreach ($h in [DshInput]::EnumTopWindows()) {
    try {
      if (-not [DshInput]::IsWindowVisible($h)) { continue }
      $title = [DshInput]::WindowTitle($h)
      if ([string]::IsNullOrWhiteSpace($title)) { continue }
      $pid2 = [DshInput]::WindowPid($h)
      $procName = ''
      try { $procName = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { }
      $rect = [DshInput]::WindowRect($h)
      $result += @{
        hwnd = [long]$h
        title = $title
        className = [DshInput]::WindowClass($h)
        process = $procName
        pid = $pid2
        rect = @{ x = $rect[0]; y = $rect[1]; w = $rect[2]; h = $rect[3] }
        foreground = ([long]$h -eq $foreground)
        iconic = [DshInput]::IsIconic($h)
      }
    } catch { }
  }
  return ,$result
}

# ---------------------------------------------------------------- keyboard map

function Get-Vk([string]$name) {
  $n = $name.Trim().ToLower()
  switch ($n) {
    'ctrl' { return 0x11 }
    'control' { return 0x11 }
    'shift' { return 0x10 }
    'alt' { return 0x12 }
    'menu' { return 0x12 }
    'win' { return 0x5B }
    'lwin' { return 0x5B }
    'rwin' { return 0x5C }
    'enter' { return 0x0D }
    'return' { return 0x0D }
    'esc' { return 0x1B }
    'escape' { return 0x1B }
    'tab' { return 0x09 }
    'space' { return 0x20 }
    'backspace' { return 0x08 }
    'delete' { return 0x2E }
    'del' { return 0x2E }
    'insert' { return 0x2D }
    'ins' { return 0x2D }
    'home' { return 0x24 }
    'end' { return 0x23 }
    'pageup' { return 0x21 }
    'pagedown' { return 0x22 }
    'up' { return 0x26 }
    'down' { return 0x28 }
    'left' { return 0x25 }
    'right' { return 0x27 }
    'capslock' { return 0x14 }
    'numlock' { return 0x90 }
    'printscreen' { return 0x2C }
    'scrolllock' { return 0x91 }
    'pause' { return 0x13 }
    'apps' { return 0x5D }
    default {
      if ($n.Length -eq 1) { return [int][char]$n.ToUpper() }
      if ($n -match '^f([1-9]|1[0-2])$') { return 0x6F + [int]$Matches[1] }
      throw "unknown key: $name"
    }
  }
}

# ---------------------------------------------------------------- status

function Get-StatusResult {
  $cursor = [DshInput]::CursorPos()
  $fg = [DshInput]::GetForegroundWindow()
  $fgTitle = ''
  try { $fgTitle = [DshInput]::WindowTitle($fg) } catch { }
  return @{
    paused = [DshInput]::Paused
    pauseReason = [DshInput]::PauseReason
    lastUserInputAgeMs = [DshInput]::LastUserInputAgeMs()
    cursor = @{ x = $cursor[0]; y = $cursor[1] }
    # 2026-11-08：全是物理像素，跟 cursor / winInfo / SetWindowPos 同一套。
    screen = @{
      x = [DshInput]::GetSystemMetrics(76); y = [DshInput]::GetSystemMetrics(77)
      w = [DshInput]::GetSystemMetrics(78); h = [DshInput]::GetSystemMetrics(79)
    }
    dpiScale = [math]::Round(([DshInput]::GetSystemMetrics(78) / [math]::Max(1, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width)), 3)
    foreground = @{
      hwnd = [long]$fg
      title = $fgTitle
      className = [DshInput]::WindowClass($fg)
      pid = [DshInput]::WindowPid($fg)
    }
    overlay = [DshOverlay]::VisibleNow()
    # 2026-11-08 16:4x：AI 光标自己的位置，报物理像素（跟外面说的话同一套）
    cursorOverlay = @{
      # 2026-11-08 17:2x astra：LastX/LastY 本身就是物理像素，再乘一遍就报错了。
      x = [int][DshOverlay]::LastX
      y = [int][DshOverlay]::LastY
      hasLast = [DshOverlay]::HasLast
    }
    overlayRect = [DshOverlay]::Bounds()
    overlayHwnd = [DshOverlay]::HandleId()
    hotkey = 'Ctrl+Alt+Q'
    hotkeyRegistered = [DshInput]::HotkeyRegistered
    uia = $script:uia
    cursorMode = $script:cursorMode
    cursorHoldMs = $script:cursorHoldMs
    cursorSize = $script:cursorSize
    cursorStyle = $script:cursorStyle
    cursorState = if ([DshInput]::Paused) { 'unavailiable' } else { $script:cursorStyle }
    userActiveMs = [DshInput]::UserActiveMs
  }
}

function Get-PausedResult {
  if (-not [DshInput]::Paused) { return $null }
  return @{
    ok = $false
    paused = $true
    reason = 'paused'
    note = '主人已经暂停/接管输入。不要继续操作；等主人说继续，再调用 action:"resume"。'
  }
}

function Show-StateAt([string]$state, [int]$x, [int]$y) {
  if ($script:styleNames -contains $state) { $script:cursorStyle = $state }
  [DshOverlay]::SetStyle($script:cursorStyle)
  [DshOverlay]::ShowAt($x, $y)
}

# 2026-11-08：物理动作结束后把 AI 光标亮回来。
# 以前物理分支 Hide 完就不管（怕两套光标叠着闪），结果是「她一动，我就消失」。
# 现在放回真实光标旁边、错开 24px：看得见，也不叠着闪。
# 2026-11-08 21:5x 浔：「点了以后那个光标会往右下去。」
#   原因：点完调 Show-StateAt 用的是点击点本身，而点击前飞过去停在 (x-26,y-22)，
#   一按就把光标从左上弹回右下 —— 看起来就是「往右下去」。
#   这个函数让「点亮在目标左上」，和飞过去的位置同口径，点完不再弹。
function NearOffset { return ([int]$script:cursorSize + 8) }
function Show-NearTarget([string]$state, [int]$x, [int]$y) {
  $d = NearOffset
  Show-StateAt $state ([Math]::Max(0, $x - $d)) ([Math]::Max(0, $y - $d))
}

function Restore-AiCursor {
  if ($script:cursorMode -eq 'clean') { return }
  $pos = [System.Windows.Forms.Cursor]::Position
  # 2026-11-08 21:4x 浔：「不要飘到右下，飘到左上吧。」——错开到左上，靠边夹回 0。
  $d = NearOffset
  $ax = [Math]::Max(0, $pos.X - $d)
  $ay = [Math]::Max(0, $pos.Y - $d)
  Show-StateAt 'pointer' $ax $ay
}

# ---------------------------------------------------------------- requests

function Invoke-WatchFrames($req) {
  # 连拍一小段，按画面变化挑帧。陪伴时用：想知道她刚在干什么，
  # 又不想每秒都看一眼。静止画面只会回一两帧，很便宜。
  $sec = if ($null -ne $req.seconds) { [double]$req.seconds } else { 4 }
  if ($sec -lt 0.5) { $sec = 0.5 }
  if ($sec -gt 20) { $sec = 20 }
  $fps = if ($null -ne $req.fps) { [double]$req.fps } else { 4 }
  if ($fps -lt 0.5) { $fps = 0.5 }
  if ($fps -gt 10) { $fps = 10 }
  $keep = if ($null -ne $req.frames) { [int]$req.frames } else { 4 }
  if ($keep -lt 1) { $keep = 1 }
  if ($keep -gt 9) { $keep = 9 }

  $area = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $dir = if ($req.out) { [string]$req.out } else { Join-Path $env:TEMP 'ming-mousepet\watch' }
  try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { }

  $saved = New-Object System.Collections.ArrayList
  $prev = $null
  $count = [int]([Math]::Ceiling($sec * $fps))
  if ($count -lt 1) { $count = 1 }
  if ($count -gt 120) { $count = 120 }

  for ($i = 0; $i -lt $count; $i++) {
    $bmp = $null
    try {
      $bmp = [System.Drawing.Bitmap]::new($area.Width, $area.Height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($area.X, $area.Y, 0, 0, $bmp.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
      $g.Dispose()

      $tw = 320
      $th = [int][Math]::Round($bmp.Height * $tw / $bmp.Width)
      if ($th -lt 1) { $th = 1 }
      $thumb = [System.Drawing.Bitmap]::new($bmp, $tw, $th)

      $d = 100
      if ($null -ne $prev) {
        $d = [DshEye]::DiffPct($prev, $thumb)
        $prev.Dispose()
      }
      $prev = $thumb

      if ($d -ge 2 -or $i -eq 0) {
        $f = Join-Path $dir ("f{0}.png" -f $i)
        $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
        [void]$saved.Add(@{ path = $f; diff = $d; t = [Math]::Round($i / $fps, 2) })
      }
    } catch {
      # 抓帧失败不该拖垮整次 watch，跳过这一帧。
    } finally {
      if ($null -ne $bmp) { $bmp.Dispose() }
    }
    Start-Sleep -Milliseconds ([int](1000 / $fps))
  }
  if ($null -ne $prev) { $prev.Dispose() }

  $picked = @()
  if ($saved.Count -gt 0) {
    $picked = @($saved | Sort-Object { $_.diff } -Descending | Select-Object -First $keep | Sort-Object { $_.t })
  }
  return @{
    ok = $true
    dir = $dir
    seconds = $sec
    fps = $fps
    captured = $count
    kept = @($picked).Count
    frames = $picked
    area = @{ x = $area.X; y = $area.Y; w = $area.Width; h = $area.Height }
  }
}

# 2026-11-08 16:4x：物理像素 ↔ 逻辑像素。进程不是 DPI-aware，系统给的是逻辑；
#   外面（截图/人工读坐标）说的是物理。两个之间就差这个比例。
function Get-DpiScale {
  # 2026-11-08 17:2x astra：原来这里是 GetSystemMetrics(78) / Screen.Bounds.Width，
  #   在这台机器上等于 3640 / 2560 = 1.422 —— 那是「虚拟桌面宽 ÷ 主屏宽」，
  #   两台显示器拼出来的比值（主屏 2560x1600 + 副屏 1080x1920），跟 DPI 没关系。
  #   真正的比例是 dpi / 96（这台机器 150%，所以是 1.5）。
  try {
    $dpi = [DshInput]::GetDpiForSystem()
    if ($dpi -gt 0) { return [double]$dpi / 96.0 }
    return 1.0
  } catch { return 1.0 }
}

function Invoke-Request($req) {
  $cmd = [string]$req.cmd

  # 2026-11-08 17:2x astra：**这里的坐标换算整段删掉了，别再往加回来。**
  #   进程自己调了 SetProcessDpiAwarenessContext(-4)（per-monitor v2），
  #   所以 SetWindowPos / SendInput / GetCursorPos / GetSystemMetrics 进出的都是物理像素，
  #   端到端本来就是同一个空间。
  #   原来那个 dpiScale 是「虚拟桌面宽 ÷ 主屏宽」= 3640/2560 = 1.422（两台显示器拼出来的），
  #   拿它再除一遍，等于把所有坐标缩到左上角 —— 点击落在标题栏、光标跑到屏幕外都是这一处。
  #   实测（calscan go:true）：给 (2000,1500) 读回 (1997,1512)，同一个空间。
  $script:dpiScale = Get-DpiScale

  switch ($cmd) {
    'ping' { return @{ pong = $true } }
    'status' { return Get-StatusResult }
    'setCursorMode' {
      $m = [string]$req.mode
      if ($m -eq 'clean' -or $m -eq 'companion') { $script:cursorMode = $m }
      if ($null -ne $req.holdMs) { $script:cursorHoldMs = [int]$req.holdMs }
      [DshOverlay]::SetMode($script:cursorMode, $script:cursorHoldMs)
      return @{ ok = $true; cursorMode = $script:cursorMode; cursorHoldMs = $script:cursorHoldMs }
    }
    'setCursorSize' {
      $s = [int]$req.size
      if ($s -ge 24 -and $s -le 192) { $script:cursorSize = $s }
      [DshOverlay]::SetSize($script:cursorSize)
      return @{ ok = $true; cursorSize = $script:cursorSize }
    }
    'setCursorStyle' {
      $s = ([string]$req.style).ToLower()
      if ($script:styleNames -contains $s) { $script:cursorStyle = $s }
      [DshOverlay]::SetStyle($script:cursorStyle)
      return @{ ok = $true; cursorStyle = $script:cursorStyle; styles = $script:styleNames }
    }
    'simulateUserInput' {
      [DshInput]::SimulateUserInput()
      return Get-StatusResult
    }
    'debug' {
      $h = [DshOverlay]::HandleId()
      $hr = @(0, 0, 0, 0)
      $vis = $false
      $ex = 0
      if ($h -ne 0) {
        $hr = [DshInput]::WindowRect([IntPtr]$h)
        $vis = [DshInput]::IsWindowVisible([IntPtr]$h)
        $ex = [DshInput]::WindowExStyle([IntPtr]$h)
      }
      return @{
        hwnd = $h
        visible = $vis
        rect = $hr
        bounds = [DshOverlay]::Bounds()
        exStyle = ('0x{0:X}' -f $ex)
        style = if ($h -ne 0) { '0x{0:X}' -f ([long][DshInput]::GetWindowLongPtrW([IntPtr]$h, -16)) } else { '0x0' }
        parent = if ($h -ne 0) { [long][DshInput]::GetParent([IntPtr]$h) } else { 0 }
        root = if ($h -ne 0) { [long][DshInput]::RootOf([IntPtr]$h) } else { 0 }
        topmost = (($ex -band 0x8) -ne 0)
        transparent = (($ex -band 0x20) -ne 0)
        noactivate = (($ex -band 0x08000000) -ne 0)
        toolwindow = (($ex -band 0x80) -ne 0)
        setWindowPosOk = [DshOverlay]::LastSetWindowPosOk
        setWindowPosError = [DshOverlay]::LastSetWindowPosError
      }
    }
    'windows' { return @{ windows = (Get-WindowsList) } }
    'say' {
      # 在桌面上说一句话：无边框小气泡，几秒后自己消失，不抢焦点。
      $text = [string]$req.text
      if ([string]::IsNullOrWhiteSpace($text)) { return @{ ok = $false; error = 'text 不能为空' } }
      if ($text.Length -gt 400) { $text = $text.Substring(0, 400) }
      $ms = if ($null -ne $req.ms) { [int]$req.ms } else { 3200 }
      if ($ms -lt 600) { $ms = 600 }
      if ($ms -gt 20000) { $ms = 20000 }
      # 2026-11-08 浔说「它在我的鼠标上说了，不是在你的鼠标上」——
      # 没给坐标时该贴 AI 光标，不该借用真实光标。
      $bx = -1
      $by = -1
      $nearCursor = $false
      $coordGiven = ($null -ne $req.x -and $null -ne $req.y)
      if ($coordGiven) {
        $bx = [int]$req.x
        $by = [int]$req.y
      } elseif ($null -eq $req.x -or $null -eq $req.y) {
        # 2026-11-08：没给坐标 = 「到我鼠标这边说」。
        # 现读真实光标，落在它右下方 24px——外面先读再发请求会晚一两秒，她手一动就偏。
        # 2026-11-08 浔调的偏移：右 74、下 44（原 24/24 再各加 50 / 20）。
        $c = [DshInput]::CursorPos()
        $bx = [int]$c[0] + 74
        $by = [int]$c[1] + 44
        $nearCursor = $true
      } elseif ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      } else {
        # 连我自己的位置都没有时，落在主屏中间偏上——绝不借用真实光标
        # （她的副屏上那只手跟我没关系，泡弹过去就是白说）。
        # 2026-11-08：不认「主屏」了。虚拟桌面 = 所有屏并起来那块（物理像素），
        # 副屏竖着挂、左边挂、上面挂都不用管，落在并集中心就一定看得见。
        $vx = [DshInput]::GetSystemMetrics(76)
        $vy = [DshInput]::GetSystemMetrics(77)
        $vw = [DshInput]::GetSystemMetrics(78)
        $vh = [DshInput]::GetSystemMetrics(79)
        $bx = $vx + [int]($vw / 2) - 32
        $by = $vy + [int]($vh / 2) - 60
        Show-StateAt 'pointer' $bx $by
      }
      # 2026-11-08 14:24：气泡落在副屏、她在主屏看——说了但没看见。
      # 判据不是「我的光标在哪」，是「她现在盯的是哪块屏」：取前台窗口所在的显示器，
      # 落点跑到别的屏上就挪回这块屏中间偏上，顺便把 AI 光标也落到那儿。
      $fg = [DshInput]::GetForegroundWindow()
      if (-not $coordGiven -and -not $nearCursor -and $fg -ne [IntPtr]::Zero) {
        $sr = [System.Windows.Forms.Screen]::FromHandle($fg).Bounds
        if ($bx -lt $sr.Left -or $bx -ge $sr.Right -or $by -lt $sr.Top -or $by -ge $sr.Bottom) {
          $bx = $sr.Left + [int]($sr.Width / 2) - 32
          $by = $sr.Top + [int]($sr.Height * 0.35)
          Show-StateAt 'pointer' $bx $by
        }
      }
      # 2026-11-08 14:29 浔定的：气泡直接绑死在桌宠身上，按它的坐标偏移。
      # 给了坐标就先把桌宠挪过去；然后再统一以桌宠**当前**位置为基准画泡——
      # 传进来的点可能是几步之前的，信它就会泡在这儿、我站那儿。
      if ($true) {
        # 2026-11-08 浔：「是不是没有缓动」——是，先前用 Show-StateAt 直接钉过去的。
        # 改成真滑过去（ease-out 520ms）：先确保它已经在屏幕上，滑完再按落点画泡。
        $script:cursorStyle = 'pointer'
        if (-not [DshOverlay]::VisibleNow() -and [DshOverlay]::HasLast) {
          [DshOverlay]::ShowAt([DshOverlay]::LastX, [DshOverlay]::LastY)
        }
        $glMs = 520
        [DshOverlay]::Glide($bx, $by, $glMs)
        # Bubble follows successful actual bounds while the glide is running.
      }
      if ([DshOverlay]::HasLast) {
        $bx = [DshOverlay]::LastX
        $by = [DshOverlay]::LastY
      }
      if (-not [DshOverlay]::VisibleNow()) { Show-StateAt 'pointer' $bx $by }
      [DshBubble]::Say($text, $bx, $by, $ms)
      return @{ ok = $true; text = $text; ms = $ms; x = $bx; y = $by; cursorX = [DshInput]::CursorPos()[0]; cursorY = [DshInput]::CursorPos()[1] }
    }
    'watch' {
      return Invoke-WatchFrames $req
    }
    'windowAt' {
      $h = [DshInput]::WindowAt([int]$req.x, [int]$req.y)
      return @{
        hwnd = [long]$h
        title = [DshInput]::WindowTitle($h)
        className = [DshInput]::WindowClass($h)
        root = [long][DshInput]::RootOf($h)
      }
    }
    'uiaInfo' {
      $el = Get-UiaElementAt ([int]$req.x) ([int]$req.y)
      if ($null -eq $el) { return @{ ok = $false; reason = 'null' } }
      $r = $el.Current.BoundingRectangle
      return @{
        ok = $true
        name = (Get-UiaName $el)
        type = (Get-UiaType $el)
        className = [string]$el.Current.ClassName
        rect = @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
      }
    }
    'winInfo' {
      $h = [IntPtr][long]$req.hwnd
      $r = [DshInput]::WindowRect($h)
      return @{
        hwnd = [long]$h
        title = [DshInput]::WindowTitle($h)
        className = [DshInput]::WindowClass($h)
        visible = [DshInput]::IsWindowVisible($h)
        iconic = [DshInput]::IsIconic($h)
        rect = @{ x = $r[0]; y = $r[1]; w = $r[2]; h = $r[3] }
        foreground = ([long][DshInput]::GetForegroundWindow() -eq [long]$h)
      }
    }
    'setUserActiveMs' {
      [DshInput]::SetUserActiveMs([int]$req.ms)
      return Get-StatusResult
    }
    'setSkin' {
      $path = [string]$req.path
      if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) {
        return @{ ok = $false; error = '没有这个文件：' + $path }
      }
      [DshOverlay]::SetSkin($path)
      if ([DshOverlay]::HasLast) { [DshOverlay]::ShowAt([DshOverlay]::LastX, [DshOverlay]::LastY) }
      return @{ ok = $true; path = $path }
    }
    'calscan' {
      # 2026-11-08 17:2x astra：把坐标空间量出来，别再靠猜。
      #   probe 被排除在入口换算之外，它量的永远是「逻辑空间里的摆放」，
      #   不能用来证明物理落点。这条才是对着物理落点量的。
      #   go 不给就只读不动作：光标不会自己跑。
      $tx = [int]$req.x
      $ty = [int]$req.y
      $info = @{
        ok = $true
        asked = @{ x = $tx; y = $ty }
        dpiScale = [math]::Round((Get-DpiScale), 3)
        virtualScreen = @{
          w = [DshInput]::GetSystemMetrics(78); h = [DshInput]::GetSystemMetrics(79)
        }
        primaryBounds = @{
          w = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
          h = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height
        }
      }
      if (-not [bool]$req.go) {
        $info.moved = $false
        $info.note = '只报口径；真测传 go:true（会短暂移动真实光标，测完自动还原）'
        return $info
      }
      $paused = Get-PausedResult
      if ($null -ne $paused) { return $paused }
      $r = [DshInput]::Calibrate($tx, $ty)
      $info.moved = $true
      $info.readBack = @{ x = $r[0]; y = $r[1] }
      $info.error = @{ x = $r[2]; y = $r[3] }
      return $info
    }
    'probe' {
      $r = [DshOverlay]::Probe([int]$req.x, [int]$req.y)
      return @{
        ok = $true
        dpiScale = [math]::Round((Get-DpiScale), 3)
        asked = @{ x = [int]$req.x; y = [int]$req.y }
        last = @{ x = $r[0]; y = $r[1] }
        form = @{ x = $r[2]; y = $r[3] }
        screen = @{ w = [DshInput]::GetSystemMetrics(78); h = [DshInput]::GetSystemMetrics(79) }
      }
    }
    'act' {
      $a = if ($req.action) { [string]$req.action } else { 'click' }
      $dur = if ($null -ne $req.durationMs) { [int]$req.durationMs } else { 0 }
      $dl = if ($null -ne $req.delta) { [int]$req.delta } else { -120 }
      $hl = if ($null -ne $req.holdMs) { [int]$req.holdMs } else { 0 }
      [DshOverlay]::Act($a, [int]$req.x, [int]$req.y, [int]$req.x2, [int]$req.y2, $dur, $dl, $hl)
      return @{ ok = $true; action = $a }
    }
    'glide' {
      $x = [int]$req.x
      $y = [int]$req.y
      $ms = if ($null -ne $req.ms) { [int]$req.ms } else { 600 }
      [DshOverlay]::Glide($x, $y, $ms)
      return @{ ok = $true; x = $x; y = $y; ms = $ms }
    }
    'follow' {
      $on = $true
      if ($null -ne $req.on) { $on = [bool]$req.on }
      [DshOverlay]::followCursor = $on
      return @{ ok = $true; follow = $on }
    }
    'drift' {
      # AI 光标轻轻晃，像人站在那儿等。不碰真实光标。
      $on = $true
      if ($null -ne $req.on) { $on = [bool]$req.on }
      [DshOverlay]::SetDrift($on)
      return @{ ok = $true; drift = $on }
    }
    'move' {
      $x = [int]$req.x
      $y = [int]$req.y
      Show-StateAt 'pointer' $x $y
      return @{ ok = $true; via = 'overlay'; x = $x; y = $y; note = '只移动 AI 光标，没有移动主人的真实光标' }
    }
    'overlay' {
      if ($req.show -eq $false) { [DshOverlay]::Hide(); return @{ ok = $true; visible = $false; cursorMode = $script:cursorMode; cursorState = $script:cursorStyle } }
      # 2026-11-08：没坐标时**不要**退回真实光标——她那只手可能在副屏上，
      # 光标跟着跑过去，气泡也跟着消失在另一块屏幕里。落在主屏中间。
      $x = -1
      $y = -1
      if ($null -ne $req.x -and $null -ne $req.y) {
        $x = [int]$req.x
        $y = [int]$req.y
      } elseif ([DshOverlay]::HasLast) {
        $x = [DshOverlay]::LastX
        $y = [DshOverlay]::LastY
      } else {
        $area0 = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
        $x = $area0.X + [int]($area0.Width / 2) - 32
        $y = $area0.Y + [int]($area0.Height / 2) - 60
      }
      Show-StateAt 'pointer' $x $y
      return @{ ok = $true; visible = $true; x = $x; y = $y; cursorMode = $script:cursorMode; cursorSize = $script:cursorSize; cursorState = $script:cursorStyle }
    }
    'pause' {
      [DshInput]::Pause('api')
      if ([DshOverlay]::HasLast) { [DshOverlay]::ShowAt([DshOverlay]::LastX, [DshOverlay]::LastY) }
      return Get-StatusResult
    }
    'resume' {
      [DshInput]::Resume()
      $script:cursorStyle = 'pointer'
      [DshOverlay]::SetStyle('pointer')
      if ([DshOverlay]::HasLast) { [DshOverlay]::ShowAt([DshOverlay]::LastX, [DshOverlay]::LastY) }
      return Get-StatusResult
    }
    'click' {
      $x = [int]$req.x
      $y = [int]$req.y
      $button = if ($req.button) { [string]$req.button } else { 'left' }
      $count = if ($req.count) { [int]$req.count } else { 1 }
      $mode = if ($req.mode) { [string]$req.mode } else { 'auto' }
      $paused = Get-PausedResult
      if ($null -ne $paused) { return $paused }
      [DshOverlay]::Hide()

      $fallbackState = 'pointer'
      $r = $null
      if ($mode -eq 'uia' -or $mode -eq 'auto') {
        $r = Invoke-UiaClick $x $y
        if ($r.ok) {
          $state = if ($r.pattern -and ([string]$r.type -match 'Edit|Document|Text')) { 'text' } elseif ($r.pattern) { 'link' } else { 'pointer' }
          Show-NearTarget $state $x $y
          $r['x'] = $x
          $r['y'] = $y
          $r['button'] = $button
          $r['count'] = $count
          return $r
        }
        # UIA 没点成，但已经读到控件类型：消息点击也按控件类型给状态。
        if ($r.type) {
          $t = [string]$r.type
          if ($t -match 'Edit|Document|Text') { $fallbackState = 'text' }
          elseif ($t -match 'Button|Link|MenuItem|ListItem|TabItem|CheckBox|RadioButton|TreeItem') { $fallbackState = 'link' }
        }
        # uia 模式也允许落到窗口消息：老控件没有 InvokePattern，但消息点击有效。
      }

      if ($mode -eq 'message' -or $mode -eq 'auto' -or $mode -eq 'uia') {
        $h = [DshInput]::WindowAt($x, $y)
        if ($h -ne [IntPtr]::Zero) {
          [DshInput]::PostMouseClick($h, $x, $y, ($button -eq 'right'), $count)
          $cls = [DshInput]::WindowClass($h)
          if ($fallbackState -eq 'pointer') {
            if ($cls -match 'BUTTON|Button|SysLink|Toolbar|Menu') { $fallbackState = 'link' }
            elseif ($cls -match 'EDIT|Edit|TextBox') { $fallbackState = 'text' }
          }
          Show-NearTarget $fallbackState $x $y
          return @{
            ok = $true; via = 'message'; hwnd = [long]$h
            title = [DshInput]::WindowTitle($h)
            className = $cls
            verified = $false
            note = '窗口消息已投递，目标不一定处理；请截图确认'
          }
        }
        if ($mode -eq 'message') { return @{ ok = $false; reason = 'no-window' } }
      }

      if ($mode -eq 'physical') {
        $kept = [DshInput]::PhysicalClick($x, $y, ($button -eq 'right'), $count)
        # 物理输入已经动了真实光标；AI 光标回到她手上那颗旁边（错开 24px），
        # 既不叠着闪，也不再一藏就不回来。
        # 2026-11-09：点的是菜单就别把 AI 光标放回她手上——它一出现就压在菜单项上，
        #   菜单以为鼠标走了，子菜单当场塌掉。
        if (-not $kept) { Restore-AiCursor }
        $note = if ($kept) { '物理输入完成，光标留在原地（点在菜单上，子菜单才撑得住）' } else { '物理输入完成，光标已还原' }
        return @{ ok = $true; via = 'physical'; note = $note }
      }

      Show-StateAt 'help' $x $y
      return @{
        ok = $false; reason = 'no-route'; needsPhysical = $true
        note = 'UIA 与窗口消息都没成功；如果必须物理点击，明确传 mode:"physical"'
      }
    }
    'type' {
      $text = [string]$req.text
      $mode = if ($req.mode) { [string]$req.mode } else { 'auto' }
      $replace = $false
      if ($null -ne $req.replace) { $replace = [bool]$req.replace }
      $hasPoint = ($null -ne $req.x -and $null -ne $req.y)
      $paused = Get-PausedResult
      if ($null -ne $paused) { return $paused }
      [DshOverlay]::Hide()

      if ($mode -eq 'uia' -or $mode -eq 'auto') {
        if ($hasPoint) {
          $px = [int]$req.x
          $py = [int]$req.y
          $r = Set-UiaText $px $py $text $replace
          if ($r.ok) { Show-StateAt 'text' $px $py; return $r }
          $f = Set-UiaFocus $px $py
          if ($f.ok) {
            [DshInput]::PhysicalText($text)
            Restore-AiCursor
            return @{ ok = $true; via = 'uia-focus+physical'; pattern = 'Focus'; name = $f.name; type = $f.type; note = 'UIA 聚焦后用独立键盘输入，未移动鼠标' }
          }
          # 老式 WinForms / 原生控件常常只有 MSAA，没有 UIA Value/Focus。
          # 先试 WM_SETTEXT（对 Edit 控件最稳，不需要聚焦、不碰光标）。
          $h = [DshInput]::WindowAt($px, $py)
          if ($h -ne [IntPtr]::Zero) {
            $cls = [DshInput]::WindowClass($h)
            if ($cls -match 'EDIT|Edit|TextBox') {
              $cur = [DshInput]::GetWindowText($h)
              $want = if ($replace) { $text } else { $cur + $text }
              [DshInput]::SetTextMessage($h, $want) | Out-Null
              Start-Sleep -Milliseconds 60
              $now = [DshInput]::GetWindowText($h)
              Show-StateAt 'text' $px $py
              if ($now -eq $want) {
                return @{ ok = $true; via = 'wm_settext'; hwnd = [long]$h; verified = $true; note = '直接写入 Edit 控件，未移动光标、未抢焦点' }
              }
            }
            [DshInput]::PostMouseClick($h, $px, $py, $false, 1)
            Start-Sleep -Milliseconds 90
            $fh = [DshInput]::GetFocusWindow()
            [DshInput]::PostText($fh, $text)
            Show-StateAt 'text' $px $py
            return @{ ok = $true; via = 'uia+message'; hwnd = [long]$fh; verified = $false; note = 'UIA 无 Value/Focus，已改用窗口消息聚焦并输入；请截图确认' }
          }
          if ($mode -eq 'uia') { return @{ ok = $false; reason = 'no-window' } }
        } elseif ($mode -eq 'uia') {
          return @{ ok = $false; reason = 'need-point' }
        }
      }

      if ($mode -eq 'message' -or $mode -eq 'auto' -or $mode -eq 'uia') {
        if ($hasPoint) {
          $h = [DshInput]::WindowAt([int]$req.x, [int]$req.y)
          if ($h -ne [IntPtr]::Zero -and ([DshInput]::WindowClass($h) -match 'EDIT|Edit|TextBox')) {
            $cur = [DshInput]::GetWindowText($h)
            $want = if ($replace) { $text } else { $cur + $text }
            [DshInput]::SetTextMessage($h, $want) | Out-Null
            Start-Sleep -Milliseconds 50
            $now = [DshInput]::GetWindowText($h)
            if ($now -eq $want) {
              Show-StateAt 'text' ([int]$req.x) ([int]$req.y)
              return @{ ok = $true; via = 'wm_settext'; hwnd = [long]$h; verified = $true; note = '直接写入 Edit 控件，未移动光标、未抢焦点' }
            }
          }
        }
        $h = [DshInput]::GetFocusWindow()
        [DshInput]::PostText($h, $text)
        if ($hasPoint) { Show-StateAt 'text' ([int]$req.x) ([int]$req.y) } else { $script:cursorStyle = 'text'; [DshOverlay]::SetStyle('text') }
        return @{ ok = $true; via = 'message'; hwnd = [long]$h; verified = $false; note = 'WM_CHAR 已投递，请截图确认' }
      }

      if ($mode -eq 'physical') {
        $hwnd = [IntPtr]::Zero
        if ($null -ne $req.hwnd) { $hwnd = [IntPtr][long]$req.hwnd }
        $prev = [IntPtr]::Zero
        if ($hwnd -ne [IntPtr]::Zero) { $prev = [DshInput]::FocusWindow($hwnd) }
        try {
          [DshInput]::PhysicalText($text)
        } finally {
          if ($prev -ne [IntPtr]::Zero) { [DshInput]::FocusWindow($prev) | Out-Null }
        }
        if ($hasPoint) { Restore-AiCursor } else { $script:cursorStyle = 'text'; [DshOverlay]::SetStyle('text') }
        return @{ ok = $true; via = 'physical'; note = '物理键盘输入完成' }
      }

      if ($hasPoint) { Show-StateAt 'help' ([int]$req.x) ([int]$req.y) } else { $script:cursorStyle = 'help'; [DshOverlay]::SetStyle('help') }
      return @{ ok = $false; reason = 'no-route' }
    }
    'key' {
      $mode = if ($req.mode) { [string]$req.mode } else { 'auto' }
      $paused = Get-PausedResult
      if ($null -ne $paused) { return $paused }
      $raw = [string]$req.keys
      if ([string]::IsNullOrWhiteSpace($raw)) { return @{ ok = $false; reason = 'keys required' } }
      $names = $raw -split '\+'
      $vks = @()
      foreach ($n in $names) { $vks += (Get-Vk $n) }

      # 2026-11-08：auto 不再直接物理按键（那是主人的键盘）。先投消息；
      # 目标不响应就显式传 mode:"physical"，由调用方决定，不替她按。
      if ($mode -eq 'message' -or $mode -eq 'auto') {
        $h = [IntPtr]::Zero
        if ($null -ne $req.hwnd) { $h = [IntPtr][long]$req.hwnd }
        if ($h -eq [IntPtr]::Zero) { $h = [DshInput]::GetFocusWindow() }
        $postErr = $null
        try {
          foreach ($vk in $vks) { [DshInput]::PostKey($h, [int]$vk, $true, $false, $false) }
          $rel = @($vks)
          [Array]::Reverse($rel)
          foreach ($vk in $rel) { [DshInput]::PostKey($h, [int]$vk, $false, $false, $false) }
        } catch {
          $postErr = $_.Exception.Message
        }
        if ($null -eq $postErr) {
          $script:cursorStyle = 'text'
          [DshOverlay]::SetStyle('text')
          return @{ ok = $true; via = 'message'; hwnd = [long]$h; keys = $raw; verified = $false; note = '按键消息已投递（没碰物理键盘）；目标不响应就显式传 mode:"physical"' }
        }
        if ($mode -eq 'message') {
          return @{ ok = $false; reason = 'post-failed'; target = [long]$h; note = ('窗口消息投递失败：' + $postErr) }
        }
        # auto：窗口消息投不进去，才落到下面的物理分支。返回的 via 会写 physical，
        # 不把「物理按的」说成「消息投的」。
      }

      $hwnd = [IntPtr]::Zero
      if ($null -ne $req.hwnd) { $hwnd = [IntPtr][long]$req.hwnd }
      $prev = [IntPtr]::Zero
      if ($hwnd -ne [IntPtr]::Zero) { $prev = [DshInput]::FocusWindow($hwnd) }
      try {
        [DshInput]::PhysicalKeySequence([uint16[]]$vks)
      } finally {
        if ($prev -ne [IntPtr]::Zero) { [DshInput]::FocusWindow($prev) | Out-Null }
      }
      $script:cursorStyle = 'text'
      [DshOverlay]::SetStyle('text')
      Restore-AiCursor
      return @{ ok = $true; via = 'physical'; keys = $raw; note = '物理按键完成（窗口消息投不进去才走的这条）' }
    }
    'scroll' {
      $x = [int]$req.x
      $y = [int]$req.y
      $delta = if ($req.delta) { [int]$req.delta } else { -120 }
      $mode = if ($req.mode) { [string]$req.mode } else { 'auto' }
      $paused = Get-PausedResult
      if ($null -ne $paused) { return $paused }
      [DshOverlay]::Hide()

      if ($mode -eq 'uia' -or $mode -eq 'auto') {
        $r = Invoke-UiaScroll $x $y $delta
        if ($r.ok) { Show-StateAt 'vert' $x $y; return $r }
      }
      if ($mode -eq 'message' -or $mode -eq 'auto' -or $mode -eq 'uia') {
        $h = [DshInput]::WindowAt($x, $y)
        if ($h -ne [IntPtr]::Zero) {
          [DshInput]::PostMouseScroll($h, $x, $y, $delta)
          Show-StateAt 'vert' $x $y
          return @{ ok = $true; via = 'message'; hwnd = [long]$h; delta = $delta; verified = $false; note = '滚轮消息已投递，请截图确认' }
        }
        if ($mode -eq 'message') { return @{ ok = $false; reason = 'no-window' } }
      }
      if ($mode -eq 'physical') {
        [DshInput]::PhysicalScroll($x, $y, $delta)
        Restore-AiCursor
        return @{ ok = $true; via = 'physical'; delta = $delta; note = '物理滚轮完成，光标已还原' }
      }
      Show-StateAt 'help' $x $y
      return @{ ok = $false; reason = 'no-route'; needsPhysical = $true }
    }
    'drag' {
      $x1 = [int]$req.x
      $y1 = [int]$req.y
      $x2 = [int]$req.toX
      $y2 = [int]$req.toY
      $mode = if ($req.mode) { [string]$req.mode } else { 'auto' }
      $duration = if ($req.durationMs) { [int]$req.durationMs } else { 400 }
      $hold = if ($null -ne $req.holdMs) { [int]$req.holdMs } else { 0 }
      $dx = $x2 - $x1
      $dy = $y2 - $y1
      $dragState = if ([Math]::Abs($dx) -gt [Math]::Abs($dy) * 1.6) { 'horz' }
                   elseif ([Math]::Abs($dy) -gt [Math]::Abs($dx) * 1.6) { 'vert' }
                   elseif ($dx * $dy -gt 0) { 'dgn1' }
                   elseif ($dx * $dy -lt 0) { 'dgn2' }
                   else { 'move' }
      $paused = Get-PausedResult
      if ($null -ne $paused) { return $paused }
      [DshOverlay]::Hide()

      if ($mode -eq 'message' -or $mode -eq 'auto' -or $mode -eq 'uia') {
        $h = [DshInput]::WindowAt($x1, $y1)
        if ($h -ne [IntPtr]::Zero) {
          [DshInput]::PostMouseDrag($h, $x1, $y1, $x2, $y2, [Math]::Max(8, [int]($duration / 20)))
          Show-StateAt $dragState $x2 $y2
          return @{ ok = $true; via = 'message'; hwnd = [long]$h; verified = $false; note = '拖拽消息已投递，请截图确认' }
        }
        if ($mode -eq 'message') { return @{ ok = $false; reason = 'no-window' } }
      }
      if ($mode -eq 'physical') {
        [DshInput]::PhysicalDrag($x1, $y1, $x2, $y2, $duration, $hold)
        Restore-AiCursor
        return @{ ok = $true; via = 'physical'; hold = $hold; duration = $duration; note = '物理拖拽完成，光标已还原' }
      }
      Show-StateAt 'help' $x2 $y2
      return @{ ok = $false; reason = 'no-route'; needsPhysical = $true }
    }
    'capture' {
      $path = [string]$req.path
      if ([string]::IsNullOrWhiteSpace($path)) { throw 'path required' }
      $wasVisible = [DshOverlay]::VisibleNow()
      if ($wasVisible) { [DshOverlay]::Hide() }
      try {
        $dir = [System.IO.Path]::GetDirectoryName($path)
        if (-not [string]::IsNullOrWhiteSpace($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
        if ($req.rect) {
          $parts = ([string]$req.rect) -split ','
          $x = [int]$parts[0]; $y = [int]$parts[1]; $w = [int]$parts[2]; $h = [int]$parts[3]
          [DshInput]::CapturePng($path, $x, $y, $w, $h) | Out-Null
        } else {
          [DshInput]::CapturePng($path, 0, 0, 0, 0) | Out-Null
        }
      } finally {
        if ($wasVisible -and [DshOverlay]::HasLast) {
          [DshOverlay]::ShowAt([DshOverlay]::LastX, [DshOverlay]::LastY)
        }
      }
      return @{ ok = $true; path = $path }
    }
    'overlayShot' {
      $path = [string]$req.path
      if ([string]::IsNullOrWhiteSpace($path)) { throw 'path required' }
      $dir = [System.IO.Path]::GetDirectoryName($path)
      if (-not [string]::IsNullOrWhiteSpace($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
      $s = 0
      if ($null -ne $req.size) { $s = [int]$req.size }
      if ($s -le 0) { $s = $script:cursorSize }
      [DshInput]::CapturePng($path, [DshOverlay]::LastX, [DshOverlay]::LastY, $s, $s) | Out-Null
      return @{ ok = $true; path = $path; x = [DshOverlay]::LastX; y = [DshOverlay]::LastY; size = $s }
    }
    'webserve' {
      # 开/关网页取文的接收端（浏览器扩展 POST 到这里）
      $on = $true
      if ($null -ne $req.on) { $on = [bool]$req.on }
      $port = 47322
      if ($null -ne $req.port) { $port = [int]$req.port }
      if ($on) { [DshWebPick]::Start($port) } else { [DshWebPick]::Stop() }
      return @{ ok = $true; running = $on; port = $port; received = [DshWebPick]::Count; lastError = [DshWebPick]::LastError }
    }
    'card' {
      # 能追问的小卡片（2026-11-09）。op = open / append / busy / collapse / close / state
      $op = 'open'
      if ($req.op) { $op = [string]$req.op }
      switch ($op) {
        'open' {
          $title = ''
          if ($req.title) { $title = [string]$req.title }
          $x = 0; $y = 0
          if ($null -ne $req.x) { $x = [int]$req.x }
          if ($null -ne $req.y) { $y = [int]$req.y }
          if ($x -eq 0 -and $y -eq 0) {
            $c = [DshInput]::CursorPos()
            $x = [int]$c[0] + 60
            $y = [int]$c[1]
          }
          $ok = [DshCard]::Open($title, $x, $y)
          return @{ ok = $ok; open = [DshCard]::IsOpen; bounds = [DshCard]::BoundsText }
        }
        'append' {
          $t = ''
          if ($null -ne $req.text) { $t = [string]$req.text }
          $ok = [DshCard]::Append($t)
          return @{ ok = $ok; open = [DshCard]::IsOpen; lines = [DshCard]::Lines }
        }
        'busy' {
          $on = $true
          if ($null -ne $req.on) { $on = [bool]$req.on }
          $ok = [DshCard]::SetBusy($on)
          return @{ ok = $ok; open = [DshCard]::IsOpen; busy = [DshCard]::IsBusy; bounds = [DshCard]::BoundsText }
        }
        'collapse' {
          $on = $true
          if ($null -ne $req.on) { $on = [bool]$req.on }
          $ok = [DshCard]::Collapse($on)
          return @{ ok = $ok; open = [DshCard]::IsOpen; collapsed = [DshCard]::IsCollapsed; bounds = [DshCard]::BoundsText }
        }
        'follow' {
          $on = $true
          if ($null -ne $req.on) { $on = [bool]$req.on }
          [DshCard]::Follow = $on
          return @{ ok = [DshCard]::IsOpen; follow = [DshCard]::Follow; bounds = [DshCard]::BoundsText }
        }
        'close' {
          [DshCard]::Close() | Out-Null
          return @{ ok = $true; open = [DshCard]::IsOpen }
        }
        'state' {
          return @{
            ok = $true
            open = [DshCard]::IsOpen
            busy = [DshCard]::IsBusy
            collapsed = [DshCard]::IsCollapsed
            lines = [DshCard]::Lines
            bounds = [DshCard]::BoundsText
          }
        }
        default { throw "unknown card op: $op" }
      }
    }
    'pickrect' {
      # 只算不画：给一个屏幕点，问「该框哪块」。测试和排障都走这条。
      $x = 0; $y = 0; $level = 0
      if ($null -ne $req.x) { $x = [int]$req.x }
      if ($null -ne $req.y) { $y = [int]$req.y }
      if ($null -ne $req.level) { $level = [int]$req.level }
      $b = [DshPick]::BlockAt($x, $y, $level)
      return @{
        ok = $true
        rect = "$($b.X),$($b.Y),$($b.W),$($b.H)"
        name = $b.Name
        type = $b.Type
        fallback = $b.Fallback
        level = $b.Level
        levels = $b.Levels
      }
    }
    'pick' {
      [DshCard]::Suspend()
      # 指一下：悬停取块、回车确认、[ ] 收放、Esc 取消。
      $op = 'start'
      if ($req.op) { $op = [string]$req.op }
      switch ($op) {
        'start' {
          $ms = 30000
          if ($null -ne $req.timeoutMs) { $ms = [int]$req.timeoutMs }
          $started = [DshPick]::Start($ms)
          return @{ ok = $true; started = $started; busy = [DshPick]::Busy; timeoutMs = $ms }
        }
        'stop' {
          [DshPick]::Stop()
          return @{ ok = $true; busy = [DshPick]::Busy }
        }
        'state' {
          return @{ ok = $true; busy = [DshPick]::Busy; last = [DshPick]::Describe() }
        }
        default { throw "unknown pick op: $op" }
      }
    }
    'uiainfo' {
      # 2026-11-09：框到的是界面元素时，比 OCR 更准——名字、类型、类名都拿得到。
      if (-not $script:uia) { return @{ ok = $false; reason = 'no-uia' } }
      $x = 0; $y = 0
      if ($null -ne $req.x) { $x = [int]$req.x }
      if ($null -ne $req.y) { $y = [int]$req.y }
      $el = Get-UiaElementAt $x $y
      if ($null -eq $el) { return @{ ok = $false; reason = 'no-element' } }
      $c = $el.Current
      $type = ''
      try { $type = [string]$c.ControlType.ProgrammaticName } catch { }
      $val = ''
      try {
        $p = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $val = [string]$p.Current.Value }
      } catch { }
      return @{
        ok = $true
        name = [string]$c.Name
        type = $type
        className = [string]$c.ClassName
        enabled = [bool]$c.IsEnabled
        value = $val
      }
    }
    'guard' {
      # 2026-11-09：框到密码框 / 登录支付这类窗口，就不读——读出来会交给模型。
      $x = 0; $y = 0
      if ($null -ne $req.x) { $x = [int]$req.x }
      if ($null -ne $req.y) { $y = [int]$req.y }
      $fg = [long][DshInput]::GetForegroundWindow()
      $title = ''
      $cls = ''
      try { $title = [DshInput]::GetWindowText([IntPtr]$fg) } catch { }
      try { $cls = [DshInput]::GetClassName([IntPtr]$fg) } catch { }
      $el = $null
      if ($script:uia) { $el = Get-UiaElementAt $x $y }
      $isPwd = $false
      if ($null -ne $el) { try { $isPwd = [bool]$el.Current.IsPassword } catch { } }
      $hit = $false
      $kw = @('password', 'log in', 'sign in', 'checkout', '密码', '登录', '登陆', '网银', '支付', '验证码', '银行卡', '身份验证')
      if (-not [string]::IsNullOrWhiteSpace($title)) {
        $low = $title.ToLowerInvariant()
        foreach ($k in $kw) { if ($low.Contains($k)) { $hit = $true; break } }
      }
      $elevated = $false
      try { $elevated = [DshSec]::ForegroundElevated() } catch { }
      $reason = ''
      if ($isPwd) { $reason = 'password' }
      elseif ($hit) { $reason = 'sensitive-title' }
      elseif ($elevated) { $reason = 'elevated' }
      return @{
        ok = $true
        blocked = [bool]($reason -ne '')
        reason = $reason
        title = $title
        className = $cls
        hasElement = ($null -ne $el)
        elevated = $elevated
      }
    }
    'select' {
      [DshCard]::Suspend()
      $ms = 20000
      if ($null -ne $req.timeoutMs) { $ms = [int]$req.timeoutMs }
      if ([DshSelect]::Busy) { return @{ ok = $true; started = $false; reason = 'busy' } }
      [DshSelect]::Start($ms)
      return @{ ok = $true; started = $true; timeoutMs = $ms }
    }
    'menustate' {
      if ($req.answer) { [DshOverlay]::AnswerMode = [string]$req.answer }
      return @{ ok = $true; answer = [DshOverlay]::AnswerMode }
    }
    'shake' {
      $on = $true
      if ($null -ne $req.on) { $on = [bool]$req.on }
      $lvl = 'medium'
      if ($req.level) { $lvl = [string]$req.level }
      [DshShake]::Configure($on, $lvl)
      return @{ ok = $true; enabled = [DshShake]::Enabled; fired = [DshShake]::Fired; level = $lvl }
    }
    'shutdown' {
      [DshOverlay]::Stop()
      [DshInput]::StopHooks()
      [DshInput]::StopHotkey()
      return @{ ok = $true }
    }
    default { throw "unknown command: $cmd" }
  }
}

# ---------------------------------------------------------------- main

$assetDir = Join-Path $PSScriptRoot 'assets\cursors'
try {
  [DshOverlay]::ConfigureStyles($assetDir)
  [DshOverlay]::SetStyle($script:cursorStyle)
  [DshOverlay]::SetMode($script:cursorMode, $script:cursorHoldMs)
  [DshOverlay]::SetSize($script:cursorSize)
} catch { }

[DshInput]::StartHotkey()
# 网页取文的接收端：默认开（只绑 127.0.0.1）
[DshWebPick]::Start(47322)
# 晃一下鼠标：默认开（她要试）。自己动光标的命令期间挂起，见主循环。
[DshShake]::Configure($true, 'medium')

# 这些命令是「我们自己动光标」，执行期间不许触发晃动检测
$selfDriveCmds = @('click', 'doubleclick', 'drag', 'type', 'key', 'scroll', 'move', 'overlay', 'capture', 'overlayShot', 'probe', 'calscan')

$ready = @{
  event = 'ready'
  pid = $PID
  uia = $script:uia
  hotkey = 'Ctrl+Alt+Q'
  version = '0.4.0'
  shake = [DshShake]::Enabled
}
[DshOverlay]::EmitLine((ConvertTo-Json $ready -Compress))

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $selfDrive = $selfDriveCmds -contains [string]$req.cmd
    if ($selfDrive) { [DshShake]::SetSelfDriving($true) }
    try { $result = Invoke-Request $req }
    finally { if ($selfDrive) { [DshShake]::SetSelfDriving($false) } }
    if ($result -is [hashtable]) {
      $result['cursorState'] = if ([DshInput]::Paused) { 'unavailiable' } else { $script:cursorStyle }
    }
    $resp = @{ id = $id; ok = $true; result = $result }
  } catch {
    $resp = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [DshOverlay]::EmitLine((ConvertTo-Json $resp -Compress -Depth 16))
  if ($req.cmd -eq 'shutdown') { break }
}


