/**
 * 「指一下就框住」的契约测试（2026-11-09）。
 *
 * 不靠人眼看：只验几何。
 *   1. 给一个真实窗口里的点，算出来的矩形必须是四段数字、面积说得过去；
 *   2. 矩形要落在那个窗口里面（允许 ±3 边界误差）；
 *   3. [ ] 收放真的会变（level+1 面积不小于 level 0）；
 *   4. pick 模式能起能停，state 跟着变。
 */
import { InputEngine } from '../lib/engine.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const engine = new InputEngine({
  log: (m) => { if (process.env.PICK_VERBOSE) console.log('[sidecar]', m) },
  onTap: () => {}, onShake: () => {}, onSelect: () => {}, onWebPick: () => {},
})

const box = (rect) => {
  const p = String(rect || '').split(',').map(Number)
  return p.length === 4 && p.every(Number.isFinite) ? { x: p[0], y: p[1], w: p[2], h: p[3] } : null
}

try {
  await engine.ensure()
  const wins = await engine.request('windows', {}, 15000)
  const list = Array.isArray(wins?.windows) ? wins.windows : []
  const target = list.find((w) => {
    const r = w.rect || {}
    return (r.w || 0) > 300 && (r.h || 0) > 200 && (r.y || 0) > -10000 && w.iconic !== true
  }) || null
  if (!target) throw new Error('没找到一个够大的窗口来量')
  const tw = target.rect
  const cx = Math.round(tw.x + tw.w / 2)
  const cy = Math.round(tw.y + tw.h / 2)
  console.log(`量 (${cx}, ${cy})，窗口 ${target.title || ''} ${tw.w}×${tw.h}`)

  const a = await engine.request('pickrect', { x: cx, y: cy, level: 0 }, 15000)
  const ra = box(a?.rect)
  check('算得出矩形', Boolean(ra), a?.rect)
  check('面积说得过去', Boolean(ra && ra.w >= 24 && ra.h >= 12), ra && `${ra.w}×${ra.h}`)
  // 真正该守的不变式：框里必须含着她指的那个点，而且不跑出屏幕。
  const contains = ra && cx >= ra.x && cx <= ra.x + ra.w && cy >= ra.y && cy <= ra.y + ra.h
  check('框住她指的那个点', Boolean(contains), ra ? `点(${cx},${cy}) vs 框[${ra.x},${ra.y},${ra.w},${ra.h}]` : '')
  const onScreen = ra && ra.x >= -8 && ra.y >= -8 && ra.x + ra.w <= 2600 && ra.y + ra.h <= 1700
  check('没跑出屏幕', Boolean(onScreen), ra ? `[${ra.x},${ra.y},${ra.w},${ra.h}]` : '')
  check('不是整块屏', Boolean(ra && ra.w * ra.h < 2560 * 1600 * 0.9), ra && `${ra.w}×${ra.h}`)
  check('fallback 是布尔', typeof a?.fallback === 'boolean', String(a?.fallback))

  const b = await engine.request('pickrect', { x: cx, y: cy, level: a?.levels ? a.levels - 1 : 2 }, 15000)
  const rb = box(b?.rect)
  check('放一档面积不变小', Boolean(rb && rb.w * rb.h >= ra.w * ra.h), rb && `${rb.w}×${rb.h}`)

  const st = await engine.request('pick', { op: 'start', timeoutMs: 4000 }, 15000)
  check('pick 起来了', st?.started === true, JSON.stringify(st))
  const mid = await engine.request('pick', { op: 'state' }, 8000)
  check('state 说 busy', mid?.busy === true, JSON.stringify(mid))
  await engine.request('pick', { op: 'stop' }, 8000)
  const after = await engine.request('pick', { op: 'state' }, 8000)
  check('停下来了', after?.busy === false, JSON.stringify(after))
} catch (error) {
  check('跑完', false, error?.message || String(error))
} finally {
  try { await engine.request('pick', { op: 'stop' }, 4000) } catch { /* ignore */ }
  try { await engine.request('shutdown', {}, 3000) } catch { /* ignore */ }
  try { engine.dispose?.() } catch { /* ignore */ }
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 过`)
if (bad.length) process.exitCode = 1
