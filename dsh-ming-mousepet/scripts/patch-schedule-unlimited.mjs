// 2026-11-08 15:15 补丁十七：加「不限」（dailyMax = -1）+ 下拉别用白底。
import { readFileSync, writeFileSync } from 'node:fs'

const dry = process.argv.includes('--dry')
const problems = []
const L = (...x) => x.join('\n')

function load(p) {
  const raw = readFileSync(p, 'utf8')
  const bom = raw.charCodeAt(0) === 0xfeff
  const b = bom ? raw.slice(1) : raw
  const crlf = b.includes('\r\n')
  return { p, s: crlf ? b.replace(/\r\n/g, '\n') : b, bom, crlf }
}
function write(f, out) {
  if (dry) return
  const b = f.crlf ? out.replace(/\n/g, '\r\n') : out
  writeFileSync(f.p, (f.bom ? '\uFEFF' : '') + b, 'utf8')
}

// ---------------------------------------------------------------- panel.js
const pn = load('C:/dsh/dsh-ming-graph/src/panel.js')
let c = pn.s
function repc(label, from, to) {
  const n = c.split(from).length - 1
  if (n !== 1) { problems.push('panel.js ' + label + ': 匹配 ' + n + ' 次'); return }
  c = c.replace(from, to)
}

repc(
  '加「不限」按钮',
  L(
    "              h('span', { className: 'mg-pop-sub' }, '每日'),",
    "              h('input', {",
    "                className: 'mg-input', type: 'number', min: 0, max: 999, title: '一天最多说几句（0 = 不说）',",
    '                value: sched.dailyMax,',
  ),
  L(
    '              // 2026-11-08 15:15 浔：「没有聊天不上限的设置」——补一个不限开关，-1 表示不限。',
    "              h('button', {",
    "                className: 'mg-btn',",
    "                title: '不限次数 / 每天限几次',",
    "                style: sched.dailyMax < 0 ? { borderColor: '#6aa9ff', color: '#6aa9ff' } : null,",
    '                onClick: () => saveSched({ dailyMax: sched.dailyMax < 0 ? 6 : -1 }),',
    "              }, sched.dailyMax < 0 ? '不限 ✓' : '限额'),",
    "              h('span', { className: 'mg-pop-sub' }, '每日'),",
    "              h('input', {",
    "                className: 'mg-input', type: 'number', min: 0, max: 999, title: sched.dailyMax < 0 ? '现在是不限；点左边「不限 ✓」切回限额' : '一天最多说几句（0 = 不说）',",
    '                disabled: sched.dailyMax < 0,',
    '                style: sched.dailyMax < 0 ? { opacity: 0.45 } : null,',
    '                value: sched.dailyMax < 0 ? \'\' : sched.dailyMax,',
  ),
)

repc(
  '下拉不要白底',
  L(
    "              h('select', {",
    "                className: 'mg-input',",
    '                value: sched.gapMode,',
  ),
  L(
    "              h('select', {",
    "                style: { fontSize: 12, padding: '1px 2px' },",
    '                value: sched.gapMode,',
  ),
)

write(pn, c)

// ---------------------------------------------------------------- pet.js
const pet = load('C:/dsh/dsh-ming-mousepet/lib/pet.js')
let p = pet.s
function repp(label, from, to) {
  const n = p.split(from).length - 1
  if (n !== 1) { problems.push('pet.js ' + label + ': 匹配 ' + n + ' 次'); return }
  p = p.replace(from, to)
}

repp(
  '不限时跳过上限',
  '  if (context.spokenToday >= cap) {',
  '  if (cap >= 0 && context.spokenToday >= cap) {',
)

write(pet, p)

// ---------------------------------------------------------------- index.js
const ix = load('C:/dsh/dsh-ming-mousepet/index.js')
let s = ix.s
function repi(label, from, to) {
  const n = s.split(from).length - 1
  if (n !== 1) { problems.push('index.js ' + label + ': 匹配 ' + n + ' 次'); return }
  s = s.replace(from, to)
}

repi(
  'dailyMax 允许 -1',
  "          if (body?.dailyMax !== undefined) next.dailyMax = clamp(body.dailyMax, 0, 999, 6)",
  "          // -1 = 不限（2026-11-08 15:15 浔要的）\n          if (body?.dailyMax !== undefined) next.dailyMax = clamp(body.dailyMax, -1, 999, 6)",
)

write(ix, s)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
console.log(dry ? 'dry：OK' : '写好：panel.js / pet.js / index.js')
