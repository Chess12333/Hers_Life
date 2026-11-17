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

const DONE_KEEP = 800

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

function readDone(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(j?.ids) ? j.ids : []
  } catch {
    return []
  }
}

function writeDone(file, ids) {
  const keep = ids.slice(-DONE_KEEP)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ ids: keep }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

function readForward(file) {
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return out
}

/**
 * 流里的文字不一定都叫 text-delta。桌宠的 talker 早就写了这层兜底，
 * 我第一版只认 text-delta，于是 raw 一直是空——实测 why:"empty"、raw:""。
 */
export function pickText(chunk) {
  if (!chunk || typeof chunk !== 'object') return ''
  if (typeof chunk.text === 'string') return chunk.text
  if (typeof chunk.delta === 'string') return chunk.delta
  if (chunk.delta && typeof chunk.delta.text === 'string') return chunk.delta.text
  if (typeof chunk.content === 'string') return chunk.content
  if (chunk.message && typeof chunk.message.content === 'string') return chunk.message.content
  return ''
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
  let reasoning = ''
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
          const type = chunk && chunk.type
          if (type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
          else if (type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning += chunk.text
          else {
            const extra = pickText(chunk)
            if (extra) raw += extra
          }
        }
      })(),
      timeout,
    ])
  } catch (e) {
    return { text: '', why: 'timeout:' + (e?.message || '') }
  }
  const text = (raw || reasoning || '').trim()
  if (!text) return { text: '', why: 'empty', raw: '' }
  if (/^none$/i.test(text)) return { text: '', why: 'none', raw: text.slice(0, 60) }
  // 只留第一段（模型有时会带解释）
  return { text: text.split('\n').map((x) => x.trim()).filter(Boolean)[0]?.slice(0, 300) || '', why: '', raw: text.slice(0, 120) }
}

function writeOutbox(dir, rec, text) {
  fs.mkdirSync(dir, { recursive: true })
  const name = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`
  const payload = { chatKey: rec.chatKey, text }
  const tmp = path.join(dir, name + '.tmp')
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, path.join(dir, name))
  return name
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

  return {
    /** 跑一轮。返回 {handled, skipped, sent[]}。 */
    async tick() {
      const rows = readForward(forwardFile)
      if (!rows.length) return { handled: 0, skipped: 0, sent: [] }
      const done = new Set(readDone(doneFile))
      const fresh = rows.filter((r) => !done.has(idOf(r)))
      if (!fresh.length) return { handled: 0, skipped: 0, sent: [] }

      // 路由只解析一次（每次 tick），解析不出来就整轮不调模型。
      const route = await resolveRoute(llm, opts.prefer || {})
      if (!route) {
        for (const rec of fresh.slice(0, maxPerTick)) {
          try {
            fs.appendFileSync(path.join(path.dirname(doneFile), 'interest-forward-debug.jsonl'),
              JSON.stringify({ at: new Date().toISOString(), why: 'no-route', text: rec.text, group: rec.groupId }) + '\n', 'utf8')
          } catch { /* ignore */ }
        }
        return { handled: 0, skipped: 0, sent: [], why: 'no-route' }
      }
      log(`[interest-forward] 用 ${route.provider}/${route.model}`)

      let handled = 0
      let skipped = 0
      const sent = []
      for (const rec of fresh.slice(0, maxPerTick)) {
        const id = idOf(rec)
        const r = await collectOne(llm, buildPrompt(rec), { system, timeoutMs: opts.timeoutMs, route })
        if (r.text) {
          const name = writeOutbox(outboxDir, rec, r.text)
          sent.push({ id, chatKey: rec.chatKey, name, text: r.text })
          log(`[interest-forward] 回一句 → ${rec.chatKey}：${r.text.slice(0, 40)}`)
        } else {
          skipped += 1
          log(`[interest-forward] 不回（${r.why || '空'}）：${String(rec.text || '').slice(0, 30)}`)
          // 2026-11-17：模型两次都回 NONE，看不出是「判断不接」还是「拿不到输出」。
          // 把原因落一行，下次不用靠猜。
          try {
            fs.appendFileSync(path.join(path.dirname(doneFile), 'interest-forward-debug.jsonl'),
              JSON.stringify({ at: new Date().toISOString(), why: r.why || 'empty', raw: r.raw || '', text: rec.text, group: rec.groupId }) + '\n', 'utf8')
          } catch { /* 调试落盘失败不影响 */ }
        }
        done.add(id)
        handled += 1
      }
      const ids = [...done]
      writeDone(doneFile, ids)
      return { handled, skipped, sent }
    },
  }
}
