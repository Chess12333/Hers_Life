// dsh-ming-interest/lib/inbox.mjs —— 入站事件的身份、归并与去重（交接书 E-3 / E.4 / E.5）
//
// 只做纯逻辑：读进来的行怎么合成「一条消息的最终状态」、哪些能当兴趣候选、状态放哪里。
// 不碰 AstrBot，不读配置，不自己开定时器——那些归 index.js。
//
// 三条硬规矩（都来自 E.4 / E.5）：
//   1. 身份来自平台消息 ID（platform + bot + 会话 + message_id），**不用正文哈希**：
//      同一个人发两次「在吗」是两条消息。
//   2. 状态只认显式字段：`normalHandling`。旧记录没这个字段时，**不把 decision.ok=false
//      自动升级成「没人回复」**——那只是旧格式的表达，含义不可信。
//   3. 超时不是「肯定没人回」：标 unknown，不自动补发。

const DAY = 24 * 60 * 60 * 1000

/** 去重键：跨会话不会撞，跨 bot 也不会被误合并（E.5-1 / E.5-3）。 */
export function keyOf(ev) {
  if (!ev) return ''
  const conv = ev.conversation || {}
  const convId = conv.id || ev.frame?.group_id || ev.frame?.user_id || ''
  const kind = conv.kind || ev.frame?.message_type || ''
  return [ev.platform || 'qq', ev.botAccountId || ev.frame?.self_id || '', kind, convId, ev.eventId || ''].join('|')
}

/**
 * 一条记录的身份构成，以及它**是否完整**。
 * 2026-11-17（核查 R04）：老回执只写了 eventId（没有 bot / 会话），
 * 按 keyOf 拼出来是 "qq|||id"，跟入站那条永远拼不到一起。
 * 这里把它标成「不完整」，归并时只在唯一可关联的情况下补进去。
 */
export function identityOf(ev) {
  const conv = ev?.conversation || {}
  const bot = ev?.botAccountId || ev?.frame?.self_id || ''
  const convId = conv.id || ev?.frame?.group_id || ev?.frame?.user_id || ''
  const kind = conv.kind || ev?.frame?.message_type || ''
  return { eventId: String(ev?.eventId || ''), bot, convId, kind, complete: !!(bot && convId && kind) }
}

/** 这条记录是不是 v2（有消息身份与处理状态）。 */
export function isV2(ev) {
  return !!ev && Number(ev.version) >= 2 && typeof ev.eventId === 'string' && ev.eventId !== ''
}

/** 归并后的最终状态：后到的 outcome 覆盖先到的 message。 */
const RANK = { pending: 0, claimed: 1, not_handled: 2, handled: 3, failed: 3, unknown: 3 }

/**
 * 把一串原始行归并成 Map<key, event>。
 * 返回 { events, bad, legacy }：
 *   events —— 每个 eventId 一条，带 status / 时间 / 原始帧
 *   bad    —— 解析失败的行数（E-T11：损坏行要报，不是静默跳过）
 *   legacy —— 没有 eventId 的旧记录条数（它们只能按帧用，不能参与去重）
 */
export function mergeEvents(lines) {
  const events = new Map()
  let bad = 0
  let legacy = 0
  const parsed = []
  for (const raw of lines) {
    if (!raw || !String(raw).trim()) continue
    let ev
    try { ev = JSON.parse(raw) } catch { bad++; continue }
    if (!isV2(ev)) { legacy++; continue }
    parsed.push(ev)
  }

  // 每条记录自己的 key + 身份是否完整；完整身份的 key 按 eventId 归档，
  // 给「只有 eventId 的老回执」找回它属于哪一条。
  const recs = parsed.map((ev) => ({ ev, key: keyOf(ev), id: identityOf(ev) }))
  const fullKeys = new Map()
  for (const r of recs) {
    if (!r.id.complete) continue
    if (!fullKeys.has(r.id.eventId)) fullKeys.set(r.id.eventId, new Set())
    fullKeys.get(r.id.eventId).add(r.key)
  }

  let orphan = 0
  for (const r of recs) {
    const ev = r.ev
    let key = r.key
    if (!r.id.complete) {
      const cands = fullKeys.get(r.id.eventId)
      // 唯一可关联才关联；两个 bot / 两个会话里有同名 id 时**不猜**——
      // 记成 orphan（未知归属），不新造一条半截事件把账搅浑。
      if (cands && cands.size === 1) key = [...cands][0]
      else { orphan++; continue }
    }
    const prev = events.get(key)
    const status = ev.kind === 'outcome' ? (ev.normalHandling || 'unknown') : (ev.normalHandling || 'pending')
    if (!prev) {
      events.set(key, { key, eventId: ev.eventId, status, first: ev.receivedAt || '', last: ev.receivedAt || '', frame: ev.frame || null, conversation: ev.conversation || null, senderId: ev.senderId || '' })
      continue
    }
    // 只让「更靠后」的状态覆盖，而且不因为一条迟到的 pending 把 handled 打回去。
    if ((RANK[status] ?? -1) >= (RANK[prev.status] ?? -1)) prev.status = status
    if (!prev.frame && ev.frame) prev.frame = ev.frame
  }
  return { events, bad, legacy, orphan }
}

/**
 * 这条能不能进兴趣候选（E.4：只有 not_handled 才该进）。
 * pending / claimed / handled / failed / unknown 一律不进——抢跑比漏一条更糟。
 */
export function isInterestCandidate(event) {
  if (!event) return false
  return event.status === 'not_handled'
}

/** 旧格式（没有 v2 字段）的记录：只有明确 `decision.ok === false && stage === 'message'` 才当候选。 */
export function isLegacyCandidate(obj) {
  if (!obj || obj.kind !== 'message') return false
  const d = obj.decision
  return !!d && d.ok === false && (d.stage === 'message' || d.stage === 'inbound')
}

/** 状态表的默认形状。 */
export function emptyState() {
  return { schemaVersion: 1, updatedAt: '', entries: {} }
}

/**
 * 清理状态表：按保留期和条数上限。
 * 只留 key / 状态 / 最后时间——不复制聊天正文（E.5-4）。
 */
export function pruneState(state, { keepMs = 7 * DAY, max = 5000, now = Date.now() } = {}) {
  const entries = state && state.entries && typeof state.entries === 'object' ? state.entries : {}
  const keep = []
  for (const [k, v] of Object.entries(entries)) {
    const t = Date.parse(v?.at || '') || 0
    if (t && now - t > keepMs) continue
    keep.push([k, { status: v?.status || 'unknown', at: v?.at || '' }])
  }
  keep.sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))
  const limited = keep.slice(0, max)
  return { schemaVersion: 1, updatedAt: new Date(now).toISOString(), entries: Object.fromEntries(limited) }
}

/** 记一次状态（幂等：同一状态重复写不改变结果）。 */
export function remember(state, key, status, at = new Date().toISOString()) {
  const next = state && state.entries ? state : emptyState()
  const prev = next.entries[key]
  if (prev && prev.status === status) return next
  next.entries[key] = { status, at }
  next.updatedAt = at
  return next
}

/** 已经处理过的（handled/claimed/failed/not_handled）就不再当新事件投递（E-T6）。 */
export function isSettled(status) {
  return status === 'handled' || status === 'claimed' || status === 'failed' || status === 'not_handled'
}
