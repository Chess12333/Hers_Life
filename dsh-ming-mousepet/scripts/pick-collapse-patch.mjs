// 2026-11-09 18:2x：框选/指认期间，完整模式的卡片先收成小条，选完再展开。
// 她的话：「让完整模式的对话框在框选结束后才出现」。
// 收成 32px 的 pill 而不是 Hide：内容保住，IsOpen 也还是真——只是不挡她要框的那块。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../sidecar.ps1', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw
const must = (c, w) => { if (!c) throw new Error(w) }

// 1) 静音/恢复
const anchor = '    public static bool Follow\n    {'
must(s.includes(anchor), '没找到 Follow 属性')
s = s.replace(anchor, [
  '    static bool suspended = false;',
  '',
  '    // 框选/指认期间把卡片收成小条：她要的那块屏幕先空出来。',
  '    public static void Suspend()',
  '    {',
  '        DshOverlay.Do(delegate() { try { if (IsOpen && !card.Collapsed) { card.SetCollapsed(true); suspended = true; } } catch { } });',
  '    }',
  '',
  '    public static void Resume()',
  '    {',
  '        DshOverlay.Do(delegate() { try { if (suspended) { suspended = false; if (IsOpen) card.SetCollapsed(false); } } catch { } });',
  '    }',
  '',
  '    public static bool Follow',
  '    {',
].join('\n'))

// 2) select 开始前收
const sel = "    'select' {\n      $ms = 20000"
must(s.includes(sel), '没找到 select 分支')
s = s.replace(sel, "    'select' {\n      [DshCard]::Suspend()\n      $ms = 20000")

// 3) select 结束（有结果/没结果/异常）都展开
const selDone = '                            DshOverlay.EmitLine("{\\"event\\":\\"select-done\\",\\"rect\\":\\"" + f.Result + "\\"}");'
must(s.includes(selDone), '没找到 select-done')
s = s.replace(selDone, '                            DshOverlay.EmitLine("{\\"event\\":\\"select-done\\",\\"rect\\":\\"" + f.Result + "\\"}");\n                        DshCard.Resume();')
const selNone = '                            DshOverlay.EmitLine("{\\"event\\":\\"select-none\\",\\"why\\":\\"d" + f.Downs + ",m" + f.Moves + ",u" + f.Ups + "\\"}");'
must(s.includes(selNone), '没找到 select-none')
s = s.replace(selNone, selNone + '\n                        DshCard.Resume();')
const selErr = '                    DshOverlay.EmitLine("{\\"event\\":\\"select-none\\",\\"why\\":\\"" + ex.Message.Replace("\\"", "\'") + "\\"}");'
must(s.includes(selErr), '没找到 select 异常兜底')
s = s.replace(selErr, selErr + '\n                    DshCard.Resume();')

// 4) pick 开始收、结束展
const pickStart = "    'pick' {"
must(s.includes(pickStart), '没找到 pick 命令分支')
s = s.replace(pickStart, "    'pick' {\n      [DshCard]::Suspend()")

const pickEmit = '            form = null;\n            try { Hide(); } catch { }\n            try { Close(); } catch { }'
must(s.includes(pickEmit), '没找到 pick 收尾')
s = s.replace(pickEmit, '            form = null;\n            try { Hide(); } catch { }\n            try { Close(); } catch { }\n            DshCard.Resume();')

copyFileSync(file, new URL('../backup/sidecar.ps1.20261109-pick-collapse.bak', import.meta.url))
writeFileSync(file, crlf ? s.split('\n').join('\r\n') : s)
console.log('sidecar 改完：框选期间卡片收成小条')
