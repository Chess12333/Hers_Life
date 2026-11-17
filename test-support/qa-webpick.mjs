// test-support/qa-webpick.mjs —— I 离线验收：配对、请求身份、忙状态、精确落盘、CORS
//
// 2026-11-17 改成测桌宠插件里的 lib/webpick.mjs（不再单独起 scripts/webpick-recv.mjs）。
// 两层都测：先纯逻辑，再用 http.Server 包一层接口测真实 HTTP（含 CORS 预检）。
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const LIB = join(here, '..', 'dsh-ming-mousepet', 'lib', 'webpick.mjs')
const { createWebpick } = await import('file://' + LIB.replace(/\\/g, '/'))

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const tmp = mkdtempSync(join(tmpdir(), 'ming-webpick-'))
const DIR = join(tmp, 'out')
const TOKEN_FILE = join(tmp, 'token.json')

const picked = []
const taken = []
const wp = createWebpick({
  dir: DIR,
  tokenFile: TOKEN_FILE,
  onPick: (info) => picked.push(info),
  onTake: (info) => taken.push(info),
})
const token = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).token
ok('首次创建生成了 token', typeof token === 'string' && token.length >= 16)

// 起一个最小 HTTP 服务，把 handleRequest 挂上去（等价于桌宠 webServer 那个口）
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://127.0.0.1').pathname
  const route = p.replace(/^\/dsh-ming-mousepet\/api\/webpick/, '') || '/'
  wp.handleRequest(req, res, route)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const api = '/dsh-ming-mousepet/api/webpick'

const post = (p, body, tk) => fetch(base + api + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(tk ? { 'x-ming-token': tk } : {}) },
  body: JSON.stringify(body),
})

// —— CORS 预检 ——
{
  const r = await fetch(base + api + '/pick', { method: 'OPTIONS' })
  ok('OPTIONS 预检 204', r.status === 204)
  ok('预检带 allow-origin', r.headers.get('access-control-allow-origin') === '*')
  ok('预检允许 x-ming-token', String(r.headers.get('access-control-allow-headers') || '').includes('x-ming-token'))
}

// —— 配对 ——
{
  const r = await post('/pick', { requestId: 'x', text: 'hi' })
  ok('没有 token → 401', r.status === 401, 'status=' + r.status)
  ok('没 token 不落盘', !existsSync(DIR))
  const r2 = await post('/pick', { requestId: 'x', text: 'hi' }, 'wrong-token-wrong-token')
  ok('token 不对 → 401', r2.status === 401)
  ok('错 token 也不落盘', !existsSync(DIR))
}

// —— 参数 ——
{
  const r = await post('/pick', {}, token)
  ok('缺字段 → 400', r.status === 400)
  const r2 = await post('/pick', { requestId: 'a1', text: 'x'.repeat(20001) }, token)
  ok('超长 → 413', r2.status === 413)
}

// —— 正常一段 ——
{
  const r = await post('/pick', { requestId: 'req-1', url: 'https://example.test/a', title: '标题', text: '这是第一段' }, token)
  const j = await r.json()
  ok('正常 → 200', r.status === 200 && j.ok === true && j.requestId === 'req-1')
  ok('落盘目录建好了', existsSync(DIR))
  const files = readdirSync(DIR)
  ok('按 requestId 落盘（不是固定名）', files.includes('req-1.json'), files.join(','))
  ok('也有 current.json 指针', files.includes('current.json'))
  const rec = JSON.parse(readFileSync(join(DIR, 'req-1.json'), 'utf8'))
  ok('记录带 url/title/chars', rec.url.startsWith('https://') && rec.title === '标题' && rec.chars === 5)
  ok('记录带原始文本', rec.text === '这是第一段')
}

// —— 忙：第二段不覆盖 ——
{
  const r = await post('/pick', { requestId: 'req-2', text: '第二段' }, token)
  const j = await r.json()
  ok('上一段没取走 → 409', r.status === 409, 'status=' + r.status)
  ok('409 里带 pendingId', j.pendingId === 'req-1')
  ok('第二段没有落盘', !existsSync(join(DIR, 'req-2.json')))
  ok('第一段没被覆盖', JSON.parse(readFileSync(join(DIR, 'req-1.json'), 'utf8')).text === '这是第一段')
}

// —— 工具侧读+取走（不走 HTTP） ——
{
  const s = wp.status()
  ok('status 报待取', s.pending && s.pending.requestId === 'req-1')
  ok('status 不带正文', JSON.stringify(s).indexOf('这是第一段') === -1)
  const latest = wp.readLatest()
  ok('readLatest 拿得到正文', latest.ok && latest.text === '这是第一段')
  const c = wp.markConsumed(latest.requestId)
  ok('markConsumed 成功', c.ok === true && c.consumed === 'req-1')
  ok('取走后没有 pending', wp.status().pending === null)
}

// —— 取走后能发下一段 ——
{
  const r = await post('/pick', { requestId: 'req-2', text: '第二段' }, token)
  ok('取走之后能发下一段', r.status === 200)
  ok('第二段独立落盘', existsSync(join(DIR, 'req-2.json')))
  ok('第一段还在（不覆盖）', existsSync(join(DIR, 'req-1.json')))
  const r2 = await post('/consume', { requestId: 'req-2' }, token)
  ok('HTTP consume → 200', r2.status === 200)
}

// —— 回调（桌宠冒话用）——
{
  ok('收到一段时回调（此刻两次：req-1 / req-2）', picked.length === 2, JSON.stringify(picked))
  ok('回调带字数', picked[0] && picked[0].chars === 5)
  ok('回调带 requestId', picked[0] && typeof picked[0].requestId === 'string')
  ok('取走时也回调', taken.length >= 2, JSON.stringify(taken))
  ok('取走回调带 id', taken[0] && typeof taken[0].requestId === 'string')
}

// —— 怪 id 不穿越 ——
{
  const r = await post('/pick', { requestId: '../../evil', text: 'x' }, token)
  ok('怪 id 仍然 200', r.status === 200)
  const files = readdirSync(DIR)
  ok('怪 id 没有穿越目录', files.every((f) => !f.includes('..') && !f.includes('/')), files.join(','))
}

// —— R08：待处理状态要活过重启，消费要认 id ——
{
  wp.markConsumed() // 先把上一段清掉
  const r = await post('/pick', { requestId: 'r8-a', text: '第一段要重启' }, token)
  ok('R8 收到一段', r.status === 200)
  ok('R8 pending 落盘了', existsSync(join(DIR, 'pending.json')))
  const revived = createWebpick({ dir: DIR, tokenFile: TOKEN_FILE })
  const s = revived.status()
  ok('R8 重建接收器后仍知道 A 没处理完', !!s.pending && s.pending.requestId === 'r8-a', JSON.stringify(s.pending))
  const bad = await post('/consume', { requestId: '不是这条' }, token)
  ok('R8 消费不匹配 id → 409', bad.status === 409, 'status=' + bad.status)
  ok('R8 不匹配时原待处理项没被清掉', revived.status().pending?.requestId === 'r8-a')
  const good = revived.markConsumed('r8-a', 'manual')
  ok('R8 按 id 消费后清掉', good.ok === true && revived.status().pending === null)
}

// —— R08：自动路径「成功才结账」「失败留住原因」 ——
{
  const serve = async (w) => {
    const s = http.createServer((req, res) => {
      const pp = new URL(req.url, 'http://127.0.0.1').pathname
      const route = pp.replace(/^\/dsh-ming-mousepet\/api\/webpick/, '') || '/'
      w.handleRequest(req, res, route)
    })
    await new Promise((r) => s.listen(0, '127.0.0.1', r))
    return { s, url: 'http://127.0.0.1:' + s.address().port }
  }
  const postTo = (url, path, body, tk) => fetch(url + '/dsh-ming-mousepet/api/webpick' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(tk ? { 'x-ming-token': tk } : {}) },
    body: JSON.stringify(body),
  })

  const dirOk = join(tmp, 'auto-ok')
  const tfOk = join(tmp, 'token-ok.json')
  const okAt = createWebpick({ dir: dirOk, tokenFile: tfOk, onPick: async () => ({ ok: true, note: 'spoke' }) })
  const okSrv = await serve(okAt)
  const okToken = JSON.parse(readFileSync(tfOk, 'utf8')).token
  await postTo(okSrv.url, '/pick', { requestId: 'auto-a', text: '答得出来的一段' }, okToken)
  await new Promise((r) => setTimeout(r, 30))
  ok('R8 自动答完自动结掉', okAt.status().pending === null, JSON.stringify(okAt.status().pending))
  okSrv.s.close()

  const dirBad = join(tmp, 'auto-fail')
  const tfBad = join(tmp, 'token-bad.json')
  const badAt = createWebpick({ dir: dirBad, tokenFile: tfBad, onPick: async () => ({ ok: false, why: 'busy' }) })
  const badSrv = await serve(badAt)
  const badToken = JSON.parse(readFileSync(tfBad, 'utf8')).token
  await postTo(badSrv.url, '/pick', { requestId: 'auto-b', text: '答不出来的一段' }, badToken)
  await new Promise((r) => setTimeout(r, 30))
  const st2 = badAt.status().pending
  ok('R8 没答成时留着并写明原因', !!st2 && st2.requestId === 'auto-b' && st2.stage === 'failed' && st2.why === 'busy', JSON.stringify(st2))
  const r3 = await postTo(badSrv.url, '/pick', { requestId: 'auto-c', text: '下一段' }, badToken)
  ok('R8 上一条失败不挡下一段', r3.status === 200, 'status=' + r3.status)
  badSrv.s.close()
}

server.close()
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
