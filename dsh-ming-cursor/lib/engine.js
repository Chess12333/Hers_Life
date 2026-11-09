/**
 * dsh-ming-cursor · sidecar 客户端
 *
 * 一个常驻的 Windows PowerShell 5.1 进程（STA）只干两件事：
 *   把光标画到屏幕上 / 在桌面上说一句话。
 *
 * 它不截屏、不点、不拖、不读 UIA —— 想要那些，装 dsh-ming-mousepet。
 * Node 侧只做一件事：按行发 JSON、按行收 JSON。懒启动：第一次真要用才编译 C#。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'cursor-core.ps1')

function resolvePowerShell() {
  if (process.env.DSH_CURSOR_POWERSHELL) return process.env.DSH_CURSOR_POWERSHELL
  const system = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(system) ? system : 'powershell.exe'
}

export class CursorEngine {
  constructor({ log = () => {} } = {}) {
    this.log = log
    this.proc = null
    this.buf = ''
    this.waiting = new Map()
    this.seq = 0
    this.starting = null
    this.lastError = null
  }

  get running() { return !!this.proc && !this.proc.killed }

  async ensure() {
    if (this.running) return
    if (this.starting) return this.starting
    this.starting = new Promise((resolve, reject) => {
      const proc = spawn(resolvePowerShell(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SIDECAR], {
        cwd: dirname(SIDECAR),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.proc = proc
      proc.stdout.setEncoding('utf8')
      proc.stdout.on('data', (chunk) => this._onData(chunk))
      proc.stderr.setEncoding('utf8')
      proc.stderr.on('data', (s) => {
        const t = String(s).trim()
        if (!t) return
        this.lastError = t
        // C# 编译失败、窗体异常都从这里出来；不吞，让它进日志。
        this.log('[cursor] ' + t)
      })
      proc.on('error', (e) => { this.lastError = String(e?.message || e); reject(e) })
      proc.on('exit', (code) => {
        this.proc = null
        for (const [, slot] of this.waiting) slot.reject(new Error('sidecar 退出了（code=' + code + '）'))
        this.waiting.clear()
      })
      // 第一次请求会等这行 ping 的回执，等于「编译完了」。
      this._call('ping', {}, 20000).then(() => resolve()).catch(reject)
    }).finally(() => { this.starting = null })
    return this.starting
  }

  _onData(chunk) {
    this.buf += chunk
    let i
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line || line[0] !== '{') continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      const slot = this.waiting.get(msg.id)
      if (!slot) continue
      this.waiting.delete(msg.id)
      clearTimeout(slot.timer)
      if (msg.ok === false) slot.reject(new Error(msg.error || 'sidecar 报错'))
      else slot.resolve(msg)
    }
  }

  _call(cmd, args = {}, timeoutMs = 8000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      if (!this.proc) { reject(new Error('sidecar 没在跑')); return }
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(cmd + ' 超时（' + timeoutMs + 'ms）'))
      }, timeoutMs)
      this.waiting.set(id, { resolve, reject, timer })
      try { this.proc.stdin.write(JSON.stringify(Object.assign({ id, cmd }, args)) + '\n') }
      catch (e) { clearTimeout(timer); this.waiting.delete(id); reject(e) }
    })
  }

  /** 所有动作都从这里出去：先确保 sidecar 活着，再发。 */
  async call(cmd, args = {}, timeoutMs = 8000) {
    await this.ensure()
    return this._call(cmd, args, timeoutMs)
  }

  async show(x, y) { return this.call('show', { x: Math.round(x), y: Math.round(y) }) }
  async move(x, y, ms = 0) { return this.call('move', { x: Math.round(x), y: Math.round(y), ms: Math.round(ms) }) }
  async hide() { return this.call('hide') }
  async style(name) { return this.call('style', { name }) }
  async size(px) { return this.call('size', { px: Math.round(px) }) }
  async mode(mode, holdMs) { return this.call('mode', { mode, holdMs }) }
  async status() { return this.call('status') }
  async say(text, { x, y, ms } = {}) {
    const args = { text }
    if (Number.isFinite(x)) args.x = Math.round(x)
    if (Number.isFinite(y)) args.y = Math.round(y)
    if (Number.isFinite(ms)) args.ms = Math.round(ms)
    return this.call('say', args, 15000)
  }

  async dispose() {
    if (!this.proc) return
    try { await this._call('shutdown', {}, 1500) } catch { }
    try { this.proc.stdin.end() } catch { }
    try { this.proc.kill() } catch { }
    this.proc = null
  }
}
