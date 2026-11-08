import fs from 'node:fs';
const root='C:/dsh/dsh-ming-mousepet/';
let s=fs.readFileSync(root+'sidecar.ps1.sync-experiment-failed','utf8').replace(/\r\n/g,'\n');
function rep(a,b){if(!s.includes(a))throw Error('missing '+a.slice(0,80));s=s.replace(a,b)}
rep('        DshBubble.FollowAll();\n','');
s=s.replace(/\s*Location = new Point\((lastX, lastY|x, y|nx, ny)\);/g,'');
s=s.replaceAll('DshInput.SetWindowPos(Handle, DshInput.HWND_TOPMOST,','DshBubble.MoveTogether(Handle, DshInput.HWND_TOPMOST,');
rep('            Size = new Size(size, size);','            if (!Visible) Size = new Size(size, size);');
rep('            if (!Visible) Show();','            if (!Visible) { Bounds = new Rectangle(x, y, displaySize, displaySize); Show(); }');
const start=s.indexOf('    public static void FollowAll()');
const end=s.indexOf('    sealed class BubbleForm',start);
s=s.slice(0,start)+`    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr BeginDeferWindowPos(int count);
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
`+s.slice(end);
rep('            Rectangle wa = Screen.FromPoint(new Point(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2)).WorkingArea;',`            return FollowLocation(anchor);
        }
        public Point FollowLocation(Rectangle anchor)
        {
            Rectangle wa = Screen.FromPoint(new Point(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2)).WorkingArea;`);
const fstart=s.indexOf('        public void FollowNow()');const fend=s.indexOf('        void FadeOut()',fstart);s=s.slice(0,fstart)+s.slice(fend);
fs.writeFileSync(root+'sidecar.ps1',s.replace(/^\uFEFF?/,'\uFEFF').replace(/\n/g,'\r\n'));
console.log('Applied batch, preserved BOM/CRLF');
