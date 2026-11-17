// 把 src/panel.js（1459 行 / 79 KB）按页拆成 5 片 —— 2026-11-09 12:0x
//
// 切点按函数声明上方的注释块算，不按行号硬编码（下次插一行不会切错）：
//   common：文件头 + PANEL_LABEL + GraphIcon + fmtClock        （1 .. 217）
//   memory：MemoryView                                        （218 .. 444）
//   cost  ：top 栏两个入口 fmtMoney / MgPop / SkillsBody / MgCostPage / SumTokens / fmtTokens / CostBody（445 .. 617）
//   pet   ：PetPage                                            （618 .. 1039）
//   main  ：NeuronPanel（留在 src/panel.js）                    （1040 .. EOF）
//
// 硬验证：拆完把 5 片拼回去，去掉全部空白后必须与原文逐字相同。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve('.')
const SRC = path.join(ROOT, 'src/panel.js')
const lines = fs.readFileSync(SRC, 'utf8').split('\n')
const total = lines.length
console.log(`源 ${total} 行`)

const CUTS = [
  { name: 'common', from: 1, to: 217 },
  { name: 'memory', from: 218, to: 444 },
  { name: 'cost', from: 445, to: 617 },
  { name: 'pet', from: 618, to: 1039 },
  { name: 'main', from: 1040, to: total },
]

// 边界自检：这些行的开头必须对得上，否则说明源变了、切点失效
const EXPECT = {
  memory: '// 2026-11-07 19:0x：记忆 tab 改成吃**统一节点模型**',
  cost: '// ===== 2026-11-08：top 栏两个新入口 =====',
  pet: '// 桌宠整页（2026-11-08）',
  main: 'function NeuronPanel() {',
}
let bad = 0
for (const [name, want] of Object.entries(EXPECT)) {
  const cut = CUTS.find((c) => c.name === name)
  const got = (lines[cut.from - 1] || '').trim()
  if (!got.startsWith(want)) {
    console.error(`✗ ${name} 切点对不上：第 ${cut.from} 行是 ${JSON.stringify(got.slice(0, 40))}`)
    bad++
  }
}
// common 的结束边界：第 217 行（index 216）必须是空行
if ((lines[216] || '').trim() !== '') {
  console.error(`✗ common/memory 边界第 217 行不是空行：${JSON.stringify(lines[216])}`)
  bad++
}
if (bad) process.exit(1)

// 备份
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const bakDir = path.join(ROOT, 'backup', `panel-split-${stamp}`)
fs.mkdirSync(bakDir, { recursive: true })
fs.copyFileSync(SRC, path.join(bakDir, 'panel.js'))
console.log(`备份 → ${path.relative(ROOT, bakDir)}\\panel.js`)

const pieces = {}
for (const cut of CUTS) {
  pieces[cut.name] = lines.slice(cut.from - 1, cut.to).join('\n')
}

// 写：common/memory/cost/pet 进 src/panels/，main 覆盖 src/panel.js
const dir = path.join(ROOT, 'src/panels')
fs.mkdirSync(dir, { recursive: true })
for (const name of ['common', 'memory', 'cost', 'pet']) {
  const file = path.join(dir, `${name}.js`)
  fs.writeFileSync(file, pieces[name].replace(/\s+$/, '') + '\n', 'utf8')
  console.log(`写 ${path.relative(ROOT, file)}  ${pieces[name].length} 字符`)
}
fs.writeFileSync(SRC, pieces.main.replace(/^\s+/, '') + (pieces.main.endsWith('\n') ? '' : '\n'), 'utf8')
console.log(`写 src/panel.js（只剩 NeuronPanel）  ${pieces.main.length} 字符`)

// —— 硬验证：拼回去、去空白，必须与原文逐字相同 ——
const strip = (s) => s.replace(/\s+/g, '')
const original = strip(lines.join('\n'))
const rebuilt = strip(['common', 'memory', 'cost', 'pet', 'main'].map((n) => pieces[n]).join('\n'))
const same = original === rebuilt
const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
console.log(`\n原文去空白 ${original.length} 字符 sha ${h(original)}`)
console.log(`拼接去空白 ${rebuilt.length} 字符 sha ${h(rebuilt)}`)
console.log(same ? '✓ 拼回去与原文逐字相同（只有空白位置变了）' : '✗ 不一致，不能提交')
process.exit(same ? 0 : 1)
