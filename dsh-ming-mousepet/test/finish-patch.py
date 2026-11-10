from pathlib import Path
p=Path('C:/dsh/dsh-ming-mousepet/sidecar.ps1')
s=p.read_text(encoding='utf-8-sig')
a=s.index('            // 2026-11-08：用光标所在那块屏，不是主屏。',s.index('public BubbleForm'))
b=s.index('            DshBubble.Trace("bubble at ',a)
s=s[:a]+'''            fallbackAnchor = new Rectangle(x, y, DshOverlay.cursorSize, DshOverlay.cursorSize);
            Point pos = FollowLocation();
            int px = pos.X, py = pos.Y;
            Location = pos;
'''+s[b:]
s=s.replace('        readonly System.Windows.Forms.Timer life;','''        readonly System.Windows.Forms.Timer life;
        readonly System.Windows.Forms.Timer follow;
        readonly Rectangle fallbackAnchor;

        Point FollowLocation()
        {
            Rectangle anchor;
            if (!DshOverlay.TryGetBounds(out anchor)) anchor = fallbackAnchor;
            Rectangle wa = Screen.FromPoint(new Point(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2)).WorkingArea;
            return DshOverlayGeometry.BubbleLocation(anchor, ClientSize, wa, Cursor.Position);
        }
''')
needle='            DshBubble.Trace("after show: vis=" + Visible + " handle=" + Handle + " topmost=" + TopMost + " setpos=" + ok);'
s=s.replace(needle,needle+'''
            follow = new System.Windows.Forms.Timer();
            follow.Interval = 16;
            follow.Tick += delegate {
                if (!Visible || IsDisposed) { follow.Stop(); return; }
                Point next = FollowLocation();
                if (next != Location) SetWindowPos(Handle, HWND_TOPMOST, next.X, next.Y, Width, Height, SWP_NOACTIVATE);
            };
            FormClosed += delegate { follow.Stop(); follow.Dispose(); life.Stop(); life.Dispose(); font.Dispose(); };
            follow.Start();''')
s=s.replace('      if ($bx -ge 0) {','      {',1)
s=s.replace('        Start-Sleep -Milliseconds ($glMs + 140)','        # Bubble follows successful actual bounds while the glide is running.')
s=s.replace('      if ($bx -ge 0 -and -not [DshOverlay]::VisibleNow()) { Show-StateAt \'pointer\' $bx $by }','      if (-not [DshOverlay]::VisibleNow()) { Show-StateAt \'pointer\' $bx $by }')
# A bare script block would not execute. Keep a simple unconditional true branch.
s=s.replace('      {\n        # 2026-11-08 浔：「是不是没有缓动」','      if ($true) {\n        # 2026-11-08 浔：「是不是没有缓动」')
p.write_text(s,encoding='utf-8-sig')
