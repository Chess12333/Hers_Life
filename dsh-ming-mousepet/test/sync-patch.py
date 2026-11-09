from pathlib import Path
p=Path('C:/dsh/dsh-ming-mousepet/sidecar.ps1')
s=p.read_text(encoding='utf-8-sig')
s=s.replace('    static Thread thread = null;', '    public static void OnUi(Action action)\n    {\n        Start();\n        form.BeginInvoke(action);\n    }\n    static Thread thread = null;',1)
s=s.replace('            LastX = r.Left; LastY = r.Top; HasLast = true;\n        }','            LastX = r.Left; LastY = r.Top; HasLast = true;\n        }\n        DshBubble.FollowAll();',1)
a=s.index('        System.Threading.Thread th =',s.index('public static class DshBubble'))
b=s.index('        Trace("say start',a)
s=s[:a]+'''        DshOverlay.OnUi(delegate()
        {
            try { new BubbleForm(text, x, y, ms); }
            catch (Exception e) { Trace("ERR " + e.ToString()); }
        });
'''+s[b:]
s=s.replace('    sealed class BubbleForm : Form','''    static readonly List<BubbleForm> active = new List<BubbleForm>();
    public static void FollowAll()
    {
        // Called synchronously after cursor movement, on the same STA.
        foreach (BubbleForm f in active.ToArray()) f.FollowNow();
    }
    sealed class BubbleForm : Form''',1)
s=s.replace('        readonly System.Windows.Forms.Timer follow;\n','',1)
a=s.index('            follow = new System.Windows.Forms.Timer();')
b=s.index('\n        void FadeOut()',a)
s=s[:a]+'''            active.Add(this);
            FormClosed += delegate { active.Remove(this); life.Stop(); life.Dispose(); font.Dispose(); };
        }

        public void FollowNow()
        {
            if (!Visible || IsDisposed) return;
            Point next = FollowLocation();
            if (next != Location) SetWindowPos(Handle, HWND_TOPMOST, next.X, next.Y, Width, Height, SWP_NOACTIVATE);
        }
'''+s[b:]
p.write_bytes(b'\xef\xbb\xbf'+s.replace('\r\n','\n').replace('\n','\r\n').encode())
