// 2026-11-09 17:2x：卡片跟着桌宠走（CRLF 安全版）。
// 气泡本来就拿 DshOverlay 的锚点算位置；卡片原来只在开的时候算一次，之后钉死。
// 这里给它同一套锚点 + 一个 250ms 计时器；她手动拖标题栏就停止跟随。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../sidecar.ps1', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw

const must = (cond, why) => { if (!cond) throw new Error(why) }

const a0 = '        bool drag = false;\n        Point dragAt;'
must(s.includes(a0), '没找到 drag 字段')
s = s.replace(a0, [
  '        bool drag = false;',
  '        Point dragAt;',
  '        bool follow = true;',
  '        readonly System.Windows.Forms.Timer followTimer;',
].join('\n'))

const b0 = 'head.MouseDown += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) { drag = true; dragAt = e.Location; } };'
must(s.includes(b0), '没找到标题栏按下')
s = s.replace(b0, 'head.MouseDown += delegate(object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) { drag = true; dragAt = e.Location; follow = false; } };')

const c0 = '            Location = new Point(px, py);\n\n            Show();'
must(s.includes(c0), '没找到开窗定位')
s = s.replace(c0, [
  '            Location = new Point(px, py);',
  '',
  '            // 2026-11-09 17:2x：跟着桌宠走，锚点和气泡是同一个（DshOverlay 的框）。',
  '            // 她自己拖一下标题栏，follow 就关掉——手动放的位置比自动的更算数。',
  '            followTimer = new System.Windows.Forms.Timer();',
  '            followTimer.Interval = 250;',
  '            followTimer.Tick += delegate { if (!follow || collapsed || !Visible) return; FollowTick(); };',
  '',
  '            Show();',
  '            followTimer.Start();',
  '            FollowTick();',
].join('\n'))

const d0 = '        public void SetCollapsed(bool on)'
must(s.includes(d0), '没找到 SetCollapsed')
s = s.replace(d0, [
  '        public bool Follow { get { return follow; } set { follow = value; if (value) FollowTick(); } }',
  '',
  '        public void FollowTick()',
  '        {',
  '            Rectangle anchor;',
  '            if (!DshOverlay.TryGetBounds(out anchor)) return;',
  '            Rectangle wa = Screen.FromPoint(new Point(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2)).WorkingArea;',
  '            Point want = CardLocation(anchor, Size, wa);',
  '            if (Location != want) Location = want;',
  '        }',
  '',
  '        static Point CardLocation(Rectangle anchor, Size size, Rectangle wa)',
  '        {',
  '            // 先在桌宠右上方；右边放不下就翻到左边，上面放不下就落到底下。',
  '            int x = anchor.Right + 10;',
  '            if (x + size.Width > wa.Right) x = anchor.Left - 10 - size.Width;',
  '            int y = anchor.Top - size.Height - 10;',
  '            if (y < wa.Top) y = anchor.Bottom + 10;',
  '            if (x < wa.Left + 8) x = wa.Left + 8;',
  '            if (x + size.Width > wa.Right - 8) x = wa.Right - size.Width - 8;',
  '            if (y < wa.Top + 8) y = wa.Top + 8;',
  '            if (y + size.Height > wa.Bottom - 8) y = wa.Bottom - size.Height - 8;',
  '            return new Point(x, y);',
  '        }',
  '',
  '        public void SetCollapsed(bool on)',
].join('\n'))

const e0 = '        protected override void OnFormClosed(FormClosedEventArgs e)\n        {\n            DshOverlay.EmitLine("{\\"event\\":\\"card-closed\\"}");'
must(s.includes(e0), '没找到 OnFormClosed')
s = s.replace(e0, '        protected override void OnFormClosed(FormClosedEventArgs e)\n        {\n            try { followTimer.Stop(); followTimer.Dispose(); } catch { }\n            DshOverlay.EmitLine("{\\"event\\":\\"card-closed\\"}");')

const f0 = '    public static bool IsBusy { get { try { return IsOpen && card.Busy; } catch { return false; } } }'
must(s.includes(f0), '没找到 IsBusy')
s = s.replace(f0, f0 + '\n    public static bool Follow\n    {\n        get { try { return IsOpen && card.Follow; } catch { return false; } }\n        set { try { if (IsOpen) card.Follow = value; } catch { } }\n    }')

const g0 = "        'close' {\n          [DshCard]::Close() | Out-Null"
must(s.includes(g0), '没找到 close 分支')
s = s.replace(g0, [
  "        'follow' {",
  '          $on = $true',
  '          if ($null -ne $req.on) { $on = [bool]$req.on }',
  '          [DshCard]::Follow = $on',
  '          return @{ ok = [DshCard]::IsOpen; follow = [DshCard]::Follow; bounds = [DshCard]::BoundsText }',
  '        }',
  "        'close' {",
  '          [DshCard]::Close() | Out-Null',
].join('\n'))

copyFileSync(file, new URL('../backup/sidecar.ps1.20261109-card-follow.bak', import.meta.url))
writeFileSync(file, crlf ? s.split('\n').join('\r\n') : s)
console.log('sidecar 改完：卡片跟随')
