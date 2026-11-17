// dsh-ming-interest/qa-inbox.mjs —— E-3 离线验收：身份、归并、去重、候选
//
// 对应交接书的 E-T4 / E-T6 / E-T7 / E-T11，以及 E.7「旧记录不自动升级」。
// 全部合成数据，不读真实 inbox。
import {
  keyOf, isV2, mergeEvents, isInterestCandidate, isLegacyCandidate,
  emptyState, remember, pruneState, isSettled,
} from './lib/inbox.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const ev = (id, over = {}) => JSON.stringify({
  version: 2, eventId: id, platform: 'qq', botAccountId: 'bot-1',
  conversation: { kind: 'group', id: 'g1' }, senderId: 'u1',
  sourceKind: 'user', receivedAt: '2026-11-17T04:00:00',
  normalHandling: 'pending', kind: 'message', frame: { message: [{ type: 'text', data: { text: '在吗' } }] },
  ...over,
})
const outcome = (id, status, over = {}) => JSON.stringify({
  version: 2, kind: 'outcome', eventId: id, platform: 'qq', botAccountId: 'bot-1',
  conversation: { kind: 'group', id: 'g1' }, normalHandling: status,
  outcome: { at: '2026-11-17T04:00:01' }, ...over,
})

// --- 身份 ---
const a = JSON.parse(ev('m1'))
ok('v2 记录认得出', isV2(a))
ok('旧格式认不出（不当 v2）', !isV2({ kind: 'message', decision: { ok: false } }))
ok('key 含 bot 和会话（跨 bot 不会撞）', keyOf({ ...a, botAccountId: 'bot-2' }) !== keyOf(a))
ok('同文不同 ID → 两个 key', keyOf({ ...a, eventId: 'm2' }) !== keyOf(a))
ok('同 ID 不同会话 → 两个 key', keyOf({ ...a, conversation: { kind: 'group', id: 'g2' } }) !== keyOf(a))

// --- E-T4：pending → claimed → handled，不许进兴趣候选 ---
{
  const r = mergeEvents([ev('m1'), outcome('m1', 'claimed')])
  ok('E-T4 claimed 后不是候选', r.events.size === 1 && !isInterestCandidate([...r.events.values()][0]))
  const r2 = mergeEvents([ev('m1'), outcome('m1', 'claimed'), outcome('m1', 'handled')])
  const e = [...r2.events.values()][0]
  ok('E-T4 handled 是最新状态', e.status === 'handled')
  ok('E-T4 handled 不进候选', !isInterestCandidate(e))
}
// 迟到的 pending 不能把 handled 打回去
{
  const r = mergeEvents([ev('m1'), outcome('m1', 'handled'), ev('m1')])
  ok('E-T4 迟到 pending 不降级', [...r.events.values()][0].status === 'handled')
}

// --- E-T5 前提：明确 not_handled 才是候选 ---
{
  const r = mergeEvents([ev('m1'), outcome('m1', 'not_handled')])
  ok('E-T5 not_handled 进候选', isInterestCandidate([...r.events.values()][0]))
  const r2 = mergeEvents([ev('m1'), outcome('m1', 'unknown')])
  ok('超时 unknown 不进候选（不自动补发）', !isInterestCandidate([...r2.events.values()][0]))
}

// --- E-T7：同文不同 ID / 同 ID 不同会话 ---
{
  const r = mergeEvents([ev('m1'), ev('m2')])
  ok('E-T7 同文不同 ID 留两条', r.events.size === 2)
  const r2 = mergeEvents([ev('m1'), ev('m1', { conversation: { kind: 'group', id: 'g2' } })])
  ok('E-T7 同 ID 不同会话留两条', r2.events.size === 2)
}

// --- E-T6：重复写入同一事件，状态表说「已处理就不再投递」---
{
  let st = emptyState()
  const key = keyOf(a)
  st = remember(st, key, 'handled', '2026-11-17T04:00:02')
  ok('E-T6 handled 记为已结算', isSettled(st.entries[key].status))
  const again = remember(st, key, 'handled', '2026-11-17T05:00:00')
  ok('E-T6 重复记同一状态不改时间（幂等）', again.entries[key].at === '2026-11-17T04:00:02')
  ok('E-T6 未处理的不是已结算', !isSettled('pending'))
}

// --- E-T11：损坏行要报出来 ---
{
  const r = mergeEvents([ev('m1'), '{"broken":', ev('m2')])
  ok('E-T11 损坏行计数', r.bad === 1)
  ok('E-T11 好行不丢', r.events.size === 2)
}

// --- E.7：旧记录不自动升级成「没人回复」---
{
  const legacy = { kind: 'message', decision: { ok: false, stage: 'inbound' } }
  const r = mergeEvents([JSON.stringify(legacy)])
  ok('E.7 旧记录不计入 v2 归并', r.events.size === 0 && r.legacy === 1)
  ok('E.7 旧记录也不会被当成已确认候选（要显式 stage）', isLegacyCandidate(legacy) === true)
  ok('E.7 旧记录缺 stage 不当候选', isLegacyCandidate({ kind: 'message', decision: { ok: false } }) === false)
}

// --- 状态表：保留期与上限，只存 ID/状态/时间 ---
{
  const now = Date.parse('2026-11-17T12:00:00')
  let st = emptyState()
  st = remember(st, 'k-new', 'handled', '2026-11-17T11:00:00')
  st = remember(st, 'k-old', 'handled', '2026-11-01T11:00:00')
  const pruned = pruneState(st, { keepMs: 7 * 24 * 60 * 60 * 1000, max: 100, now })
  ok('过了保留期的被清掉', !pruned.entries['k-old'])
  ok('新的留着', !!pruned.entries['k-new'])
  ok('只存 status/at（不复制正文）', Object.keys(pruned.entries['k-new']).sort().join(',') === 'at,status')
  let many = emptyState()
  for (let i = 0; i < 20; i++) many = remember(many, 'k' + i, 'handled', '2026-11-17T11:' + String(i).padStart(2, '0') + ':00')
  ok('上限截断', Object.keys(pruneState(many, { max: 5, now }).entries).length === 5)
}

// --- R04：回执与入站必须是同一份身份 ---
{
  // 生产者现在的形状：入站带平台/bot/会话，claimed/handled 也带同一份。
  const good = [
    ev('m-1'),
    JSON.stringify({
      version: 2, kind: 'outcome', eventId: 'm-1', platform: 'qq', botAccountId: 'bot-1',
      conversation: { kind: 'group', id: 'g1' }, senderId: 'u1', normalHandling: 'claimed',
    }),
    JSON.stringify({
      version: 2, kind: 'outcome', eventId: 'm-1', platform: 'qq', botAccountId: 'bot-1',
      conversation: { kind: 'group', id: 'g1' }, senderId: 'u1', normalHandling: 'handled',
    }),
  ]
  const r = mergeEvents(good)
  ok('R04 完整身份 pending→claimed→handled 归并成一条', r.events.size === 1, String(r.events.size))
  ok('R04 最终状态是 handled', [...r.events.values()][0].status === 'handled')

  // 老回执只有 eventId：能在唯一可关联时补进去，找不到就单列（不猜）。
  const legacyReceipt = [
    ev('m-2'),
    JSON.stringify({ version: 2, kind: 'outcome', eventId: 'm-2', platform: 'qq', normalHandling: 'handled' }),
  ]
  const r2 = mergeEvents(legacyReceipt)
  ok('R04 只有 eventId 的老回执照样归到同一条', r2.events.size === 1, String(r2.events.size))
  ok('R04 迟到 pending 不把 handled 打回去', [...r2.events.values()][0].status === 'handled')

  // 两个 bot 里有同名 message_id：不合并。
  const twoBots = [
    ev('m-3'),
    JSON.stringify({
      version: 2, kind: 'message', eventId: 'm-3', platform: 'qq', botAccountId: 'bot-2',
      conversation: { kind: 'group', id: 'g1' }, senderId: 'u1', normalHandling: 'pending',
    }),
    JSON.stringify({ version: 2, kind: 'outcome', eventId: 'm-3', platform: 'qq', normalHandling: 'handled' }),
  ]
  const r3 = mergeEvents(twoBots)
  ok('R04 两个 bot 同 message_id 不误合并', r3.events.size === 2, String(r3.events.size))
  ok('R04 归属不明如实记 orphan，不硬塞', r3.orphan === 1, String(r3.orphan))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
