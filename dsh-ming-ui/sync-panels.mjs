#!/usr/bin/env node
/**
 * sync-panels.mjs —— 把各插件的面板渲染推给统一壳
 *
 * 为什么要有这个（2026-11-07 21:0x 建，22:2x 从一块扩到三块）：
 *   面板的渲染代码在包里有**两份**——各插件自己的 `src/panel.js`（源），
 *   和 `dsh-ming-graph/src/panels.js`（真正渲染的那份拷贝）。
 *   今晚改了七八次，每次改完界面都不动，因为改的是前一份、跑的是后一份。
 *
 * 覆盖三块（desktop / resume 只在壳里有一份、没有源，不在同步范围）：
 *   兴趣   dsh-ming-interest/src/panel.js  → graph/src/panels.js
 *   声音   dsh-ming-voice/src/panel.js     → graph/src/panels.js
 *   自己玩 dsh-ming-browse/src/panel.js    → graph/src/panels.js
 *
 * 用法：
 *   node sync-panels.mjs           # 全部从源推到壳
 *   node sync-panels.mjs --check   # 只比对，不一致退出码 1
 */
import fs from 'node:fs'

const DST = 'C:/dsh/dsh-ming-graph/src/panels.js'

// 每个单元是一段连续代码：从 from 那行起，到 to 那行前止（含该组件的辅助函数）
const UNITS = [
  { name: '兴趣', src: 'C:/dsh/dsh-ming-interest/src/panel.js', from: 'function fmtAgo(', to: 'function InterestIcon()' },
  { name: '声音', src: 'C:/dsh/dsh-ming-voice/src/panel.js', from: 'function fmtSize(', to: 'function VoiceIcon()' },
  { name: '自己玩', src: 'C:/dsh/dsh-ming-browse/src/panel.js', from: 'function BrowsePanel()', to: 'function BrowseIcon()' },
]


// 下面两份不是「待办」，是**账**：写在这儿，是为了下次问「桌宠/记忆的面板怎么没在同步表里」时，
// 一眼能看出它是有意不在这里，而不是漏了。
//
// 壳内独有：只活在 dsh-ming-graph 里的渲染代码，没有独立源。改它就直接改壳，改完 build。
const SHELL_ONLY = [
  { name: '桌宠', where: 'dsh-ming-graph/src/panel.js · PetPage' },
  { name: '接续', where: 'dsh-ming-graph/src/panels.js · ResumePanel（tab 已从 top 栏拿掉，插件照跑）' },
  { name: '桌面', where: 'dsh-ming-graph/src/panels.js · DesktopPanel（接口随 dsh-ming-desktop 停用，2026-11-08 已从 top 栏摘掉，只剩死代码）' },
]

// 独立页：自己 build 出一整份 client.js、自己注册一个图标格，不经过这个壳。
const STANDALONE = [
  { name: '记忆', src: 'C:/dsh/dsh-ming-memory/src/panel.js', where: '自己的 build.mjs → main key = ming-memory' },
  { name: '神经元/星图', src: 'C:/dsh/dsh-ming-graph/src/panel.js', where: '本壳自己的页' },
]

function cut(text, from, to, label) {
  const i = text.indexOf(from)
  if (i < 0) throw new Error(label + '：找不到起点 ' + from)
  const j = text.indexOf(to, i + from.length)
  if (j < 0) throw new Error(label + '：找不到终点 ' + to)
  return { i, j, body: text.slice(i, j) }
}

const checkOnly = process.argv.includes('--check')
let dst = fs.readFileSync(DST, 'utf8')
let drift = 0
let pushed = 0

for (const u of UNITS) {
  const src = fs.readFileSync(u.src, 'utf8')
  const a = cut(src, u.from, u.to, u.name + '/源')
  const b = cut(dst, u.from, u.to, u.name + '/壳')
  if (a.body === b.body) {
    console.log('· ' + u.name + '：一致（' + a.body.length + ' 字符）')
    continue
  }
  if (checkOnly) {
    console.log('✗ ' + u.name + '：漂移。源 ' + a.body.length + ' / 壳 ' + b.body.length)
    drift++
    continue
  }
  dst = dst.slice(0, b.i) + a.body + dst.slice(b.j)
  console.log('✓ ' + u.name + '：已推 ' + b.body.length + ' → ' + a.body.length + ' 字符')
  pushed++
}

if (checkOnly) {
  if (drift) {
    console.log('\n有 ' + drift + ' 块漂移。跑 `node sync-panels.mjs` 覆盖，再 cd ../dsh-ming-graph && node build.mjs')
    process.exit(1)
  }
  for (const u of SHELL_ONLY) console.log('· ' + u.name + '：壳内独有，不参与同步 —— ' + u.where)
  for (const u of STANDALONE) {
    const ok = fs.existsSync(u.src)
    console.log('· ' + u.name + '：独立页，不参与同步 —— ' + u.where + (ok ? '' : '（⚠ 源文件不在：' + u.src + '）'))
    if (!ok) drift++
  }
  if (drift) process.exit(1)
  console.log('\n全部一致。')
  process.exit(0)
}

if (pushed) {
  fs.writeFileSync(DST, dst, 'utf8')
  console.log('\n下一步：cd ../dsh-ming-graph && node build.mjs && node --check client.js')
} else {
  console.log('\n没有变化。')
}
