// 2026-11-09 18:36：DshOverlay.Do 需要 (action, timeoutMs) 两个参数。补上。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../sidecar.ps1', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw

const a = '        DshOverlay.Do(delegate() { try { if (IsOpen && !card.Collapsed) { card.SetCollapsed(true); suspended = true; } } catch { } });'
const b = '        DshOverlay.Do(delegate() { try { if (suspended) { suspended = false; if (IsOpen) card.SetCollapsed(false); } } catch { } });'
if (!s.includes(a) || !s.includes(b)) throw new Error('没找到 Suspend/Resume 里的 Do 调用')

s = s.replace(a, '        DshOverlay.Do(delegate() { try { if (IsOpen && !card.Collapsed) { card.SetCollapsed(true); suspended = true; } } catch { } }, 2000);')
s = s.replace(b, '        DshOverlay.Do(delegate() { try { if (suspended) { suspended = false; if (IsOpen) card.SetCollapsed(false); } } catch { } }, 2000);')

copyFileSync(file, new URL('../backup/sidecar.ps1.20261109-do-args.bak', import.meta.url))
writeFileSync(file, crlf ? s.split('\n').join('\r\n') : s)
console.log('Do 补上 timeout 参数')
