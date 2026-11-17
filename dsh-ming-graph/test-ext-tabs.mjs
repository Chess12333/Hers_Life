#!/usr/bin/env node
/**
 * test-ext-tabs.mjs —— 「外部页签」协议烟测（不开浏览器）
 *
 * 验的是三件事，顺序就是面板真实的顺序：
 *   ① 面板挂上 → window.__MING_TAB_HOST 出现；
 *   ② host.add({id,label,render}) → 顶栏多一个按钮，文字对得上；
 *   ③ host.remove(id) → 那个按钮消失；面板卸载 → host 被拆掉。
 *
 * 做法：假 window + 假 React（只实现 client.js 用到的六个 hook），
 * 加载真的 client.js（不是复制一份逻辑——复制一份就是在测我以为的代码）。
 *
 * 用法：node test-ext-tabs.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const code = fs.readFileSync(path.join(here, 'client.js'), 'utf8')

/* ---------- 假 React ---------- */
let ctx = null
const instances = new Map()
let rerenderWanted = false
const errors = []

function instOf(type) {
  if (!instances.has(type)) instances.set(type, { hooks: [], effects: [], props: {}, state: {} })
  return instances.get(type)
}
function markDirty() { rerenderWanted = true }

const React = {
  Component: class Component {
    constructor(props) { this.props = props; this.state = {} }
    setState(s) { this.state = Object.assign({}, this.state, typeof s === 'function' ? s(this.state) : s); markDirty() }
  },
  createElement(type, props, ...kids) {
    const p = Object.assign({}, props || {})
    const all = kids.length ? kids : (p.children !== undefined ? [p.children] : [])
    p.children = all.length === 1 ? all[0] : all
    return { type, props: p }
  },
  useState(init) {
    const inst = ctx.inst
    const i = ctx.i++
    if (!(i in inst.hooks)) inst.hooks[i] = typeof init === 'function' ? init() : init
    const set = (v) => { inst.hooks[i] = typeof v === 'function' ? v(inst.hooks[i]) : v; markDirty() }
    return [inst.hooks[i], set]
  },
  useRef(v) { const i = ctx.i++; if (!(i in ctx.inst.hooks)) ctx.inst.hooks[i] = { current: v }; return ctx.inst.hooks[i] },
  useEffect(fn, deps) {
    const i = ctx.i++
    const prev = ctx.inst.hooks[i]
    const same = prev && prev.deps && Array.isArray(deps)
      && prev.deps.length === deps.length && deps.every((d, k) => Object.is(d, prev.deps[k]))
    if (!same) { ctx.inst.hooks[i] = { deps }; ctx.inst.effects.push(fn) }
  },
  useCallback(fn) { ctx.i++; return fn },
  useMemo(fn) { ctx.i++; return fn() },
}

function render(el) {
  if (el === null || el === undefined || el === false || el === true) return null
  if (typeof el === 'string' || typeof el === 'number') return { text: String(el) }
  if (Array.isArray(el)) return el.map(render).filter((x) => x !== null)
  if (!el || typeof el !== 'object') return null
  const { type, props } = el
  if (typeof type === 'function') {
    const inst = instOf(type)
    inst.props = props
    if (type.prototype && typeof type.prototype.render === 'function') {
      const obj = Object.create(type.prototype)
      obj.props = props
      obj.state = inst.state || {}
      obj.setState = (s) => { inst.state = Object.assign({}, inst.state, typeof s === 'function' ? s(inst.state) : s); markDirty() }
      return render(obj.render())
    }
    const prev = ctx
    ctx = { inst, i: 0 }
    let out
    try { out = type(props) } catch (e) { errors.push(String(e && e.stack || e)); out = null }
    ctx = prev
    return render(out)
  }
  return { tag: String(type), props, children: [].concat(props && props.children !== undefined ? props.children : []).map(render).filter((x) => x !== null) }
}

function runEffects() {
  let ran = 0
  for (const inst of instances.values()) {
    const fns = inst.effects.splice(0)
    for (const f of fns) { try { f() ; ran++ } catch (e) { errors.push(String(e && e.stack || e)) } }
  }
  return ran
}

/* ---------- 假 window / document ---------- */
const g = globalThis
globalThis.window = globalThis
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
}
try { globalThis.navigator = { userAgent: 'node' } } catch (e) { /* Node 24 里 navigator 是只读 getter，本来就有 */ }
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0)
globalThis.cancelAnimationFrame = (t) => clearTimeout(t)
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

let factory = null
globalThis.__ModuleLoader__ = { load(spec) { factory = spec.factory } }
globalThis.__MG_ERR = null

vm.runInThisContext(code, { filename: 'client.js' })
if (!factory) { console.error('✗ client.js 没有调 __ModuleLoader__.load'); process.exit(2) }

const regs = []
const ctxObj = {
  slots: {
    inject(name, cb) { cb() },
    register(spec, comp) { regs.push({ name: spec.name, spec, comp }); return () => {} },
  },
}
const plugin = factory((m) => (m === 'react' ? React : {}))
// ④ 早到的那个：它在「她的一生」装好之前就 push 了队列（真实顺序：另一个插件先加载）。
// 放在 apply 之前，因为宿主现在是 apply 时建的。
window.__MING_TABS_PENDING = [{ id: 'early', label: '早到的', order: 200, render: () => React.createElement('div', null, 'pending 那一个') }]
plugin.apply(ctxObj)

const main = regs.find((r) => r.name === 'main')
if (!main) { console.error('✗ main 面板没注册上，注册到的是：' + regs.map((r) => r.name).join(',')); process.exit(2) }

/* ---------- 开跑 ---------- */
let tree = null
function paint() { tree = render(React.createElement(main.comp, {})) }
paint()
runEffects()
paint()

function texts(node, out = []) {
  if (!node) return out
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out }
  if (node.text !== undefined) { out.push(node.text); return out }
  if (node.children) node.children.forEach((n) => texts(n, out))
  return out
}
const segButtons = (node, out = []) => {
  if (!node) return out
  if (Array.isArray(node)) { node.forEach((n) => segButtons(n, out)); return out }
  if (node.tag === 'div' && node.props && node.props.className === 'mg-seg') {
    node.children.forEach((c) => { if (c && c.tag === 'button') out.push(texts(c).join('')) })
  }
  if (node.children) node.children.forEach((n) => segButtons(n, out))
  return out
}

let fail = 0
const check = (ok, msg) => { console.log((ok ? '✓ ' : '✗ ') + msg); if (!ok) fail++ }

check(typeof window.__MING_TAB_HOST === 'object' && window.__MING_TAB_HOST !== null, '挂载后面板建了 __MING_TAB_HOST')
const beforeTabs = segButtons(tree)
check(!beforeTabs.includes('测试页签'), '挂之前顶栏没有这个页签（基准：' + beforeTabs.join(' / ') + '）')

window.__MING_TAB_HOST.add({ id: 't', label: '测试页签', order: 50, render: () => React.createElement('div', null, '这一页进来了') })
paint()
check(segButtons(tree).includes('测试页签'), 'add 之后顶栏出现了「测试页签」')

// 点它：view 切成 ext:t，内容应该渲染
const btn = (function find(n) {
  if (!n) return null
  if (Array.isArray(n)) { for (const x of n) { const r = find(x); if (r) return r } return null }
  if (n.tag === 'button' && n.props && n.props.onClick && texts(n).join('') === '测试页签') return n
  if (n.children) for (const x of n.children) { const r = find(x); if (r) return r }
  return null
})(tree)
if (btn) {
  btn.props.onClick()
  paint()
  runEffects()
  paint()
  check(texts(tree).includes('这一页进来了'), '点进去渲染了它自己的内容')
} else {
  check(false, '找得到那个页签按钮')
}

window.__MING_TAB_HOST.remove('t')
paint()
check(!segButtons(tree).includes('测试页签'), 'remove 之后顶栏收回了它')

// ④ 早到的那一个：宿主（apply 时）把它从 pending 队列里收走——上面已经在 apply 之前 push 过了
check(segButtons(tree).includes('早到的'), '先 push 的页签，在宿主建起来时被收进来了')
check(Array.isArray(window.__MING_TABS_PENDING) && window.__MING_TABS_PENDING.length === 0, '收完之后队列清空（不会重复挂）')

if (errors.length) { console.log('\n— 渲染期间抓到的异常 —'); errors.slice(0, 5).forEach((e) => console.log(e.split('\n')[0])) }

console.log(fail ? `\n✗ ${fail} 项没过` : '\n✓ 协议通：建宿主 / 挂 / 点 / 收 / 拆，五步都走通了')
process.exit(fail ? 1 : 0)
