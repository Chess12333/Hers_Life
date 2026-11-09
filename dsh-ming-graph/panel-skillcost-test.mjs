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

// 2026-11-10：主面板按页拆过（费用这块搬到了 src/panels/cost.js），这里跟着换源。
// 原来读 src/panel.js、拿 NeuronPanel 当终点；拆分后那段不在了，测试会 FAIL「抽不出」——不是代码坏。
const src = fs.readFileSync(new URL('./src/panels/cost.js', import.meta.url), 'utf8')
const from = src.indexOf('function fmtMoney(')
if (from < 0) { console.log('FAIL 抽不出那一段'); process.exit(1) }
const chunk = src.slice(from)

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
  ok: true, cwd: 'C:\\dsh\\workspace', offFile: 'C:\\dsh\\workspace\\skills-off.json',
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

// 5) 费用：空态与读不到
// 2026-11-10 改：这一段原来喂的是 11-08 之前的旧数据结构（todaySpend/last30dSpend/currentSession），
// CostBody 早就改成吃 periods 了，所以三项一直红着——红的是测试，不是功能。现在按现结构重写。
ok(/读账本中/.test(text(CostBody({ data: null, err: '' }))), '还没回来时写「读账本中」')
ok(/读不到账本/.test(text(CostBody({ data: null, err: 'HTTP 401', onReload() {} }))), '401 时说读不到账本，不是显示 0')
ok(/读不到账本/.test(text(CostBody({ data: { ok: false, error: '找不到账本：x' } }))), 'ok:false 时把原因写出来')

// 5) 2026-11-10：借了别的模型的价，名字后面要写出「（公式：X）」
const costData = {
  ok: true, basis: '按官方价折算', pricesSource: 'p.json', ledger: 'l.sqlite', at: '2026-11-10T00:00:00Z',
  periods: {
    today: { cost: 1, input: 10, cacheRead: 0, output: 1 },
    month: { cost: 1, input: 10, cacheRead: 0, output: 1 },
    d30: { cost: 1, input: 10, cacheRead: 0, output: 1 },
    all: {
      cost: 2, input: 110, cacheRead: 0, output: 11, records: 3,
      models: [
        { model: 'deepseek-v4.1-flash', records: 2, input: 10, cacheRead: 0, output: 1, cost: 1, priced: true, from: 'deepseek-v4.1-flash', source: 'api-docs' },
        { model: 'gpt-6o', records: 1, input: 100, cacheRead: 0, output: 10, cost: 1, priced: true, from: 'gpt-6-astra', source: 'costperprompt' },
        { model: 'zzz', records: 1, input: 0, cacheRead: 0, output: 0, cost: 0, priced: false, from: 'zzz' },
      ],
    },
  },
}
const tCost = text(CostBody({ data: costData })).replace(/\s+/g, '')
ok(/gpt-6o（公式：gpt-6-astra）/.test(tCost), '借来的价要标出公式：gpt-6o（公式：gpt-6-astra）')
ok(!/deepseek-v4\.1-flash（公式：/.test(tCost), '自己的价不标公式（只有借的才标）')
ok(/未定价/.test(tCost), '还是没价的模型照样写「未定价」，不装成有数')

console.log('\n' + (bad ? bad + ' 项没过' : '全部通过'))
process.exit(bad ? 1 : 0)
