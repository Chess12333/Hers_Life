/**
 * panel-skillcost-test.mjs —— 验 top 栏两个浮层的渲染逻辑（2026-11-08）
 *
 * 为什么单独写：面板跑在浏览器里，我要么让她刷新页面看，要么在这儿先量一遍。
 * 这一层是纯函数（拿到 data 出 React 元素），用一个假的 h 就能跑。
 *
 *   node panel-skillcost-test.mjs
 *
 * 抽的是 src/panel.js 里 fmtMoney … NeuronPanel 那一段——跟面板跑的是同一份源码，
 * 不是抄一份来测（抄一份的那种测试，只会证明抄得对）。
 */
import fs from 'node:fs'

const src = fs.readFileSync(new URL('./src/panel.js', import.meta.url), 'utf8')
const from = src.indexOf('function fmtMoney(')
const to = src.indexOf('function NeuronPanel()')
if (from < 0 || to < 0 || to <= from) { console.log('FAIL 抽不出那一段'); process.exit(1) }
const chunk = src.slice(from, to)

// 假的 h：返回可遍历的树，text 子节点直接收进来
const h = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
})
const React = { createElement: h }

const fn = new Function('h', 'React', chunk + '\nreturn { fmtMoney, SkillsBody, CostBody, MgPop }')
const { fmtMoney, SkillsBody, CostBody } = fn(h, React)

function text(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join(' ')
  return (node.children || []).map(text).join(' ')
}

let bad = 0
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++ }

// 1) 金额格式
console.log('\n[1] fmtMoney：' + [0.0032, 0.42, 12.3, 345.6, null].map((v) => fmtMoney(v)).join(' / '))
ok(fmtMoney(0.0032) === '¥0.003', '小数额保留三位（不然全显示 ¥0.00）')
ok(fmtMoney(12.3) === '¥12.3', '中额一位小数')
ok(fmtMoney(345.6) === '¥346', '大额取整')
ok(fmtMoney(null) === '—', '没数就写 —，不写 0')

// 2) skill 清单：开/关、遮罩标记、过滤、空态
const data = {
  ok: true, cwd: 'C:\\dsh\\hers_workplace', offFile: 'C:\\dsh\\hers_workplace\\skills-off.json',
  total: 3, offCount: 1,
  rows: [
    { name: 'humanizer', desc: '去 AI 味', on: true, provider: 'filesystem', source: 'user-dsh' },
    { name: 'autocad-draw', desc: '画 CAD', on: false, provider: 'filesystem', source: 'user-dsh' },
    { name: 'awake', desc: '', on: true, provider: 'ming-skill-isolate', source: 'masked' },
  ],
}
const t2 = text(SkillsBody({ data, q: '', busy: '', onQ() {}, onReload() {}, onToggle() {} }))
console.log('\n[2] 清单文本：' + t2.replace(/\s+/g, ' ').slice(0, 160))
ok(/开 2 \/ 共 3/.test(t2), '头部计数对（开 2 / 共 3）')
ok(/autocad-draw/.test(t2) && /画 CAD/.test(t2), '关着的那个也在清单上，描述没丢')
ok(/遮罩/.test(t2), 'provider=ming-skill-isolate 的那行标了「遮罩」')

// 开关按钮：关着的那行按钮文字应是「关」，开着的是「开」
const tree = SkillsBody({ data, q: '', busy: '', onQ() {}, onReload() {}, onToggle() {} })
const buttons = []
const walk = (n) => {
  if (!n || typeof n !== 'object') return
  if (Array.isArray(n)) return n.forEach(walk)
  if (n.type === 'button' && n.props && n.props.className && String(n.props.className).indexOf('mg-sw') === 0) buttons.push({ cls: n.props.className, txt: text(n) })
  ;(n.children || []).forEach(walk)
}
walk(tree)
console.log('    开关按钮：' + buttons.map((b) => b.txt + '(' + b.cls + ')').join(' , '))
ok(buttons.length === 3, '三行三个开关')
ok(buttons[0].txt === '开' && buttons[1].txt === '关', '开着的写「开」、关着的写「关」')

// 3) 过滤
const t3 = text(SkillsBody({ data, q: 'cad', busy: '', onQ() {}, onReload() {}, onToggle() {} }))
ok(/autocad-draw/.test(t3) && !/humanizer/.test(t3), '按关键词过滤只留命中的')
const t4 = text(SkillsBody({ data, q: 'zzz', busy: '', onQ() {}, onReload() {}, onToggle() {} }))
ok(/没有匹配的/.test(t4), '没命中就说「没有匹配的」')

// 4) 读不到 / 空态
ok(/读不到 skill 清单/.test(text(SkillsBody({ data: { ok: false, error: 'HTTP 404' } }))), '服务没通时说清是读不到，不是空')
ok(/读清单中/.test(text(SkillsBody({ data: null }))), '还没回来时是「读清单中」')

// 5) 费用
const cost = { now: 1794000000000, todaySpend: 0.4213, monthSpend: 12.3, last30dSpend: 15.2, totalSpend: 345.6, currentSession: null, persistence: { state: 'ok' } }
const t5 = text(CostBody({ data: cost, err: '', onReload() {} }))
console.log('\n[5] 费用文本：' + t5.replace(/\s+/g, ' ').slice(0, 150))
ok(/今日（北京）/.test(t5) && /¥0.421/.test(t5), '今日按北京日切显示')
ok(/本月/.test(t5) && /近 30 天/.test(t5) && /全部/.test(t5), '四档都在')
ok(/本会话/.test(t5), '留了一行「本会话」，写的是 —（面板不知道会话 id）')
ok(/读不到费用/.test(text(CostBody({ data: null, err: 'HTTP 401', onReload() {} }))), '401 时说读不到，不是显示 0')

console.log('\n' + (bad ? bad + ' 项没过' : '全部通过'))
process.exit(bad ? 1 : 0)
