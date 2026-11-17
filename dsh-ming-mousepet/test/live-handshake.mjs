// 真起一次 sidecar，验证握手在真实进程上成立（2026-11-09 11:5x）
// 用 clean 模式：不亮 overlay，不碰她的屏幕。

import { InputEngine } from '../lib/engine.js'

const logs = []
const engine = new InputEngine({
  log: (m) => { logs.push(String(m)); console.log('[log]', String(m)) },
  cursorMode: 'clean',
})

const t0 = Date.now()
try {
  await engine.start()
  console.log(`\n起来用了 ${Date.now() - t0} ms`)
  console.log('handshake =', JSON.stringify(engine.handshake, null, 2))
  console.log(`ok = ${engine.handshake?.ok}`)
  // 顺手确认一下真的能干活
  const s = await engine.request('status', {}, 10000)
  console.log('status.paused =', s?.paused, '· 光标', JSON.stringify(s?.cursor))
} catch (error) {
  console.log('✗ 启动失败：', error?.message || error)
  process.exitCode = 1
} finally {
  try { engine.stopProcess() } catch {}
  await new Promise((r) => setTimeout(r, 300))
  process.exit(process.exitCode || 0)
}
