// 真机验 base 收敛没改坏（2026-11-09 12:0x）
// 两步：① overlay show 到 A（走 SetBase("place")）② glide 到 B（走 SetBase("glide")）。
// 会短暂在她屏幕上出现 AI 光标，测完立刻 hide。

import { InputEngine } from '../lib/engine.js'

const engine = new InputEngine({ log: (m) => console.log('[log]', String(m)), cursorMode: 'clean' })
let failed = 0
const check = (name, ok, extra = '') => {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? `　${extra}` : ''}`)
}
const now = async () => {
  const s = await engine.request('status', {}, 8000)
  // 注意：status.cursor 是**真实鼠标**的位置，AI 光标在 cursorOverlay 里。
  return {
    x: s?.cursorOverlay?.x ?? -1,
    y: s?.cursorOverlay?.y ?? -1,
    visible: s?.overlay,
    hasLast: s?.cursorOverlay?.hasLast,
  }
}

try {
  await engine.start()
  const start = await now()
  console.log(`起点 ${start.x},${start.y}`)

  // ① place：放到 A，读回来
  const A = { x: Math.max(50, start.x - 200), y: Math.max(50, start.y - 100) }
  await engine.request('overlay', { show: true, x: A.x, y: A.y }, 8000)
  await new Promise((r) => setTimeout(r, 500))
  const atA = await now()
  console.log(`place 到 ${A.x},${A.y} → 实测 ${atA.x},${atA.y}`)
  check('place 落到目标（±8px）', Math.abs(atA.x - A.x) <= 8 && Math.abs(atA.y - A.y) <= 8)

  // ② glide：滑到 B
  const B = { x: Math.min(A.x + 300, 2400), y: A.y }
  await engine.request('glide', { x: B.x, y: B.y, ms: 600 }, 8000)
  await new Promise((r) => setTimeout(r, 1500))
  const atB = await now()
  console.log(`glide 到 ${B.x},${B.y} → 实测 ${atB.x},${atB.y}`)
  check('glide 滑到目标（±8px）', Math.abs(atB.x - B.x) <= 8 && Math.abs(atB.y - B.y) <= 8)
} catch (error) {
  console.log('✗ 出错：', error?.message || error)
  failed++
} finally {
  try { await engine.request('overlay', { show: false }, 5000) } catch {}
  try { engine.stopProcess() } catch {}
  await new Promise((r) => setTimeout(r, 300))
  console.log(failed === 0 ? '\n通过' : `\n${failed} 项没过`)
  process.exit(failed === 0 ? 0 : 1)
}
