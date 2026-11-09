// 2026-11-09：框选还没结束时，别因为「又开了一次卡片」把它展开。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../sidecar.ps1', import.meta.url)
const raw = readFileSync(file, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw

const old = '                if (card != null && !card.IsDisposed && card.Visible)\n                {\n                    card.SetCollapsed(false);\n                    card.Activate();\n                    return;\n                }'
if (!s.includes(old)) throw new Error('没找到已开卡的分支')
s = s.replace(old, '                if (card != null && !card.IsDisposed && card.Visible)\n                {\n                    // 框选/指认期间保持收着：等她选完再展开。\n                    if (!suspended) card.SetCollapsed(false);\n                    card.Activate();\n                    return;\n                }')

copyFileSync(file, new URL('../backup/sidecar.ps1.20261109-open-guard.bak', import.meta.url))
writeFileSync(file, crlf ? s.split('\n').join('\r\n') : s)
console.log('开卡时不再顶着框选展开')
