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

  // 2026-11-17（核查 R08）：pending 原来只在内存里，进程一重启就不知道
  // 「A 还没处理完」了，B 进来直接把 current.json 指过去，A 就凭空消失。
  // 现在落一个 pending.json：收到的、处理中的、失败的都记着；重启照样读回来。
  const pendingFile = path.join(dir, 'pending.json')
  const loadPending = () => {
    try {
      const j = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
      if (!j || !j.requestId) return null
      return {
        requestId: String(j.requestId),
        at: String(j.at || ''),
        chars: Number(j.chars) || 0,
        stage: String(j.stage || 'received'),
        why: typeof j.why === 'string' ? j.why : '',
      }
    } catch {
      return null
    }
  }
  const savePending = (p) => {
    try {
      fs.mkdirSync(dir, { recursive: true })
      if (!p) { fs.rmSync(pendingFile, { force: true }); return }
      fs.writeFileSync(pendingFile, JSON.stringify(p, null, 2), 'utf8')
    } catch { /* 落盘失败不影响内存里的状态 */ }
  }
  let pending = loadPending() // {requestId, at, chars, stage, why?}

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
      if (pending) {
        if (pending.stage !== 'failed') {
          return { status: 409, body: { ok: false, why: 'busy', pendingId: pending.requestId, stage: pending.stage } }
        }
        // 上一条是「没答成」：它的正文文件还在盘上、失败原因进历史，别拿它挡新的。
        try {
          fs.appendFileSync(path.join(dir, 'webpick-history.jsonl'),
            JSON.stringify({ ...pending, archivedAt: new Date().toISOString() }) + '\n', 'utf8')
        } catch { /* 历史写不进去也不挡收新的 */ }
        pending = null
        savePending(null)
      }

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
      pending = { requestId: id, at: rec.at, chars: rec.chars, stage: 'received', why: '' }
      savePending(pending)
      // 2026-11-17（她说的「让桌宠来说」）：收到就让桌宠冒一句，不用等我去取。
      // 传整条记录（含正文）：桌宠拿到之后会照老样子「看完说一句」。
      // **成功才把 pending 结掉**：成功 = 桌宠真的答了；busy / 无模型 / 只显示「收到 N 字」
      // 都算没答完（核查 R08-2），留在 pending 里并写明原因。
      if (onPick) {
        Promise.resolve()
          .then(() => onPick(rec))
          .then((r) => {
            // 只有消费者**明确**说「答了（ok:true）」才结掉这条；
            // 没表态（undefined）就当它还欠着——不许把"收到"当成"已回答"。
            if (r && r.ok === true) api.markConsumed(rec.requestId, (r && r.note) || 'answered')
            else if (r && r.ok === false) api.fail(rec.requestId, r.why || 'not-answered')
          })
          .catch((e) => api.fail(rec.requestId, String((e && e.message) || e)))
      }
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
      // 不匹配就明说没清掉任何东西，别回一个含混的 ok（核查 R08-6）。
      if (!pending) return { status: 409, body: { ok: false, why: 'empty' } }
      if (pending.requestId !== id) return { status: 409, body: { ok: false, why: 'mismatch', pendingId: pending.requestId } }
      api.markConsumed(id, 'http-consume')
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

    /** 把一段标记为已完成（不经过 HTTP，给工具和自动路径用）。 */
    markConsumed(requestId, note) {
      if (!pending) return { ok: false, why: 'empty' }
      if (requestId && pending.requestId !== requestId) {
        return { ok: false, why: 'mismatch', pendingId: pending.requestId }
      }
      const id = pending.requestId
      const chars = pending.chars
      pending = null
      savePending(null)
      try { if (onTake) onTake({ requestId: id, chars, note: note || '' }) } catch { /* 同上 */ }
      return { ok: true, consumed: id }
    },

    /** 没答成：留住这条，写明原因，别让下一条把它挤掉。 */
    fail(requestId, why) {
      if (!pending) return { ok: false, why: 'empty' }
      if (requestId && pending.requestId !== requestId) {
        return { ok: false, why: 'mismatch', pendingId: pending.requestId }
      }
      pending = { ...pending, stage: 'failed', why: String(why || 'failed').slice(0, 200) }
      savePending(pending)
      return { ok: true, failed: pending.requestId, why: pending.why }
    },

    /** 失败的那条再答一次（手动入口）：状态回 received，正文还在盘上。 */
    retry(requestId) {
      if (!pending) return { ok: false, why: 'empty' }
      if (requestId && pending.requestId !== requestId) {
        return { ok: false, why: 'mismatch', pendingId: pending.requestId }
      }
      pending = { ...pending, stage: 'received', why: '' }
      savePending(pending)
      return { ok: true, requestId: pending.requestId }
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
