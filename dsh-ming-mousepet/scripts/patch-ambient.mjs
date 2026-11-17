// 把 sidecar.ps1 里的 DshAmbient 类整段换成 tmp-ambient.cs。
// 不用 shell 转义：C# 里全是引号，从文件读最稳。
import { readFileSync, writeFileSync } from 'node:fs'

const ps = 'C:/dsh/dsh-ming-mousepet/sidecar.ps1'
const csFile = 'C:/dsh/dsh-ming-mousepet/tmp-ambient.cs'

const text = readFileSync(ps, 'utf8').replace(/\r\n/g, '\n')
const cs = readFileSync(csFile, 'utf8').replace(/\r\n/g, '\n').trimEnd()

const startMark = 'public static class DshAmbient'
const start = text.indexOf(startMark)
if (start < 0) throw new Error('找不到 DshAmbient 起点')

const endMark = "\n'@"
const end = text.indexOf(endMark, start)
if (end < 0) throw new Error('找不到 DshAmbient 之后的 \'@ 结尾')

const before = text.slice(0, start)
const after = text.slice(end)
writeFileSync(ps, (before + cs + after).replace(/\n/g, '\r\n'), 'utf8')
console.log('ok: 替换了', end - start, '字符 →', cs.length, '字符')
