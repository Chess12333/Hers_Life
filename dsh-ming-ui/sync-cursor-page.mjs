// sync-cursor-page.mjs —— 把共享光标页注入两个插件（单源，别手改副本）
//
// 源：C:/dsh/dsh-ming-ui/src/cursor-page.js
// 目标：dsh-ming-mousepet/client.js 的标记区之间（2026-11-10 起只此一处）。
// 跑法：node C:/dsh/dsh-ming-ui/sync-cursor-page.mjs [--check]
//   --check 只比对不写，有漂移就 exit 1（可以挂进构建门口）。
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'C:/dsh/dsh-ming-ui/src/cursor-page.js'
const TARGETS = ['C:/dsh/dsh-ming-mousepet/client.js'] // 2026-11-10：轻量版已并入完整版，cursor 仓库退役
const OPEN = '    // >>> 共享光标页'
const CLOSE = '    // <<< 共享光标页'

const check = process.argv.includes('--check')

const src = readFileSync(SRC, 'utf8')
// 顶层函数缩进进 factory（4 空格），并去掉文件头注释块
const body = src
  .replace(/^\/\/[\s\S]*?\n(?=function makeCursorPage)/, '')
  .split('\n')
  .map((l) => (l.trim() ? '    ' + l : l))
  .join('\n')
  .replace(/\s+$/, '')

let drift = 0
for (const file of TARGETS) {
  const text = readFileSync(file, 'utf8')
  const i = text.indexOf(OPEN)
  const j = text.indexOf(CLOSE)
  if (i < 0 || j < 0 || j < i) { console.error('✗ 找不到标记区：' + file); drift++; continue }
  const head = text.slice(0, text.indexOf('\n', i) + 1)
  const tail = text.slice(j)
  const next = head + body + '\n' + tail
  if (next === text) { console.log('  = ' + file + '（已同步）'); continue }
  if (check) { console.log('  ✗ ' + file + ' 有漂移'); drift++; continue }
  writeFileSync(file, next, 'utf8')
  console.log('  ✓ ' + file + ' 已注入 ' + body.split('\n').length + ' 行')
}
if (check && drift) { console.error('有 ' + drift + ' 处漂移（跑一次不带 --check 的）'); process.exit(1) }
console.log(check ? '★ 两份副本与源一致' : '★ 同步完成')
