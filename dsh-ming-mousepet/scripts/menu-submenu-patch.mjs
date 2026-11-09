// 2026-11-09 21:1x：右键菜单里的「晃动检测」改成二级栏：
//   晃动检测 ▸ 开 / 关
//              简易回答（气泡） / 完整回答（卡片）
// 回答档由一个全局字段存着，改了给 JS 抛一条 menu 事件；JS 记进 pet-state。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../sidecar.ps1', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw
const must = (c, w) => { if (!c) throw new Error(w) }

// 1) 状态字段
const anchor = '    public static bool locked = false;'
must(s.includes(anchor), '没找到 locked 字段')
s = s.replace(anchor, anchor + `
    // 2026-11-09 21:1x：框选/指认之后用哪一档回答。quick=气泡一句话，full=卡片完整回答。
    public static string AnswerMode = "quick";

    public static void SetAnswerMode(string mode)
    {
        string m = (mode == "full") ? "full" : "quick";
        if (m == AnswerMode) return;
        AnswerMode = m;
        try { EmitLine("{\\"event\\":\\"menu\\",\\"action\\":\\"answer\\",\\"mode\\":\\"" + m + "\\"}"); } catch { }
    }`)

// 2) 菜单：单个条目 → 二级栏
const oldItem = `                menu.Items.Add(DshShake.Enabled ? "晃动检测：开 ✓" : "晃动检测：关", null, delegate
                {
                    // 2026-11-09 她：右键就能开关，不用找我。
                    DshShake.SetEnabled(!DshShake.Enabled);
                });`
must(s.includes(oldItem), '没找到晃动检测那一条')

const newItem = `                // 2026-11-09 21:1x 她：做成二级栏——晃一下鼠标管开/关，下面再管回答走气泡还是卡片。
                ToolStripMenuItem shakeMenu = new ToolStripMenuItem(DshShake.Enabled ? "晃动检测 ✓" : "晃动检测");
                ToolStripMenuItem shakeOn = new ToolStripMenuItem("开");
                shakeOn.Checked = DshShake.Enabled;
                shakeOn.Click += delegate { DshShake.SetEnabled(true); DshOverlay.EmitLine("{\\"event\\":\\"menu\\",\\"action\\":\\"shake\\",\\"on\\":true}"); };
                ToolStripMenuItem shakeOff = new ToolStripMenuItem("关");
                shakeOff.Checked = !DshShake.Enabled;
                shakeOff.Click += delegate { DshShake.SetEnabled(false); DshOverlay.EmitLine("{\\"event\\":\\"menu\\",\\"action\\":\\"shake\\",\\"on\\":false}"); };
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
                menu.Items.Add(shakeMenu);`

s = s.replace(oldItem, newItem)

// 3) 命令：JS 启动时把存档里的档位推进来
const cmdAnchor = "    'shake' {"
must(s.includes(cmdAnchor), '没找到 shake 命令分支')
s = s.replace(cmdAnchor, `    'menustate' {
      if ($req.answer) { [DshOverlay]::AnswerMode = [string]$req.answer }
      return @{ ok = $true; answer = [DshOverlay]::AnswerMode }
    }
    'shake' {`)

copyFileSync(file, new URL('../backup/sidecar.ps1.20261109-menu-submenu.bak', import.meta.url))
writeFileSync(file, crlf ? s.split('\n').join('\r\n') : s)
console.log('右键菜单改成二级栏')
