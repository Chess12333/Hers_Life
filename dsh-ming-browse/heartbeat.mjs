/**
 * heartbeat.mjs —— 心跳间隔（2026-11-08 她定的）
 *
 * 她原话：「心跳区间是最短 5 分钟到最长 4 小时哦，但是距离 30 越远概率越低，
 * 虽然你可以自己决定就是了」；随后补了「要不可以自己设置心跳最低值/中位值/最大值？」。
 * 所以三个数都从配置来：hbMin / hbCenter / hbMax（分钟）。
 *
 * 形状：center 是峰，两边按**分钟距离**指数衰减——
 *   左边衰减快（短的一侧不给太多），右边衰减慢（允许偶尔睡久一点）。
 *   λ 不写死，跟着三个数走：λ_lo = (center-min)/2.3，λ_hi = (max-center)/4.6。
 *   默认 5 / 30 / 240 代入就是 11 和 45.6——也就是原来手调的那两个值。
 *   她改端点时形状跟着伸缩，不用再给她一个「衰减参数」。
 *
 * 为什么不用对数正态：它的中位数在 center，但按分钟算的密度峰在更低处，
 * 也就是「10 分钟比 30 分钟更常见」——跟「离 center 越远越低」正好反过来。
 *
 * 这只是**默认那一抽**。我自己排的点（self-wake）优先，排了就不抽。
 */

export const HB_DEFAULTS = { min: 5, center: 30, max: 240 }
export const HB_HARD_MIN = 1
export const HB_HARD_MAX = 1440

/** 把三个数收敛到合法区间：1 ≤ min < center < max ≤ 1440 */
export function normalizeHb(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const num = (v) => (v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)
  const raw = { min: num(o.min), center: num(o.center), max: num(o.max) }
  // 三个都给全了却互相矛盾（比如 min>center、全相等）→ 当没配对，用默认。
  // 不然会挤出 30/31/32 这种一分钟宽的带，看着合法、其实没意义。
  if (raw.min !== null && raw.center !== null && raw.max !== null
    && !(raw.min < raw.center && raw.center < raw.max)) {
    return { ...HB_DEFAULTS }
  }
  const min = Math.min(HB_HARD_MAX - 2, Math.max(HB_HARD_MIN, raw.min !== null ? raw.min : HB_DEFAULTS.min))
  const max = Math.min(HB_HARD_MAX, Math.max(min + 2, raw.max !== null ? raw.max : HB_DEFAULTS.max))
  const center = Math.min(max - 1, Math.max(min + 1, raw.center !== null ? raw.center : HB_DEFAULTS.center))
  return { min, center, max }
}

const expInt = (lambda, span) => lambda * (1 - Math.exp(-span / lambda))

/** 截断指数：d ∈ [0, span]，密度 ∝ exp(-d/λ)。返回 d */
function truncExp(lambda, span, u) {
  return -lambda * Math.log(1 - u * (1 - Math.exp(-span / lambda)))
}

/** 抽一个间隔（分钟，整数）。opts = {min, center, max}；rand 可注入 */
export function drawHeartbeatMinutes(opts = HB_DEFAULTS, rand = Math.random) {
  const { min, center, max } = normalizeHb(opts)
  const spanLo = center - min
  const spanHi = max - center
  const lamLo = Math.max(0.5, spanLo / 2.3)
  const lamHi = Math.max(0.5, spanHi / 4.6)
  const iLo = expInt(lamLo, spanLo)
  const iHi = expInt(lamHi, spanHi)
  const pLo = iLo / (iLo + iHi)
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rand()))
  const x = rand() < pLo
    ? center - truncExp(lamLo, spanLo, u)
    : center + truncExp(lamHi, spanHi, u)
  return Math.min(max, Math.max(min, Math.round(x)))
}
