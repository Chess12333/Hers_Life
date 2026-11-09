/**
 * dsh-ming-mousepet · sidecar 客户端
 *
 * 一个常驻的 Windows PowerShell 5.1 进程（STA）负责：
 *   - UIA / 窗口消息（默认，不碰真实光标）
 *   - 物理输入回退（SendInput，主人一碰就暂停并还原光标）
 *   - 低级键鼠钩子 + Ctrl+Alt+Q 全局暂停
 *   - AI 光标覆盖层（点击穿透、不抢焦点）
 *
 * Node 侧只做一件事：按行发 JSON、按行收 JSON。sidecar 懒启动，
 * 第一次真正要用输入能力时才编译 C#，不拖慢 DSH 启动。
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')

/**
 * 2026-11-09 版本握手（11-08 第五节第 1 条）。
 *
 * 坑是这个：改了 sidecar.ps1 但 sidecar 进程没重启，跑的还是旧代码，而这边一声不响——
 * 11-08 那次就被它骗过（`Do` 掉的进程和新起的进程不是同一份）。
 *
 * 做法：ps1 里本来就写着 `version = 'x.y.z'`（ready 行也会报出来），
 * 这里把**文件里写的版本**当期望值，跟**活进程报的版本**比。
 * 不一致就记一条明确的话，并且把结果留在 `engine.handshake` 上供状态查询读。
 */
function readSidecarMeta(path = SIDECAR) {
  try {
    const text = readFileSync(path, 'utf8')
    const matched = text.match(/version\s*=\s*'([^']+)'/)
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 12)
    return { version: matched ? matched[1] : null, hash, error: null }
  } catch (error) {
    return { version: null, hash: null, error: error?.message || String(error) }
  }
}

function resolvePowerShell() {
  const explicit = process.env.DSH_INPUT_POWERSHELL
  if (explicit) return explicit
  const system = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (existsSync(system)) return system
  return 'powershell.exe'
}

export class InputEngine {
  constructor({ log = () => {}, cursorMode = 'companion', cursorHoldMs = 2600, cursorSize = 64, cursorState = 'pointer', onTap = null, onShake = null, onSelect = null, onWebPick = null, onAsk = null, onCardClosed = null, onPick = null, onMenu = null } = {}) {
    this.log = log
    // 2026-11-08 21:1x：桌宠被轻点时 sidecar 会抛一行 tap 事件；这里转给插件，让桌宠说一句。
    this.onTap = typeof onTap === 'function' ? onTap : null
    // 2026-11-09：晃一下鼠标时 sidecar 抛 shake 事件；这里转给插件，让光标飞过去说一句。
    this.onShake = typeof onShake === 'function' ? onShake : null
    // 2026-11-09：框选完成/取消时不阻塞主循环，走事件回来。
    this.onSelect = typeof onSelect === 'function' ? onSelect : null
    // 浏览器扩展把网页里选中的一段 POST 进来时抛的事件。
    this.onWebPick = typeof onWebPick === 'function' ? onWebPick : null
    // 2026-11-09：她在卡片里按下回车问了一句；以及卡片被关掉（要清掉追问的上下文）。
    this.onAsk = typeof onAsk === 'function' ? onAsk : null
    this.onCardClosed = typeof onCardClosed === 'function' ? onCardClosed : null
    // 2026-11-09：指一下——悬停取块、回车确认；取消时也报一声（pick-none）。
    this.onPick = typeof onPick === 'function' ? onPick : null
    // 2026-11-09 21:1x：右键菜单里改了「晃动检测」或「回答档」。
    this.onMenu = typeof onMenu === 'function' ? onMenu : null
    this.cursorMode = cursorMode === 'clean' ? 'clean' : 'companion'
    this.cursorHoldMs = Number(cursorHoldMs) > 0 ? Number(cursorHoldMs) : 2600
    this.cursorSize = clampSize(cursorSize)
    this.cursorState = clampStyle(cursorState)
    this.proc = null
    this.ready = false
    this.starting = null
    this.seq = 0
    this.pending = new Map()
    this.buf = ''
    this.stderr = ''
    this.handshake = null
    this.expectedSidecar = null
    this.stopping = false
  }

  async setCursorMode(mode, holdMs) {
    if (mode === 'clean' || mode === 'companion') this.cursorMode = mode
    if (Number(holdMs) > 0) this.cursorHoldMs = Number(holdMs)
    if (this.ready && this.proc && this.proc.exitCode === null) {
      return this.request('setCursorMode', { mode: this.cursorMode, holdMs: this.cursorHoldMs })
    }
    return { ok: true, cursorMode: this.cursorMode, cursorHoldMs: this.cursorHoldMs, pending: true }
  }

  async setCursorSize(size) {
    this.cursorSize = clampSize(size)
    if (this.ready && this.proc && this.proc.exitCode === null) {
      return this.request('setCursorSize', { size: this.cursorSize })
    }
    return { ok: true, cursorSize: this.cursorSize, pending: true }
  }

  async setCursorState(state) {
    this.cursorState = clampStyle(state)
    if (this.ready && this.proc && this.proc.exitCode === null) {
      return this.request('setCursorStyle', { style: this.cursorState })
    }
    return { ok: true, cursorState: this.cursorState, pending: true }
  }

  async setCursorStyle(state) {
    return this.setCursorState(state)
  }

  async ensure() {
    if (this.ready && this.proc && this.proc.exitCode === null) return
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => { this.starting = null })
    return this.starting
  }

  async start() {
    this.stopProcess()
    this.ready = false
    this.buf = ''
    this.stderr = ''
    this.expectedSidecar = readSidecarMeta()

    const ps = resolvePowerShell()
    const proc = spawn(ps, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-STA',
      '-ExecutionPolicy', 'Bypass', '-File', SIDECAR,
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DSH_INPUT_CURSOR_MODE: this.cursorMode,
        DSH_INPUT_CURSOR_HOLD_MS: String(this.cursorHoldMs),
        DSH_INPUT_CURSOR_SIZE: String(this.cursorSize),
        DSH_INPUT_CURSOR_STYLE: this.cursorState,
      },
    })
    this.proc = proc

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => this.onData(chunk))

    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-8000)
      this.log(`[sidecar stderr] ${chunk.trim()}`)
    })

    proc.on('error', (error) => {
      this.failAll(new Error(`输入 sidecar 启动失败：${error.message}`))
    })
    proc.on('exit', (code, signal) => {
      this.ready = false
      this.proc = null
      const detail = this.stderr ? `\n${this.stderr.slice(-1200)}` : ''
      this.failAll(new Error(`输入 sidecar 退出（code=${code} signal=${signal}）${detail}`))
    })

    const started = Date.now()
    while (true) {
      if (this.ready) return
      if (!this.proc || this.proc.exitCode !== null) {
        throw new Error(`输入 sidecar 没起来：${this.stderr.slice(-1500) || '进程已退出'}`)
      }
      if (Date.now() - started > 30000) {
        this.stopProcess()
        throw new Error(`输入 sidecar 启动超时：${this.stderr.slice(-1500) || '没有收到 ready'}`)
      }
      await sleep(80)
    }
  }

  onData(chunk) {
    this.buf += chunk
    let index
    while ((index = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, index).trim()
      this.buf = this.buf.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.log(`[sidecar] 非 JSON 输出：${line.slice(0, 300)}`)
        continue
      }
      if (message.event === 'tap') {
        // 她轻点了一下桌宠。sidecar 只管报「被点了」，说什么由插件决定。
        try { this.onTap?.(message) } catch (error) { this.log(`tap 事件处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'shake') {
        // 她晃了一下鼠标。sidecar 只报位置，说什么、飞不飞过去由插件决定。
        try { this.onShake?.(message) } catch (error) { this.log(`shake 事件处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'select-done' || message.event === 'select-none') {
        try { this.onSelect?.(message) } catch (error) { this.log(`框选事件处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'webpick') {
        try { this.onWebPick?.(message) } catch (error) { this.log(`webpick 处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'ask') {
        // 她在卡片里按下回车。问的什么由插件决定怎么答。
        try { this.onAsk?.(message) } catch (error) { this.log(`ask 处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'menu') {
        try { this.onMenu?.(message) } catch (error) { this.log(`menu 处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'card-closed') {
        try { this.onCardClosed?.(message) } catch (error) { this.log(`card-closed 处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'pick' || message.event === 'pick-none') {
        try { this.onPick?.(message) } catch (error) { this.log(`pick 处理失败：${error?.message || error}`) }
        continue
      }
      if (message.event === 'ready') {
        this.ready = true
        // 版本握手：文件里写的版本 vs 这个进程报的版本。
        // 不致命（桌宠照常能用），但必须留一句能看见的话，不许静默跑旧代码。
        const expected = this.expectedSidecar || readSidecarMeta()
        const actual = typeof message.version === 'string' ? message.version : null
        const ok = Boolean(actual) && Boolean(expected.version) && actual === expected.version
        this.handshake = {
          ok,
          expected: expected.version,
          actual,
          fileHash: expected.hash,
          pid: message.pid ?? null,
          at: new Date().toISOString(),
        }
        if (!ok) {
          this.log(
            `[版本握手] sidecar 版本对不上：文件里写的是 ${expected.version ?? '(没读到 version)'}，` +
            `跑起来的进程报 ${actual ?? '(没报 version)'}——ps1 改过但 sidecar 没重启？` +
            ` 文件指纹 ${expected.hash ?? '?'} / pid ${message.pid ?? '?'}`,
          )
        }
        // 2026-11-08：sidecar 一重启，overlay 就跟着进程一起没了，而没有人去叫它回来——
        // 她看到的就是「桌宠又自己消失了」。companion 模式本来就该一直在，
        // 新进程 ready 之后主动亮一次（位置沿用 sidecar 记的 LastX/LastY，没有就落主屏中间）。
        if (this.cursorMode === 'companion') {
          this.request('overlay', { show: true }, 5000).catch(() => {})
        }
        continue
      }
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) {
        const state = message.result?.cursorState
        if (typeof state === 'string' && state) this.cursorState = state
        pending.resolve(message.result)
      } else {
        pending.reject(new Error(message.error || 'sidecar 返回错误'))
      }
    }
  }

  failAll(error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  async request(cmd, args = {}, timeoutMs = 30000) {
    await this.ensure()
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`输入 sidecar 超时：${cmd}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.proc.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`)
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  stopProcess() {
    const proc = this.proc
    this.proc = null
    this.ready = false
    if (!proc) return
    try { proc.stdin.end() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
  }

  stop() {
    if (this.stopping) return
    this.stopping = true
    const proc = this.proc
    if (proc) {
      try {
        proc.stdin.write(`${JSON.stringify({ id: ++this.seq, cmd: 'shutdown' })}\n`)
      } catch { /* ignore */ }
      setTimeout(() => {
        try { proc.kill() } catch { /* ignore */ }
      }, 800).unref?.()
    }
    this.stopProcess()
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clampSize(size) {
  const n = Number(size)
  if (!Number.isFinite(n)) return 64
  return Math.max(24, Math.min(192, Math.round(n)))
}

const STYLES = new Set([
  'pointer', 'work', 'unavailiable', 'link', 'text',
  'cross', 'busy', 'move', 'vert', 'horz',
  'help', 'handwriting', 'dgn1', 'dgn2', 'alternate',
])

function clampStyle(style) {
  const s = String(style || '').toLowerCase()
  return STYLES.has(s) ? s : 'pointer'
}
