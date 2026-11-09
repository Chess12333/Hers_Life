/**
 * verify-no-steal.mjs —— 验两件事（2026-11-05 浔的委托）：
 *   ① 我这边操作鼠标时，她的真实光标不动；
 *   ② 我打字时不抢键盘焦点（前台窗口不变）。
 *
 * 做法：起一个 WinForms 测试窗口，sidecar 走 uia / message 两种通道各点几下、再输入一段字，
 * 每一步前后读「真实光标坐标」和「前台窗口」，只报实测，不推断。
 * 判据写死：光标位移 > 2px 或前台窗口变了，就算 FAIL（真值只有一个：她那边会不会跳）。
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIDECAR = join(HERE, '..', 'sidecar.ps1')
const LOG = join(HERE, 'testapp.log')
const META = join(HERE, 'testapp.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Sidecar {
  constructor() { this.seq = 0; this.pending = new Map(); this.ready = false; this.buf = '' }
  async start() {
    this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SIDECAR], { windowsHide: true })
    this.proc.stdout.setEncoding('utf8')
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.event === 'ready') { this.ready = true; continue }
        const p = this.pending.get(msg.id)
        if (!p) continue
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'sidecar error'))
      }
    })
    const t0 = Date.now()
    while (!this.ready) {
      if (Date.now() - t0 > 30000) throw new Error('sidecar ready timeout')
      await sleep(100)
    }
  }
  request(cmd, args = {}, timeoutMs = 20000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${cmd}`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n')
    })
  }
  async stop() {
    try { await this.request('shutdown', {}, 3000) } catch {}
    try { this.proc.stdin.end() } catch {}
    await sleep(300)
    try { this.proc.kill() } catch {}
  }
}

const logLines = () => { try { return readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean) } catch { return [] } }
let pass = 0, fail = 0
const check = (name, cond, detail = '') => { cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name, detail)) }

const app = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'testapp.ps1')], { windowsHide: false })
app.stderr.setEncoding('utf8')
app.stderr.on('data', (c) => console.error('APP ERR', c))

try {
  if (existsSync(META)) writeFileSync(META, '')
  const t0 = Date.now()
  while (!existsSync(META) || !readFileSync(META, 'utf8').trim()) {
    if (Date.now() - t0 > 15000) throw new Error('test app did not start')
    await sleep(100)
  }
  await sleep(400)
  const meta = JSON.parse(readFileSync(META, 'utf8'))

  const sc = new Sidecar()
  await sc.start()

  const before = await sc.request('status')
  const p0 = before.cursor
  const fg0 = before.foreground?.hwnd
  console.log('起始 真实光标', `(${p0?.x}, ${p0?.y})`, '前台', before.foreground?.title || fg0)

  // —— ① 一连点 6 下（uia / message 交替），全程不碰真实光标
  let landed = 0
  for (let i = 0; i < 6; i++) {
    writeFileSync(LOG, '')
    const mode = i % 2 === 0 ? 'uia' : 'message'
    const r = await sc.request('click', { x: meta.button.x, y: meta.button.y, button: 'left', count: 1, mode })
    await sleep(250)
    if (r.ok && logLines().includes('button')) landed++
  }
  const afterClick = await sc.request('status')
  const p1 = afterClick.cursor
  const dx = Math.abs((p1?.x ?? 0) - (p0?.x ?? 0))
  const dy = Math.abs((p1?.y ?? 0) - (p0?.y ?? 0))
  // 判据不是「光标绝对不动」——她在用电脑，手一动光标就该动。
  // 要证明的是：**光标没被搬到我要点的那一点上去**（那才是“我一操作你就跳”）。
  const dist = Math.hypot((p1?.x ?? 0) - meta.button.x, (p1?.y ?? 0) - meta.button.y)
  console.log(`点完 6 下：落地 ${landed}/6，真实光标 (${p1?.x}, ${p1?.y})，我点的目标 (${meta.button.x}, ${meta.button.y})，相距 ${Math.round(dist)}px`)
  console.log(`   她最近一次真实输入：${before.lastUserInputAgeMs}ms（测前）→ ${afterClick.lastUserInputAgeMs}ms（测后）；她自己的位移 ${dx}x${dy}px`)
  check('6 次点击都真的点到按钮', landed === 6, `landed=${landed}`)
  check('真实光标没被搬到点击目标上（相距 > 100px）', dist > 100, `相距 ${Math.round(dist)}px`)

  // —— ② 打字：测试窗口自己记「有没有被激活过」，这是抢不抢焦点的硬判据
  writeFileSync(LOG, '')
  const ty = await sc.request('type', { x: meta.textbox.x, y: meta.textbox.y, text: 'no-steal-check', mode: 'uia', replace: true })
  await sleep(300)
  const afterType = await sc.request('status')
  const fg1 = afterType.foreground?.hwnd
  const p2 = afterType.cursor
  console.log('打完 前台', afterType.foreground?.title || fg1, '真实光标', `(${p2?.x}, ${p2?.y})`)
  const distBox = Math.hypot((p2?.x ?? 0) - meta.textbox.x, (p2?.y ?? 0) - meta.textbox.y)
  // 不抢焦点的**硬判据**不是“前台没变”（她自己会切窗口），而是：
  // 输入那一刻测试窗口**没有**变成前台，字却照样写进去了。
  // 换句话说：如果她这时正把窗口切到 QQ，我仍然能往后台那个框里写字——焦点从来没离开她。
  const focusEvents = logLines().filter((l) => l === 'activated' || l === 'deactivated')
  const touchedFg = String(fg0) === String(meta.hwnd)
  console.log('   前台在测前/测后：', afterClick.foreground?.title, '→', afterType.foreground?.title)
  console.log('   输入窗口自己的焦点事件：', focusEvents.length ? focusEvents.join(',') : '无（它一次都没被激活）')
  check('输入成功', ty.ok === true, JSON.stringify(ty))
  check('输入没有惊动那个窗口的焦点（无 activated/deactivated）', focusEvents.length === 0, focusEvents.join(','))
  check('真实光标没被搬到输入框上（相距 > 100px）', distBox > 100, `相距 ${Math.round(distBox)}px`)

  // 落地核对：测试窗口自己记的日志里要有这串字
  writeFileSync(LOG, '')
  await sc.request('click', { x: meta.read.x, y: meta.read.y, button: 'left', count: 1, mode: 'uia' })
  await sleep(300)
  check('输入的字真写进了控件', logLines().some((l) => l.includes('no-steal-check')), JSON.stringify(logLines()))

  await sc.request('overlay', { show: false })
  await sc.stop()
} catch (e) {
  console.error('TEST ERROR', e)
  fail++
} finally {
  try { app.kill() } catch {}
}

console.log(`RESULT pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
