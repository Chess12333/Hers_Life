import { InputEngine } from '../lib/engine.js'

const engine = new InputEngine({
  log: (m) => console.log('[log]', m),
  onShake: async (evt) => {
    console.log('[shake]', JSON.stringify(evt), new Date().toISOString())
    try {
      const mv = await engine.request('move', { x: evt.x, y: evt.y }, 8000)
      console.log('[move]', JSON.stringify(mv).slice(0, 200))
      const st = await engine.request('status', {}, 8000)
      const title = st?.foreground?.title || ''
      console.log('[fg]', title)
      const said = await engine.request('say', { text: (title || '这块？').slice(0, 16), x: evt.x, y: evt.y, ms: 2600 }, 8000)
      console.log('[say]', JSON.stringify(said).slice(0, 200))
    } catch (e) {
      console.log('[error]', e?.message || String(e))
    }
  },
})
await engine.start()
console.log('[ready]', JSON.stringify(engine.handshake))
setTimeout(async () => {
  try { await engine.stop() } catch {}
  process.exit(0)
}, 26000)
