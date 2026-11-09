import { InputEngine } from '../lib/engine.js'
import { spawn } from 'node:child_process'
const engine = new InputEngine({ log: (m) => console.log('[log]', m), onSelect: (e) => console.log('[EVT]', JSON.stringify(e)) })
await engine.start()
console.log('[ready]', engine.handshake?.ok)
const r = await engine.request('select', { timeoutMs: 12000 }, 8000)
console.log('[started]', JSON.stringify(r))
setTimeout(() => { spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.tmp/fakedrag2.ps1'], { stdio: 'ignore' }) }, 2500)
setTimeout(async () => { await engine.stop(); process.exit(0) }, 16000)
