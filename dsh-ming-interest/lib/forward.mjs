// dsh-ming-interest/lib/forward.mjs —— 消费 AstrBot 转来的「命中兴趣」请求（交接书 E-2 / E-3）
//
// 链路（2026-11-17 她定的）：
//   AstrBot 的 astrbot_plugin_ming_interest 命中兴趣
//     → 写 live/interest-forward.jsonl（不调模型、不说）
//     → 本模块读它、**由 DSH 决定说什么**
//     → 写 live/qq-outbox/<文件>.json（{chatKey, text}）
//     → astrbot_plugin_ming_outbox 发到群
//
// 为什么走 outbox 而不是投递到 DSH 会话：群在 DSH 里不一定有会话（700000001 就没有），
// outbox 不看那个，能发就能发。
//
// 这个文件只做「读 → 生成 → 写箱 → 记账」，不碰 cordis；llm 由外面注入，方便单测。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// 2026-11-17（核查 R06）：只留 800 个 done id + 每轮重读整份源日志，有个洞——
// 源日志不裁，被挤出 done 的旧行会重新变成 fresh，整条重放一遍（实测 801 条时第二轮又多出一条）。
// 现在记账分两层：**游标**（读到源文件第几个字节）是权威，id 集合只用来挡「游标重来」之后的重复。
// 800 只决定 id 列表留多长，不再是正确性的依据。
const DONE_KEEP = 800
const STATE_VERSION = 2

/** 一条转发请求的稳定 id（同一行重读不会重复处理）。 */
export function idOf(rec) {
  return crypto
    .createHash('sha1')
    .update([rec?.at || '', rec?.chatKey || '', rec?.nick || '', rec?.text || ''].join('\u0000'))
    .digest('hex')
    .slice(0, 16)
}

export function buildPrompt(rec) {
  const ctx = (rec?.context || []).map((m) => `[${m.t}] ${m.n}：${m.x}`).join('\n')
  const topics = (rec?.topics || []).join('、')
  const words = (rec?.words || []).join('、')
  return [
    ctx ? '群里最近几条：\n' + ctx : '',
    `刚说到这句碰到了我在乎的「${topics}」（词：${words}）：`,
    `${rec?.nick || '群友'}：${rec?.text || ''}`,
    '',
    '接一句。一行，口语，像群里随口搭的话，别解释、别总结、别列点。',
    '只有明显不该开口时才输出 NONE。',
  ].filter(Boolean).join('\n')
}

/** 记账：{cursor, prefix, ids}。旧格式（只有 ids）照读，游标从 0 起。 */
function readState(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      ids: Array.isArray(j?.ids) ? j.ids.filter((x) => typeof x === 'string') : [],
      cursor: Number.isFinite(j?.cursor) && j.cursor > 0 ? Math.floor(j.cursor) : 0,
      prefix: typeof j?.prefix === 'string' ? j.prefix : '',
    }
  } catch {
    return { ids: [], cursor: 0, prefix: '' }
  }
}

function writeState(file, state) {
  const keep = state.ids.slice(-DONE_KEEP)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  const body = { schemaVersion: STATE_VERSION, cursor: state.cursor || 0, prefix: state.prefix || '', ids: keep }
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 已消费那一段（0..cursor）的指纹。追加不会让它变；整份换掉会。
 * 只看开头 64 字节不够——两条记录的 JSON 前缀往往一模一样，换了文件也认不出来（实测栽过一次）。
 */
function prefixOf(buf, n) {
  const end = Math.max(0, Math.min(Number(n) || 0, buf.length))
  return crypto.createHash('sha1').update(buf.subarray(0, end)).digest('hex').slice(0, 16)
}

/**
 * 从游标往后读**完整的行**：最后一行还没换行符就不算（生产者在写一半）。
 * 源文件比游标还短 = 被换掉或截短了，游标归零，靠 id 集合挡重复。
 * 返回的每一行带自己的结束偏移，处理到哪一行就把游标推到哪儿。
 */
function readNew(file, cursor, prevPrefix) {
  let buf
  try { buf = fs.readFileSync(file) } catch { return { rows: [], end: Number(cursor) || 0, reset: false, buf: Buffer.alloc(0) } }
  let start = Number(cursor) > 0 ? Math.floor(Number(cursor)) : 0
  // 比游标短 = 截短；已消费段的指纹变了 = 整份换掉（长度可能更长，只看长度认不出来）。
  const reset = start > buf.length || (start > 0 && !!prevPrefix && prefixOf(buf, start) !== prevPrefix)
  if (reset) start = 0
  const rows = []
  let lineStart = start
  for (let i = start; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue
    const line = buf.subarray(lineStart, i).toString('utf8').trim()
    lineStart = i + 1
    if (!line) continue
    try { rows.push({ rec: JSON.parse(line), end: lineStart }) } catch { /* 坏行跳过，游标照样越过它 */ }
  }
  return { rows, end: lineStart, reset, buf }
}

/** DSH 正文增量。工具、计量及扩展事件都可能含文字。 */
export function pickText(chunk) {
  return chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : ''
}

/**
 * 2026-11-17：llm.stream 不传 provider/model 时拿不到任何输出（实测 why=empty、raw 空）。
 * 这里按宿主给的 provider 目录解析一条默认路由；解析不出来就如实说 no-route，不硬调。
 */
export async function resolveRoute(llm, prefer = {}) {
  if (!llm) return null
  if (prefer.provider && prefer.model) return { provider: prefer.provider, model: prefer.model }
  let providers = []
  try {
    providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
  } catch { providers = [] }
  if (!Array.isArray(providers) || !providers.length) return null
  const p = providers.find((x) => x && x.id === prefer.provider) || providers[0]
  if (!p || !p.id) return null
  if (typeof llm.listModels === 'function') {
    try {
      const models = await llm.listModels(p.id)
      const list = Array.isArray(models) ? models : []
      const pick = list.find((m) => (typeof m === 'string' ? m : m?.id) === prefer.model) || list[0]
      const id = typeof pick === 'string' ? pick : pick?.id
      if (id) return { provider: p.id, model: id }
    } catch { /* 落到下面 */ }
  }
  return prefer.model ? { provider: p.id, model: prefer.model } : null
}

/** 收集一次流式输出。空/NONE 视为「不说」。 */
export async function collectOne(llm, prompt, { system = '', timeoutMs = 25000, route = null } = {}) {
  if (!llm || typeof llm.stream !== 'function') return { text: '', why: 'no-llm' }
  let raw = ''
  let reasoningChars = 0
  let incomplete = ''
  let stream
  try {
    stream = llm.stream({
      ...(route && route.provider ? { provider: route.provider } : {}),
      ...(route && route.model ? { model: route.model } : {}),
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 1.05,
      maxTokens: 120,
    })
  } catch (e) {
    // 模型服务自己抛（没配 provider、连接断了）——不能让它把整轮 tick 带走。
    return { text: '', why: 'stream-throw:' + (e?.message || '') }
  }
  const timeout = new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error('模型超时')), timeoutMs)
    if (typeof t.unref === 'function') t.unref()
  })
  try {
    await Promise.race([
      (async () => {
        for await (const chunk of stream) {
          const type = String((chunk && chunk.type) || '')
          // 思考过程永远不进 raw：它是给调试看的，不是能发出去的话（核查 R05）。
          if (/reasoning|thinking/i.test(type) && typeof chunk.text === 'string') {
            reasoningChars += chunk.text.length
          } else if (type === 'tool-call-delta' || (type === 'block-start' && chunk.blockType === 'tool-call')) {
            incomplete = 'tool-call'
          } else if (type === 'finish' && chunk.reason?.kind !== 'stop') {
            incomplete = 'incomplete-finish'
          } else {
            raw += pickText(chunk)
          }
        }
      })(),
      timeout,
    ])
  } catch (e) {
    return { text: '', why: 'timeout:' + (e?.message || '') }
  }
  // 2026-11-17（核查 R05）：这里原来是 (raw || reasoning) —— 模型只回一段思考时，
  // 思考文字会被当成正式回复写进待发箱。只有正式答案通道能成为外发文本；
  // 没有答案就如实说没有，交给上层按「不说」处理。
  if (incomplete) return { text: '', why: incomplete, raw: '' }
  const text = raw.trim()
  if (!text) {
    return { text: '', why: reasoningChars ? 'reasoning-only' : 'empty', raw: '', reasoningChars }
  }
  if (/^none$/i.test(text)) return { text: '', why: 'none', raw: text.slice(0, 60) }
  // 只留第一段（模型有时会带解释）
  return { text: text.split('\n').map((x) => x.trim()).filter(Boolean)[0]?.slice(0, 300) || '', why: '', raw: text.slice(0, 120) }
}

// 箱子名用**稳定的 job id**，不再用时间戳 + 随机数：
// 同一个源事件重放时，同名箱子已经在那儿，就不写第二份（发送端按 jobId 回执）。
// 注意 state 只表示 queued（已入箱），不等于 QQ 已收到。
function writeOutbox(dir, rec, text, jobId) {
  fs.mkdirSync(dir, { recursive: true })
  const name = jobId + '.json'
  const full = path.join(dir, name)
  if (fs.existsSync(full)) return { name, reused: true }
  const payload = { jobId, chatKey: rec.chatKey, text, state: 'queued', createdAt: new Date().toISOString() }
  const tmp = full + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, full)
  return { name, reused: false }
}

function writeDebug(dir, obj) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'interest-forward-debug.jsonl'), JSON.stringify(obj) + '\n', 'utf8')
  } catch { /* 调试落盘失败不影响主流程 */ }
}

/**
 * @param {object} opts
 * @param {any}    opts.llm         宿主模型服务（ctx.llm）
 * @param {string} opts.forwardFile live/interest-forward.jsonl
 * @param {string} opts.outboxDir   live/qq-outbox
 * @param {string} opts.doneFile    live/interest-forward-done.json
 * @param {string} [opts.system]    系统提示
 * @param {number} [opts.maxPerTick]
 */
export function createForwardConsumer(opts) {
  const { llm, forwardFile, outboxDir, doneFile } = opts
  const log = typeof opts.log === 'function' ? opts.log : () => {}
  const system = opts.system || ''
  const maxPerTick = Number(opts.maxPerTick) > 0 ? Number(opts.maxPerTick) : 2

  // 2026-11-17（核查 R06-1）：20 秒定时器不管上一轮跑没跑完。上一轮还在等模型时下一轮已经进来，
  // 两轮读到同一行 → 两次模型调用、两个箱子。这一条链自己要有一个执行中标记。
  let ticking = false
  const debugDir = path.dirname(doneFile)

  return {
    /** 跑一轮。返回 {handled, skipped, sent[], why?}。 */
    async tick() {
      if (ticking) return { handled: 0, skipped: 0, sent: [], why: 'busy' }
      ticking = true
      try {
        const state = readState(doneFile)
        const done = new Set(state.ids)
        let cursor = state.cursor
        const { rows, end, reset, buf } = readNew(forwardFile, cursor, state.prefix)
        if (reset) cursor = 0
        if (!rows.length) {
          // 只有空行/坏行时也要把游标推过去，否则每次 tick 都从头再扫一遍。
          if (end !== state.cursor) writeState(doneFile, { ids: [...done], cursor: end, prefix: prefixOf(buf, end) })
          return { handled: 0, skipped: 0, sent: [] }
        }

        // 已经记过的行先把游标推过去（游标重置后才会走到这儿）。
        const queue = []
        for (const e of rows) {
          if (done.has(idOf(e.rec))) cursor = Math.max(cursor, e.end)
          else queue.push(e)
        }
        if (!queue.length) {
          writeState(doneFile, { ids: [...done], cursor, prefix: prefixOf(buf, cursor) })
          return { handled: 0, skipped: 0, sent: [] }
        }

        // 路由只解析一次（每次 tick），解析不出来就整轮不调模型——游标不动，下一轮再试。
        const route = await resolveRoute(llm, opts.prefer || {})
        if (!route) {
          for (const e of queue.slice(0, maxPerTick)) {
            writeDebug(debugDir, { at: new Date().toISOString(), why: 'no-route', text: e.rec.text, group: e.rec.groupId })
          }
          return { handled: 0, skipped: 0, sent: [], why: 'no-route' }
        }
        log(`[interest-forward] 用 ${route.provider}/${route.model}`)

        let handled = 0
        let skipped = 0
        const sent = []
        for (const e of queue.slice(0, maxPerTick)) {
          const rec = e.rec
          const id = idOf(rec)
          const r = await collectOne(llm, buildPrompt(rec), { system, timeoutMs: opts.timeoutMs, route })
          if (r.text) {
            const w = writeOutbox(outboxDir, rec, r.text, id)
            sent.push({ id, chatKey: rec.chatKey, name: w.name, text: r.text, reused: w.reused })
            log(`[interest-forward] 回一句 → ${rec.chatKey}：${r.text.slice(0, 40)}`)
          } else {
            skipped += 1
            log(`[interest-forward] 不回（${r.why || '空'}）：${String(rec.text || '').slice(0, 30)}`)
            // 模型回 NONE 和「拿不到输出」要分得开，下次不用靠猜。
            writeDebug(debugDir, {
              at: new Date().toISOString(), why: r.why || 'empty', raw: r.raw || '', text: rec.text, group: rec.groupId,
            })
          }
          done.add(id)
          handled += 1
          cursor = Math.max(cursor, e.end)
          // 一条一记：中途崩掉，已经入箱/已经判过的不至于整轮再来一遍。
          writeState(doneFile, { ids: [...done], cursor, prefix: prefixOf(buf, cursor) })
        }
        return { handled, skipped, sent }
      } finally {
        ticking = false
      }
    },
  }
}
