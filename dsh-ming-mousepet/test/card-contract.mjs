/**
 * 卡片的契约测试（2026-11-09）。
 *
 * 自己起一个 sidecar（不是 DSH 里那只），只看「命令走通、窗口真的开起来了、尺寸对得上」。
 * 不截图、不比像素——像素那一关得她看。
 *
 * 判据：
 *   open      → ok + open=true + bounds 是个四段数字
 *   append    → 行数增加
 *   collapse  → collapsed=true 且高度掉到 32
 *   collapse 关 → 回到原来的高度
 *   close     → open=false
 */
import { InputEngine } from '../lib/engine.js'

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const engine = new InputEngine({
  log: (m) => { if (process.env.CARD_VERBOSE) console.log('[sidecar]', m) },
  onTap: () => {},
  onShake: () => {},
  onSelect: () => {},
  onWebPick: () => {},
})

const height = (bounds) => {
  const p = String(bounds || '').split(',').map(Number)
  return p.length === 4 ? p[3] : 0
}

try {
  await engine.ensure()

  const opened = await engine.request('card', { op: 'open', title: 'AI', x: 260, y: 240 }, 15000)
  check('开卡片', Boolean(opened?.ok && opened?.open), `bounds=${opened?.bounds}`)
  check('bounds 是四段数字', String(opened?.bounds || '').split(',').length === 4, opened?.bounds)
  const h1 = height(opened?.bounds)

  const a1 = await engine.request('card', { op: 'append', text: '第一行字。' }, 8000)
  const a2 = await engine.request('card', { op: 'append', text: '\n第二行字。' }, 8000)
  check('写进去有行', Number(a2?.lines) >= 1, `lines=${a2?.lines}`)
  check('写两次都在', Number(a2?.lines) >= Number(a1?.lines), `${a1?.lines} → ${a2?.lines}`)

  const c1 = await engine.request('card', { op: 'collapse', on: true }, 8000)
  check('收起', Boolean(c1?.collapsed), `bounds=${c1?.bounds}`)
  check('收起后高度 32', height(c1?.bounds) === 32, `h=${height(c1?.bounds)}`)

  const c2 = await engine.request('card', { op: 'collapse', on: false }, 8000)
  check('展开', c2?.collapsed === false, `bounds=${c2?.bounds}`)
  check('展开回到原高度', height(c2?.bounds) === h1, `${height(c2?.bounds)} vs ${h1}`)

  const st = await engine.request('card', { op: 'state' }, 8000)
  check('state 说开着', Boolean(st?.open), JSON.stringify(st))

  const closed = await engine.request('card', { op: 'close' }, 8000)
  check('关掉', closed?.open === false, JSON.stringify(closed))

  const after = await engine.request('card', { op: 'state' }, 8000)
  check('关掉后 state 是关', after?.open === false, JSON.stringify(after))
} catch (error) {
  check('跑完', false, error?.message || String(error))
} finally {
  try { await engine.request('card', { op: 'close' }, 5000) } catch { /* ignore */ }
  try { await engine.request('shutdown', {}, 3000) } catch { /* ignore */ }
  try { engine.dispose?.() } catch { /* ignore */ }
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 过`)
if (bad.length) process.exitCode = 1
