import { InputEngine } from '../lib/engine.js'
import { spawn } from 'node:child_process'

const engine = new InputEngine({ log: (m) => console.log('[log]', m) })
await engine.start()
console.log('[ready]', JSON.stringify(engine.handshake))
// 2 秒后自动拖一个新框（避开上次的位置）
setTimeout(() => {
  const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.tmp/fakedrag2.ps1'], { stdio: 'inherit' })
  p.on('exit', (c) => console.log('[drag exit]', c))
}, 2000)
try {
  const r = await engine.request('select', { timeoutMs: 15000 }, 30000)
  console.log('[select]', JSON.stringify(r))
  if (r && r.rect) {
    const out = '.tmp/select-shot.png'
    const c = await engine.request('capture', { path: out, rect: r.rect }, 15000)
    console.log('[capture]', JSON.stringify(c))
  }
} catch (e) {
  console.log('[err]', e?.message || String(e))
}
await engine.stop()
process.exit(0)
