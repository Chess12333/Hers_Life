/**
 * dsh-ming-wake —— 真会落盘的定时唤醒（2026-11-07）
 *
 * 诊断记录：
 *   14:40 apply 跑到了，但 `cannot get property "tools" without inject` —— Cordis 的服务必须先 inject。
 *   所以工具注册要包进 ctx.inject(['tools'], ...)，定时器包进 ctx.inject(['timer','agents'], ...)。
 * sessionId 由调用方显式给：execute 里拿不到 agents（那是另一个 inject 域）。
 *
 * 2026-11-12 00:0x 改成**队列**。
 * 起因：读 not-zai/self-nudge 的 README，它写「把所有到点的全删掉、只响第一个」
 * 这个 bug 在真实项目里活了很久——三条同时到点只投一条，另两条静默吃掉。
 * 我这边原来是**单个对象**，排第二次直接覆盖第一次，同一个洞的另一面。
 * 现在 live/wake-arm.json 是 { items: [...] }；读的时候兼容旧的单条格式。
 */
import { readFile, writeFile, appendFile, mkdir, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export const name = 'ming-wake'

// 正斜杠：Windows 的路径 API 认，而且不用数转义。
// 原来这里写成单反斜杠 '\d'、'\h'、'\w' 都不是有效转义，JS 会把反斜杠吞掉，
// 这个常量实际是 'C:dsh工作区'（19 字符）——一个不存在的路径。
// 2026-11-08 安菲（卡米安菲家的工程师）把它单独 eval 了一遍抓出来的；
// 三个兄弟包（voice / browse / skill-isolate）写的都是双反斜杠，只有这里漏了。
const DEFAULT_ROOT = '<workspace>'
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

  // Single-process mutation queue: never hold it while calling agents.resume.
  let mutations = Promise.resolve()
  const mutate = (fn) => {
    const result = mutations.then(fn)
    mutations = result.catch(() => {})
    return result
  }

  // 读：新版是 { items: [] }；旧版是单个对象 —— 包成一条，别把人之前排的那次黑了。
  const loadItems = async () => {
    let raw
    try {
      raw = JSON.parse(await readFile(armPath, 'utf8'))
    } catch {
      return []
    }
    if (raw && Array.isArray(raw.items)) return raw.items
    if (raw && (raw.armId || raw.dueAt)) return [raw]
    return []
  }

  const saveItems = async (items) => {
    const tmp = armPath + '.' + randomUUID() + '.tmp'
    const body = { updatedAt: new Date().toISOString(), items }
    try {
      await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
      await rename(tmp, armPath)
    } finally {
      await unlink(tmp).catch(() => {})
    }
  }

  // 队里还剩几条未来的（给回执用）
  const pendingCount = (items) =>
    items.filter((it) => it && it.status === 'armed' && it.dueAt && it.dueAt > Date.now()).length

  log({ kind: 'apply-started' })

  ctx.inject(['tools'], (tctx) => {
    tctx.effect(() => {
      try {
        const dispose = tctx.tools.register({
          name: 'ming_wake_arm',
          description:
            '排一次「几分钟后叫醒我」，追加进 live/wake-arm.json 的队列（不是覆盖）。'
            + '插件每 15 秒扫一次，到点调 agents.resume。'
            + '**只叫醒，不说话**——醒来看到的是宿主给的通用提示，想留话就自己写进 live/ 里。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              minutes: { type: 'number', description: '几分钟后（0.5 = 30 秒）' },
              reason: { type: 'string', description: '醒来要干什么（自己看，宿主不会转述给模型）' },
              sessionId: { type: 'string', description: '要叫醒的会话 id（必填，插件拿不到当前会话）' },
            },
            required: ['minutes', 'reason'],
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
          async execute(args) {
            const minutes = Number(args && args.minutes)
            const reason = String((args && args.reason) || '').trim()
            // 这里原来还有 `|| process.env.DSH_SESSION_ID` 兜底，是个死分支：
            // 宿主确实会注入 DSH_SESSION_ID，但只注进 **shell 执行环境**（dsh-shell-env
            // 每次执行时构造 values 传给子进程），插件跑在主进程里，process.env 上没有它。
            // 2026-11-08 查 dsh-shell-env/lib/index.js:89 确认。留着只会让人以为有兜底。
            const sid = String((args && args.sessionId) || '').trim()
            if (!Number.isFinite(minutes) || minutes <= 0) return 'minutes 得是正数。'
            if (!reason) return 'reason 不能空。'
            if (!sid) return '拿不到 sessionId（args 和 DSH_SESSION_ID 都是空的）。'
            const rec = {
              armId: randomUUID(),
              status: 'armed',
              dueAt: Date.now() + Math.round(minutes * 60000),
              reason,
              sessionId: sid,
              armedAt: Date.now(),
            }
            let ahead = 0
            await mutate(async () => {
              await mkdir(path.dirname(armPath), { recursive: true })
              const items = await loadItems()
              items.push(rec)
              await saveItems(items)
              ahead = pendingCount(items) - 1
            })
            log({ kind: 'armed', dueAt: rec.dueAt, sessionId: sid, ahead })
            const when = new Date(rec.dueAt).toLocaleString('zh-CN', { hour12: false })
            return '已落盘：' + when + ' · ' + reason + (ahead > 0 ? `（队里还有 ${ahead} 条排在它前面）` : '')
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
      let running = false
      const tick = async () => {
        if (running) return
        running = true
        try {
          // 一拍只取一条到点的（最早那条），其余留着 —— 这是旧版「全删只响一个」的修法。
          // 中断的 attempting 标 unknown 但**不挡别人**，其余到点的照常轮得到。
          const due = await mutate(async () => {
            const items = await loadItems()
            if (!items.length) return null
            let changed = false
            for (const it of items) {
              if (it && it.status === 'attempting') {
                it.status = 'unknown'
                it.error = 'Interrupted attempt; inspect before manually re-arming.'
                changed = true
              }
            }
            const now = Date.now()
            const ready = items
              .filter((it) => it && it.status === 'armed' && it.dueAt && it.sessionId && now >= it.dueAt)
              .sort((a, b) => a.dueAt - b.dueAt)[0]
            if (ready) {
              ready.status = 'attempting'
              ready.armId = ready.armId || randomUUID()
              ready.attemptedAt = now
              changed = true
            }
            if (changed) await saveItems(items)
            return ready || null
          })
          if (!due) return
          let outcome
          try {
            await sctx.agents.resume({ resumeSessionId: due.sessionId })
            outcome = { status: 'fired', firedAt: Date.now() }
            log({ kind: 'resumed', target: due.sessionId, armId: due.armId })
          } catch (e) {
            // A thrown call does not prove the remote action did not happen.
            outcome = { status: 'unknown', error: String((e && e.message) || e) }
            log({ kind: 'resume-unknown', target: due.sessionId, armId: due.armId })
          }
          await mutate(async () => {
            const items = await loadItems()
            const it = items.find((x) => x && x.armId === due.armId)
            if (it) {
              Object.assign(it, outcome)
              await saveItems(items)
            }
          })
        } finally {
          running = false
        }
      }
      return sctx.timer.interval(() => tick().catch(() => {}), TICK_MS)
    })
  })
}
