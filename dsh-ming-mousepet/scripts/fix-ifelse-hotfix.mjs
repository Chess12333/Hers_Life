// 2026-11-09 18:35：紧急修复。上一版把 DshCard.Resume() 塞进了没有花括号的 if/else 中间，
// 结果 C# 编译不过 → sidecar 起不来 → 她的光标不见了、托盘点不动。
// 这里改成带花括号的两支，各自在分支里 Resume。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../sidecar.ps1', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw

const broken = [
  '                        if (f.Result != null)',
  '                            DshOverlay.EmitLine("{\\"event\\":\\"select-done\\",\\"rect\\":\\"" + f.Result + "\\"}");',
  '                        DshCard.Resume();',
  '                        else',
  '                            DshOverlay.EmitLine("{\\"event\\":\\"select-none\\",\\"why\\":\\"d" + f.Downs + ",m" + f.Moves + ",u" + f.Ups + "\\"}");',
  '                        DshCard.Resume();',
].join('\n')

const fixed = [
  '                        if (f.Result != null)',
  '                        {',
  '                            DshOverlay.EmitLine("{\\"event\\":\\"select-done\\",\\"rect\\":\\"" + f.Result + "\\"}");',
  '                            DshCard.Resume();',
  '                        }',
  '                        else',
  '                        {',
  '                            DshOverlay.EmitLine("{\\"event\\":\\"select-none\\",\\"why\\":\\"d" + f.Downs + ",m" + f.Moves + ",u" + f.Ups + "\\"}");',
  '                            DshCard.Resume();',
  '                        }',
].join('\n')

if (!s.includes(broken)) throw new Error('没找到那段坏掉的 if/else（可能已经修过）')
s = s.replace(broken, fixed)

copyFileSync(file, new URL('../backup/sidecar.ps1.20261109-ifelse-hotfix.bak', import.meta.url))
writeFileSync(file, crlf ? s.split('\n').join('\r\n') : s)
console.log('if/else 补上花括号，Resume 各在分支里')
