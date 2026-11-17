// 直接对 sidecar 说两句话：ping / say / watch。
// 2026-11-08 加。跑法：node test/pet-test.mjs
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')

const proc = spawn('powershell', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-STA',
  '-ExecutionPolicy', 'Bypass', '-File', SIDECAR,
], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

let buf = ''
const waiters = new Map()
const events = []

proc.stdout.setEncoding('utf8')
proc.stdout.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { console.log('[非JSON]', line.slice(0, 200)); continue }
    if (msg.event) { events.push(msg); console.log('[事件]', JSON.stringify(msg).slice(0, 200)); continue }
    const w = waiters.get(msg.id)
    if (w) { waiters.delete(msg.id); w(msg) }
    else console.log('[无主]', JSON.stringify(msg).slice(0, 300))
  }
})

proc.stderr.setEncoding('utf8')
proc.stderr.on('data', (c) => console.log('[stderr]', String(c).trim().slice(0, 400)))

let seq = 0
function req(cmd, args = {}, timeoutMs = 20000) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`${cmd} 超时`)) }, timeoutMs)
    waiters.set(id, (m) => { clearTimeout(timer); resolve(m) })
    proc.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
  })
}

const t0 = Date.now()
try {
  const ping = await req('ping')
  console.log(`✓ ping  ${Date.now() - t0}ms`, JSON.stringify(ping).slice(0, 120))

  const st = await req('status')
  console.log('✓ status', JSON.stringify({ fg: st.foreground?.title, paused: st.paused }).slice(0, 200))

  const say = await req('say', { text: '我在这儿', ms: 2500 })
  console.log('✓ say   ', JSON.stringify(say).slice(0, 300))

  const watch = await req('watch', { seconds: 2, fps: 2, frames: 3 }, 30000)
  console.log('✓ watch ', JSON.stringify({ ok: watch.ok, kept: watch.kept, frames: watch.frames }).slice(0, 500))

  await new Promise((r) => setTimeout(r, 800))
  const pong = await req('ping')
  console.log('✓ 说完话还能应  ', JSON.stringify(pong).slice(0, 80))
} catch (error) {
  console.error('✗', error.message)
} finally {
  try { proc.stdin.end() } catch { /* ignore */ }
  setTimeout(() => { try { proc.kill() } catch { /* ignore */ } process.exit(0) }, 500)
}
