// 只验新加的两个动作：drift（光标漂移开关）、move（指到某处）。
// 漂移有没有真的"晃"脚本看不到，只能确认命令通、不卡住请求循环。
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
proc.stdout.setEncoding('utf8')
proc.stdout.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.event) { console.log('[事件]', JSON.stringify(msg)); continue }
    const w = waiters.get(msg.id)
    if (w) { waiters.delete(msg.id); w(msg) }
  }
})
proc.stderr.setEncoding('utf8')
proc.stderr.on('data', (c) => console.log('[stderr]', String(c).trim().slice(0, 300)))

let seq = 0
function req(cmd, args = {}, timeoutMs = 20000) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`${cmd} 超时`)) }, timeoutMs)
    waiters.set(id, (m) => { clearTimeout(timer); resolve(m) })
    proc.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
  })
}

try {
  await req('ping')
  console.log('✓ ping')

  const on = await req('drift', { on: true })
  console.log('✓ drift on ', JSON.stringify(on.result))

  const mv = await req('move', { x: 600, y: 420 })
  console.log('✓ move     ', JSON.stringify(mv.result))

  await new Promise((r) => setTimeout(r, 1200))
  const st = await req('status')
  console.log('✓ 漂移中仍能应答', st.result?.cursorState ?? '?')

  const said = await req('say', { text: '这里', ms: 1500, x: 600, y: 300 })
  console.log('✓ 指向说话 ', JSON.stringify(said.result).slice(0, 160))

  const off = await req('drift', { on: false })
  console.log('✓ drift off', JSON.stringify(off.result))
} catch (error) {
  console.error('✗', error.message)
} finally {
  try { proc.stdin.end() } catch { /* ignore */ }
  setTimeout(() => { try { proc.kill() } catch { /* ignore */ } process.exit(0) }, 400)
}
