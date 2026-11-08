/**
 * mousepet 的陪伴层：该不该开口。
 *
 * 2026-11-08 立。这个文件里没有一句话是"溟要说什么"——它只回答两件事：
 * 现在值不值得说一句，现在是什么情况。话由外面的我不知道的那部分决定，
 * 插件一旦自己编话，就会变成定时播报器。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const STATE_FILE = join(homedir(), '.dsh', 'ming-mousepet', 'pet-state.json')

const DEFAULTS = {
  lastSpokeAt: 0,
  lastLookAt: 0,
  spokenToday: { day: '', count: 0 },
  // 2026-11-08 她要的：自动开口的节奏自己调——心跳 / 随机 / 固定 / 关。
  gapMode: 'heartbeat',
  hbMin: 15,
  hbCenter: 30,
  hbMax: 60,
  minGapMinutes: 50,
  dailyMax: 6,
  nextAt: 0,
  // 宵禁开关（2026-11-08 她：「先把宵禁关了，我们先做测试看看」）。
  // 放 state 文件而不是插件 config：改 config 要重启 DSH，测试时不该为一次开关重启。
  quietHours: true,
}

export async function loadPetState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function savePetState(state) {
  try {
    await mkdir(dirname(STATE_FILE), { recursive: true })
    await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // 记不下来不该拦住说话。
  }
}

export function dayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 静音 00:30–10:30，跟 QQ 那边同一套作息。
export function inQuietHours(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes()
  return minutes >= 30 && minutes < 630
}

export function spokenToday(state, now = new Date()) {
  const key = dayKey(now)
  if (!state?.spokenToday || state.spokenToday.day !== key) return 0
  return Number(state.spokenToday.count) || 0
}

export function markSpoken(state, now = new Date()) {
  return {
    ...state,
    lastSpokeAt: now.getTime(),
    spokenToday: { day: dayKey(now), count: spokenToday(state, now) + 1 },
  }
}

const MIN_GAP_MS = 10 * 60 * 1000
const DAILY_CAP = 6
const QUIET_IDLE_MS = 25 * 60 * 1000
const LEAVE_MS = 30 * 60 * 1000

// 2026-11-08 她要测试：「现在测试吧，1分钟」。
// 阈值也跟宵禁一样放 state，改完立即生效——测试时不该为调一个数重启 DSH。
function num(state, key, fallback) {
  const v = Number(state?.[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// 2026-11-08：下一次多久之后再探一次。四种模式——
//   off        关，不排下一轮（留一分钟的复查，改回来自动恢复）
//   fixed      每 everyMin 分钟一次，不管前面说没说过
//   random     everyMin 的 0.5~1.5 倍之间随机
//   heartbeat  以 everyMin 为中位，0.35~1.6 倍，越靠中位越密（默认）
// 2026-11-08 15:03 她：「怎么不是做成这样」——参照「自己玩」那条：
// 限额 + 间隔模式（固定/随机/心跳/关）+ 最低/中位/最高 三个数。
export function schedGapMs(state, rand = Math.random) {
  const st = state || {}
  const mode = String(st.gapMode || (st.schedMode === 'off' ? 'off' : (st.schedMode || 'heartbeat')))
  const minutes = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  const single = Math.max(1, minutes(st.minGapMinutes ?? st.everyMin, 50)) * 60000
  if (mode === 'off') return 0
  if (mode === 'fixed') return Math.round(single)
  if (mode === 'random') return Math.round(single * (0.5 + rand()))
  const lo = Math.max(0.2, minutes(st.hbMin, 15)) * 60000
  const mid = Math.max(lo, minutes(st.hbCenter, 30) * 60000)
  const midM = Math.max(mid, minutes(st.hbCenter, 30) * 60000)
  const hi = Math.max(midM, minutes(st.hbMax, 60) * 60000)
  const u = rand()
  const f = (midM - lo) / Math.max(1, hi - lo)
  if (u < f) return Math.round(lo + Math.sqrt(u * (hi - lo) * (midM - lo)))
  return Math.round(hi - Math.sqrt((1 - u) * (hi - lo) * (hi - midM)))
}

export function judgeNudge({ now = new Date(), status, state } = {}) {
  const st = status || {}
  const idleMs = Number.isFinite(st.lastUserInputAgeMs) ? st.lastUserInputAgeMs : null
  const sinceLastSpokeMin = state?.lastSpokeAt
    ? Math.round((now.getTime() - state.lastSpokeAt) / 60000)
    : null
  const context = {
    at: now.toISOString(),
    foreground: st.foreground?.title || null,
    process: st.foreground?.process || null,
    idleMs,
    idleMin: idleMs === null ? null : Math.round(idleMs / 60000),
    paused: Boolean(st.paused),
    spokenToday: spokenToday(state, now),
    sinceLastSpokeMin,
  }

  if (state?.quietHours !== false && inQuietHours(now)) {
    return { speak: false, why: '静音时段 00:30–10:30（要关：pet config quietHours:false）', context }
  }
  if (st.paused) return { speak: false, why: '她按了暂停，别出声', context }
  const minGapMs = num(state, 'minGapMs', MIN_GAP_MS)
  const leaveMs = num(state, 'leaveAfterMs', LEAVE_MS)

  if (sinceLastSpokeMin !== null && sinceLastSpokeMin * 60000 < minGapMs) {
    return { speak: false, why: `刚说过话（${sinceLastSpokeMin} 分钟前），还没到间隔`, context }
  }
  // 2026-11-08：dailyMax 优先（自己玩那边也叫这个名），老字段 dailyCap 留着兼容。
  const dailyMaxRaw = Number(state?.dailyMax)
  const cap = Number.isFinite(dailyMaxRaw) && dailyMaxRaw >= 0 ? dailyMaxRaw : num(state, 'dailyCap', DAILY_CAP)
  if (cap >= 0 && context.spokenToday >= cap) {
    return { speak: false, why: `今天已经说了 ${context.spokenToday} 次（上限 ${cap}），够了`, context }
  }
  // 2026-11-08 她改的：「不用等安静满，只要在桌面就可以等」。
  // 所以这里不再要求她静止，只排除「人根本不在」——半小时没动就算离开了。
  if (idleMs !== null && idleMs > leaveMs) {
    return { speak: false, why: `她 ${Math.round(idleMs / 60000)} 分钟没动了，多半不在桌边`, context }
  }
  return {
    speak: true,
    why: idleMs === null ? '人在桌边（读不到空闲时长）' : `人在桌边，最近 ${Math.max(1, Math.round(idleMs / 1000))} 秒内动过`,
    context,
  }
}
