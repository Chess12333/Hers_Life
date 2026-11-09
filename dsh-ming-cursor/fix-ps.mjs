// 把 .ps1 写回「PS 5.1 认得的」编码：UTF-8 BOM + CRLF。
//
// 为什么需要它：编辑器/工具链会悄悄把 BOM 丢掉、把 CRLF 换成 LF。
// PS 5.1 读无 BOM 的 UTF-8 会按 ANSI 解析，中文注释变乱码；
// 单引号 here-string 在纯 LF 下还会解析失败——症状是「报错指在第 30 行，
// 真正坏的地方在文件第一个字节」（2026-11-08 踩过一次，2026-11-09 又踩一次）。
//
// 用法：node fix-ps.mjs <文件...>   （不传就修 sidecar.ps1 和 kill-sidecar.ps1）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const targets = process.argv.slice(2)
if (!targets.length) targets.push('sidecar.ps1', 'kill-sidecar.ps1')

let bad = 0
for (const t of targets) {
  const p = resolve(HERE, t)
  if (!existsSync(p)) {
    console.log(`skip ${t}（不存在）`)
    continue
  }
  const buf = readFileSync(p)
  const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  // 被「把 BOM 当成 latin-1 再编码一次」写坏的那种：开头是 ï»¿
  if (text.startsWith('ï»¿')) text = text.slice(3)
  const before = { bom: hasBom, crlf: (text.match(/\r\n/g) || []).length, lf: (text.match(/\n/g) || []).length }
  const norm = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  writeFileSync(p, '\ufeff' + norm, 'utf8')
  const changed = !hasBom || before.lf !== before.crlf
  if (changed) bad += 1
  console.log(`${changed ? 'FIXED' : 'ok   '} ${t}：BOM ${hasBom ? '有' : '无'} → 有，CRLF ${before.crlf}/${before.lf} → ${norm.length}`)
}
console.log(bad ? `修了 ${bad} 个` : '都已经是 BOM + CRLF')
