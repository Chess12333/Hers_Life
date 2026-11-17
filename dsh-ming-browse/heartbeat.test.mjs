/**
 * heartbeat.test.mjs —— 验心跳间隔的分布（2026-11-08）
 * 判据：① 不低于最低 ② 不高于最高 ③ 离中位越远越低（按每分钟密度量）
 * 另外验她自己可调的三个数：改端点，形状跟着伸缩，不靠第二个衰减参数。
 */
import { drawHeartbeatMinutes, normalizeHb, HB_DEFAULTS } from './heartbeat.mjs'

let bad = 0
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++ }

function sample(opts, n = 100000) {
  const xs = new Array(n)
  for (let i = 0; i < n; i++) xs[i] = drawHeartbeatMinutes(opts)
  return xs
}

function report(label, opts) {
  const xs = sample(opts)
  const s = xs.slice().sort((a, b) => a - b)
  const q = (p) => s[Math.floor(p * (s.length - 1))]
  const dens = (a, b) => xs.filter((x) => x >= a && x < b).length / (b - a)
  const { min, center, max } = normalizeHb(opts)
  console.log('\n[' + label + '] ' + min + ' / ' + center + ' / ' + max
    + ' → min=' + s[0] + ' p10=' + q(0.1) + ' 中位=' + q(0.5) + ' p90=' + q(0.9) + ' max=' + s[s.length - 1])
  ok(s[0] >= min, '不短于最低 ' + min)
  ok(s[s.length - 1] <= max, '不长于最高 ' + max)
  const lo = Math.max(min, center - 10), hi = Math.min(max, center + 10)
  const near = dens(lo, hi)
  const tailLo = dens(min, Math.min(center - 1, min + 3))
  const tailHi = dens(Math.min(max - 2, center + 30), max + 1)
  console.log('  密度：中位带=' + near.toFixed(0) + '  最低端=' + tailLo.toFixed(0) + '  最高端=' + tailHi.toFixed(0))
  ok(near > tailLo || center - min <= 6, '中位一带比最低那一段密')
  ok(near > tailHi || max - center <= 6, '中位一带比最高那一段密')
}

report('默认 5/30/240', HB_DEFAULTS)
report('自定义 10/20/90', { min: 10, center: 20, max: 90 })
report('自定义 2/8/30', { min: 2, center: 8, max: 30 })

// 越界与矛盾输入：不抛、收敛成合法三元组
console.log('\n[收敛]')
const cases = [
  [{ min: 30, center: 10, max: 5 }, '三个数全反着给'],
  [{ min: -5, center: 0, max: 0 }, '负数'],
  [{ min: 5, center: 5, max: 5 }, '全相等'],
  [{ min: 5000, center: 9000, max: 20000 }, '超上限'],
  [{ min: 5, center: 30 }, '只给两个（缺最高）'],
]
for (const [inp, why] of cases) {
  const n = normalizeHb(inp)
  const sane = n.min >= 1 && n.min < n.center && n.center < n.max && n.max <= 1440
  console.log('  ' + why + ' → ' + JSON.stringify(n))
  ok(sane, why + ' 收敛成 1 ≤ min < center < max ≤ 1440')
}
for (const [inp] of cases) {
  const { min, max } = normalizeHb(inp)
  const xs = sample(inp, 2000)
  ok(xs.every((x) => x >= min && x <= max), '极端输入下抽出来的仍在范围内')
}

console.log('\n' + (bad ? bad + ' 项没过' : '全部通过'))
process.exit(bad ? 1 : 0)
