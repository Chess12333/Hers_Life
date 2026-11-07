/**
 * dsh-ming-wake —— 真会落盘的定时唤醒（2026-11-07）
 *
 * 诊断记录：
 *   14:40 apply 跑到了，但 `cannot get property "tools" without inject` —— Cordis 的服务必须先 inject。
 *   所以工具注册要包进 ctx.inject(['tools'], ...)，定时器包进 ctx.inject(['timer','agents'], ...)。
 * sessionId 由调用方显式给：execute 里拿不到 agents（那是另一个 inject 域）。
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export const name = 'ming-wake'

const DEFAULT_ROOT = 'C:\dsh\hers_workplace'
const TICK_MS = 15_000

function norm(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  return { root: typeof c.root === 'string' && c.root ? c.root : DEFAULT_ROOT }
}

export function apply(ctx, config) {
  const cfg = norm(config)
  const armPath = path.join(cfg.root, 'live', 'wake-arm.json')
  const logPath = path.join(cfg.root, 'live', 'wake-log.jsonl')

  const log = (obj) => {
    appendFile(logPath, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n', 'utf8').catch(() => {})
  }

  log({ kind: 'apply-started' })

  ctx.inject(['tools'], (tctx) => {
    tctx.effect(() => {
      try {
        const dispose = tctx.tools.register({
          name: 'ming_wake_arm',
          description: '排一次「几分钟后叫醒我」。写 live/wake-arm.json，插件每 15 秒扫一次，到点调 agents.resume。实验功能，要显式给 sessionId。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              minutes: { type: 'number', description: '几分钟后（0.5 = 30 秒）' },
              reason: { type: 'string', description: '醒来要干什么' },
              sessionId: { type: 'string', description: '要叫醒的会话 id（必填，插件拿不到当前会话）' },
            },
            required: ['minutes', 'reason'],
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
          async execute(args) {
            const minutes = Number(args && args.minutes)
            const reason = String((args && args.reason) || '').trim()
            const sid = String((args && args.sessionId) || process.env.DSH_SESSION_ID || '').trim()
            if (!Number.isFinite(minutes) || minutes <= 0) return 'minutes 得是正数。'
            if (!reason) return 'reason 不能空。'
            if (!sid) return '拿不到 sessionId（args 和 DSH_SESSION_ID 都是空的）。'
            const rec = { dueAt: Date.now() + Math.round(minutes * 60000), reason, sessionId: sid, armedAt: Date.now() }
            await mkdir(path.dirname(armPath), { recursive: true })
            await writeFile(armPath, JSON.stringify(rec, null, 2), 'utf8')
            log({ kind: 'armed', dueAt: rec.dueAt, sessionId: sid })
            return '已落盘：' + new Date(rec.dueAt).toLocaleString('zh-CN', { hour12: false }) + ' · ' + reason
          },
        })
        log({ kind: 'tool-registered' })
        return dispose
      } catch (e) {
        log({ kind: 'tool-register-failed', error: String((e && e.message) || e) })
      }
    })
  })

  ctx.inject(['timer', 'agents'], (sctx) => {
    sctx.effect(() => {
      log({ kind: 'timer-started' })
      const tick = async () => {
        let rec
        try { rec = JSON.parse(await readFile(armPath, 'utf8')) } catch { return }
        if (!rec || !rec.dueAt || rec.firedAt || Date.now() < rec.dueAt) return
        try { await writeFile(armPath, JSON.stringify({ ...rec, firedAt: Date.now() }), 'utf8') } catch {}
        if (!rec.sessionId) { log({ kind: 'skipped', why: 'no sessionId' }); return }
        try {
          await sctx.agents.resume({ resumeSessionId: rec.sessionId })
          log({ kind: 'resumed', target: rec.sessionId })
        } catch (e) {
          log({ kind: 'resume-failed', target: rec.sessionId, error: String((e && e.message) || e) })
        }
      }
      return sctx.timer.interval(() => { tick().catch(() => {}) }, TICK_MS)
    })
  })
}
