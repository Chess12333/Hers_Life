import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const handlers = new Map(), sent = []
let receive
const body = { tagName: 'BODY' }
const block = (text) => ({
  tagName: 'P', innerText: text, parentElement: body,
  getAttribute: () => null,
  getBoundingClientRect: () => ({ left: 20, top: 40, width: 300, height: 60 }),
})
const a = block('The first hovered paragraph'), b = block('The paragraph actually clicked')
const root = { style: {}, lang: 'en', appendChild() {} }
const document = {
  body, documentElement: root, title: 'Fixture',
  elementFromPoint: (x) => x < 600 ? a : b,
  querySelector: () => null,
  createElement: () => ({ style: {}, setAttribute() {} }),
  addEventListener: (name, fn) => handlers.set(name, fn),
  removeEventListener: (name) => handlers.delete(name),
}
const window = { addEventListener() {}, removeEventListener() {} }
window.top = window
const context = { window, document, innerWidth: 1000, innerHeight: 800,
  location: { href: 'https://example.test/', hostname: 'example.test' },
  chrome: { runtime: { sendMessage: (msg) => sent.push(msg), onMessage: { addListener: (fn) => { receive = fn } } } },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
}
vm.runInNewContext(readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8'), context)
receive({ type: 'webpick-toggle' }, {}, () => {})
handlers.get('click')({ clientX: 800, clientY: 100, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} })
assert.equal(sent.find(x => x.type === 'webpick')?.payload.text, b.innerText,
  'confirmation must resolve the clicked block rather than reuse stale hover')
console.log('webpick click contract: passed')
