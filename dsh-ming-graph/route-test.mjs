/**
 * route-test.mjs —— 不重启 DSH 也能量一遍新路由（2026-11-08）
 *
 * 为什么：skills 那两个路由写在 index.js 里，得重启 DSH 才注册。
 * 重启归她，但"没验过就交出去"更糟——于是拿一个假 ctx 把 apply() 跑起来，
 * 把 webServer 注册的 handler 抓在手里，然后假装浏览器来请求。
 *
 *   node route-test.mjs
 *
 * 验的是路由这一层：URL 解析、method 分发、写盘、回读。
 * 真正的 ctx.skills 服务接不接得上，只有重启后才知道——那一条在这儿写明。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

const offFile = path.join(os.tmpdir(), 'ming-route-off.test.json')
try { fs.unlinkSync(offFile) } catch {}

const handlers = []
const fakeService = {
  async list() {
    return [
      { name: 'humanizer', description: '去 AI 味', source: 'user-dsh', provider: 'filesystem' },
      { name: 'dsh-plugin-dev', description: '插件开发', source: 'bundled', provider: 'pkg' },
    ]
  },
}

const ctx = {
  inject(deps, cb) {
    if (deps.includes('webServer')) {
      cb({
        effect(fn) { fn() },
        webServer: { register(r) { handlers.push(r); return () => {} } },
        connection: { requestRejection() { return undefined } },
      })
    } else if (deps.includes('skills')) {
      cb({ skills: fakeService })
    }
  },
  effect(fn) { fn() },
  on() {},
  tools: { register() {} },
}

apply(ctx, { skillsCwd: (process.env.MING_WORKSPACE || ''), skillsOffFile: offFile })
await new Promise((r) => setTimeout(r, 50))
if (!handlers.length) { console.log('FAIL 没注册上 webServer 路由'); process.exit(1) }
const { path: prefix, handler } = handlers[0]
console.log('路由：' + prefix)

function call(url, method = 'GET') {
  return new Promise((resolve) => {
    const req = { url, method, headers: {} }
    const res = { headersSent: false, writeHead() {}, end(body) { resolve(JSON.parse(String(body))) } }
    handler(req, res).catch((e) => resolve({ error: 'handler threw: ' + e.message }))
  })
}

let bad = 0
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++ }

const r1 = await call(prefix + '/skills')
console.log('\n[1] GET /skills → total=' + r1.total + ' source=' + r1.source + ' rows=' + (r1.rows || []).map((x) => x.name).join(','))
ok(r1.ok === true, '返回 ok')
ok(r1.source === 'service', '注入了假 service，走的不是磁盘兜底')
ok((r1.rows || []).some((x) => x.name === 'humanizer' && x.on), '服务里的 skill 出现了且是开着的')

const r2 = await call(prefix + '/skills/toggle?name=humanizer&on=0', 'POST')
const fileOff = JSON.parse(fs.readFileSync(offFile, 'utf8')).off
console.log('    关掉 humanizer → 文件=' + JSON.stringify(fileOff) + '，offCount=' + r2.offCount)
ok(fileOff.includes('humanizer'), '写进 skills-off.json')
ok((r2.rows || []).some((x) => x.name === 'humanizer' && x.on === false), '回读时它是关的')

const r3 = await call(prefix + '/skills/toggle?name=humanizer&on=1', 'POST')
console.log('    开回来 → offCount=' + r3.offCount)
ok(r3.offCount === 0, '开回来之后归零')

const r4 = await call(prefix + '/skills/toggle?name=humanizer&on=0', 'GET')
ok(r4.error && /POST/.test(r4.error), 'GET 打 toggle 会被挡（写动作只认 POST）')

const r5 = await call(prefix + '/skills/refresh')
ok(r5.ok === true && r5.total >= 2, '/skills/refresh 也通')

const r6 = await call(prefix + '/nope')
ok(/unknown method/.test(r6.error || ''), '不认识的方法照旧 404')

// 2026-11-10：索引费用
// GET 不行（写动作）；POST 在「没有未定价模型」时要早退，别去联网。
// 注：这里读的是真账本 + 真 live/cost-prices.auto.json。哪天账本里冒出新的未定价模型，
// 这条会真的去网上搜（慢十几秒）——那也算它该做的事，只是别当成卡死。
const r7 = await call(prefix + '/cost/index', 'GET')
ok(/POST/.test(r7.error || ''), 'GET 打 cost/index 会被挡')
const r8 = await call(prefix + '/cost/index', 'POST')
ok(r8.ok === true, 'POST cost/index 返回 ok（' + (r8.message || ('索引 ' + ((r8.summary && r8.summary.total) || 0) + ' 个')) + '）')
ok(!r8.cost || typeof r8.cost.periods === 'object' || r8.message, '回来时带着刷新后的账（或说明没有可索引的）')

try { fs.unlinkSync(offFile) } catch {}
console.log('\n' + (bad ? bad + ' 项没过' : '全部通过') + '\n注：ctx.skills 真服务接不接得上要重启后才算数。')
process.exit(bad ? 1 : 0)
