// dsh-ming-mousepet/lib/webpick.mjs —— 「交给鱼看这段」的接收与取走（交接书 I 的配对/身份/忙状态）
//
// 2026-11-17 并进桌宠插件：原来是 scripts/webpick-recv.mjs 单独起一个 47323 的 TCP 服务，
// 现在挂到桌宠自己的 webServer 上（/dsh-ming-mousepet/api/webpick/*），少一个常驻进程。
//
// 纯逻辑 + 一个 handleRequest：不碰 cordis，不自己起服务器，方便单测。
//
// 契约：
//   POST /pick     header X-Ming-Token   {requestId, url, title, text}
//     200 {ok:true, requestId, chars}
//     401 {ok:false, why:"token"}          不落盘
//     409 {ok:false, why:"busy", pendingId} 不覆盖
//     413 {ok:false, why:"too-large"}
//     400 {ok:false, why:"bad-request"}
//   POST /consume  {requestId}  → 200 {ok:true}
//   GET  /status   → 200 {ok:true, pending, dir}
//
// 规矩：token 不对一律不落盘；上一段没取走就不许写第二段；不打印正文，不把 token 写进日志。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const MAX_BODY = 256 * 1024
const MAX_TEXT = 20000

function loadOrCreateToken(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (j && typeof j.token === 'string' && j.token.length >= 16) return j.token
  } catch { /* 没有就生成 */ }
  const token = crypto.randomBytes(24).toString('base64url')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ token, createdAt: new Date().toISOString(), note: '浏览器扩展选项页填这个' }, null, 2), 'utf8')
  return token
}

function json(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // 扩展在 chrome-extension:// 来源，必须给 CORS 头；真正的门是 token，不是 origin。
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-ming-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'content-length': body.length,
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) { reject(Object.assign(new Error('too-large'), { code: 'too-large' })); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * @param {object} opts
 * @param {string} opts.dir        落盘目录（live/webpick）
 * @param {string} opts.tokenFile  token 文件
 * @param {(rec:{requestId:string,chars:number,text:string,url:string,title:string})=>void} [opts.onPick]  收到一段之后（桌宠看完说一句）
 * @param {(info:{requestId:string,chars:number})=>void} [opts.onTake]               被取走之后
 */
export function createWebpick(opts = {}) {
  const dir = opts.dir
  const tokenFile = opts.tokenFile
  const onPick = typeof opts.onPick === 'function' ? opts.onPick : null
  const onTake = typeof opts.onTake === 'function' ? opts.onTake : null
  const token = loadOrCreateToken(tokenFile)
  let pending = null // {requestId, at, chars}

  const api = {
    /** 给工具/设置页看的只读状态。不含正文。 */
    status() {
      return { ok: true, pending: pending ? { ...pending } : null, dir, tokenFile, hasToken: !!token }
    },

    /** POST /pick */
    async pick(req) {
      const got = String(req.headers['x-ming-token'] || '')
      if (got !== token) return { status: 401, body: { ok: false, why: 'token' } }
      let raw
      try { raw = await readBody(req) } catch (e) {
        return { status: 413, body: { ok: false, why: e.code === 'too-large' ? 'too-large' : 'read' } }
      }
      let body
      try { body = JSON.parse(raw || '{}') } catch { return { status: 400, body: { ok: false, why: 'bad-json' } } }
      const id = String(body.requestId || '')
      const text = String(body.text || '')
      if (!id || !text) return { status: 400, body: { ok: false, why: 'bad-request' } }
      if (text.length > MAX_TEXT) return { status: 413, body: { ok: false, why: 'too-large', limit: MAX_TEXT } }
      if (pending) return { status: 409, body: { ok: false, why: 'busy', pendingId: pending.requestId } }

      fs.mkdirSync(dir, { recursive: true })
      const rec = {
        schemaVersion: 1,
        requestId: id,
        at: new Date().toISOString(),
        source: String(body.source || 'browser-extension'),
        url: String(body.url || '').slice(0, 2000),
        title: String(body.title || '').slice(0, 300),
        chars: text.length,
        text,
      }
      // 只留字母数字下划线连字符：点号也清掉，免得出现 '..' 这种看着像穿越的名字。
      const name = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + '.json'
      fs.writeFileSync(path.join(dir, name), JSON.stringify(rec, null, 2), 'utf8')
      fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ requestId: id, at: rec.at, chars: rec.chars, file: name }, null, 2), 'utf8')
      pending = { requestId: id, at: rec.at, chars: rec.chars }
      // 2026-11-17（她说的「让桌宠来说」）：收到就让桌宠冒一句，不用等我去取。
      // 传整条记录（含正文）：桌宠拿到之后会照老样子「看完说一句」。
      try { if (onPick) onPick(rec) } catch { /* 桌宠没开也不影响收下 */ }
      return { status: 200, body: { ok: true, requestId: id, chars: rec.chars } }
    },

    /** POST /consume —— 取走之后才允许下一段 */
    async consume(req) {
      const got = String(req.headers['x-ming-token'] || '')
      if (got !== token) return { status: 401, body: { ok: false, why: 'token' } }
      let raw
      try { raw = await readBody(req) } catch { return { status: 413, body: { ok: false, why: 'read' } } }
      let body
      try { body = JSON.parse(raw || '{}') } catch { return { status: 400, body: { ok: false, why: 'bad-json' } } }
      const id = String(body.requestId || '')
      if (!id) return { status: 400, body: { ok: false, why: 'bad-request' } }
      if (pending && pending.requestId === id) pending = null
      try { if (onTake) onTake({ requestId: id }) } catch { /* 同上 */ }
      return { status: 200, body: { ok: true, consumed: id } }
    },

    /** 读到最新一段的正文（给工具用）；读完不自动 consume，调用方决定。 */
    readLatest() {
      try {
        const cur = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'))
        const rec = JSON.parse(fs.readFileSync(path.join(dir, cur.file), 'utf8'))
        return { ok: true, requestId: rec.requestId, at: rec.at, url: rec.url, title: rec.title, chars: rec.chars, text: rec.text }
      } catch (e) {
        return { ok: false, why: e.code === 'ENOENT' ? 'empty' : String(e.message || e) }
      }
    },

    /** 把最新一段标记为已取走（不经过 HTTP，给工具用）。 */
    markConsumed(requestId) {
      if (pending && (!requestId || pending.requestId === requestId)) {
        const id = pending.requestId
        const chars = pending.chars
        pending = null
        try { if (onTake) onTake({ requestId: id, chars }) } catch { /* 同上 */ }
        return { ok: true, consumed: id }
      }
      return { ok: false, why: 'not-pending' }
    },

    /** 路由入口：先给 CORS，再分到上面几个动作。 */
    async handleRequest(req, res, route) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type, x-ming-token',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'content-length': 0,
        })
        return res.end()
      }
      if (req.method === 'GET' && route === '/status') return json(res, 200, api.status())
      if (req.method === 'POST' && route === '/pick') { const r = await api.pick(req); return json(res, r.status, r.body) }
      if (req.method === 'POST' && route === '/consume') { const r = await api.consume(req); return json(res, r.status, r.body) }
      return json(res, 404, { ok: false, why: 'not-found' })
    },
  }

  return api
}
