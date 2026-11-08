// 2026-11-08 14:47 补丁十一：气泡避让改成「先往上、再往左右」，别压光标也别压桌宠。
// 上一版遇到光标就整体挪到右下，结果压在桌宠身上。现在按候选位置挑第一个两边都不压的。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../sidecar.ps1', import.meta.url))
const dry = process.argv.includes('--dry')
let raw = readFileSync(FILE, 'utf8')
const bom = raw.charCodeAt(0) === 0xfeff
if (bom) raw = raw.slice(1)
const crlf = raw.includes('\r\n')
let s = crlf ? raw.replace(/\r\n/g, '\n') : raw
const problems = []
function rep(label, from, to) {
  const c = s.split(from).length - 1
  if (c !== 1) { problems.push(`${label}: 匹配 ${c} 次`); return }
  s = s.replace(from, to)
}

rep(
  '避让改成多候选',
  `            Point cp0 = Cursor.Position;
            Rectangle hot = new Rectangle(cp0.X - 2, cp0.Y - 2, 30, 36);
            if (new Rectangle(px, py, sz.Width, sz.Height).IntersectsWith(hot))
            {
                px = cp0.X + 34;
                py = cp0.Y + 36;
            }`,
  `            Point cp0 = Cursor.Position;
            Rectangle hot = new Rectangle(cp0.X - 2, cp0.Y - 2, 30, 36);
            Rectangle pet = new Rectangle(x - 4, y - 4, 72, 72);
            Rectangle me0 = new Rectangle(px, py, sz.Width, sz.Height);
            if (me0.IntersectsWith(hot) || me0.IntersectsWith(pet))
            {
                // 2026-11-08 她：「避开你和桌宠两边」。按顺序试几个候选，
                // 第一个两边都不压的胜出；全都不行才退到光标右下角。
                Point[] cand = new Point[] {
                    new Point(x + 64, y - sz.Height - 12),          // 桌宠右上
                    new Point(x - sz.Width - 12, y - sz.Height - 12), // 桌宠左上
                    new Point(x + 64, y + 4),                       // 桌宠正右
                    new Point(x - sz.Width - 12, y + 4),            // 桌宠正左
                    new Point(x - sz.Width / 2, y - sz.Height - 90)  // 再往上抬一层
                };
                bool placed = false;
                for (int i = 0; i < cand.Length; i++)
                {
                    Rectangle r = new Rectangle(cand[i].X, cand[i].Y, sz.Width, sz.Height);
                    if (!r.IntersectsWith(hot) && !r.IntersectsWith(pet))
                    {
                        px = cand[i].X;
                        py = cand[i].Y;
                        placed = true;
                        break;
                    }
                }
                if (!placed)
                {
                    px = cp0.X + 34;
                    py = cp0.Y + 36;
                }
            }`,
)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
if (dry) { console.log('dry：能匹配'); process.exit(0) }
const out = crlf ? s.replace(/\n/g, '\r\n') : s
writeFileSync(FILE, (bom ? '\uFEFF' : '') + out, 'utf8')
console.log('写好（BOM 保留，CRLF ' + crlf + '）')
