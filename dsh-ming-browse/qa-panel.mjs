/**
 * _verify-panel.mjs —— 验「自己玩」面板这一轮改的三件事（2026-11-08）
 * 用完删。跑：node _verify-panel.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

function boot(ws) {
  const hs = []
  const ctx = {
    inject(d, cb) {
      if (d.includes('webServer')) {
        cb({
          effect(fn) { fn() },
          webServer: { register(r) { hs.push(r); return () => {} } },
          connection: { requestRejection() { return undefined } },
        })
      }
    },
    effect(fn) { fn() }, on() {}, tools: { register() {} },
    interval() { return () => {} }, setTimeout() { return () => {} }, setInterval() { return () => {} },
  }
  apply(ctx, { workspacePath: ws })
  return hs[0].handler
}

const call = (h, url) => new Promise((res) => {
  const req = { url, method: 'GET', headers: {} }
  const r = { writeHead() {}, end(b) { res(JSON.parse(String(b))) } }
  h(req, r).catch((e) => res({ threw: String(e.message) }))
})

const h1 = boot('C:/dsh/workspace')
await new Promise((r) => setTimeout(r, 30))
const b = await call(h1, '/_dsh/dsh-ming-browse/brush')
console.log('[brush] total=' + b.total + ' 天数=' + (b.days || []).length + ' 最新=' + (b.days || [])[0])
console.log('        11-07=' + ((b.dayCounts || {})['2026-11-07'] || 0) + ' 11-01=' + ((b.dayCounts || {})['2026-11-01'] || 0))

const n = await call(h1, '/_dsh/dsh-ming-browse/note?text=hi')
console.log('[note] ' + JSON.stringify(n))

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mwb-'))
fs.mkdirSync(path.join(ws, 'live'), { recursive: true })
const h3 = boot(ws.split(path.sep).join('/'))
await new Promise((r) => setTimeout(r, 30))
const on = await call(h3, '/_dsh/dsh-ming-browse/config?dailyMax=6&minGap=25&gapMode=random&unlimited=1')
const uf = path.join(ws, 'live', 'browse-unlimited.json')
const cfg = JSON.parse(fs.readFileSync(path.join(ws, 'live', 'browse-config.json'), 'utf8'))
console.log('[config on] saved=' + JSON.stringify(on.saved) + ' marker=' + fs.existsSync(uf))
if (fs.existsSync(uf)) console.log('           until=' + JSON.parse(fs.readFileSync(uf, 'utf8')).until)
console.log('           cfg=' + JSON.stringify(cfg))
const off = await call(h3, '/_dsh/dsh-ming-browse/config?dailyMax=6&minGap=25&gapMode=fixed&unlimited=0')
console.log('[config off] marker=' + fs.existsSync(uf) + ' saved=' + JSON.stringify(off.saved))
fs.rmSync(ws, { recursive: true, force: true })
