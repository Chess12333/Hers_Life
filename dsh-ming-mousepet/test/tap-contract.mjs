/**
 * 桌宠「轻点＝叫它一次，长按＝拖动」的契约测试（2026-11-08）。
 *
 * 隔离起来跑：自己起一个 sidecar（跟 DSH 里那只不是同一个），
 * 用 PostMessage 往它的窗口里塞真的 WM_LBUTTONDOWN/UP，看它抛不抛 tap 事件。
 * 不碰真实光标，也不动桌面上的那只桌宠。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { InputEngine } from '../lib/engine.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SEND = join(HERE, 'send-click.ps1')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const taps = []
const engine = new InputEngine({
  log: (m) => { if (process.env.TAP_VERBOSE) console.log('[sidecar]', m) },
  onTap: (e) => taps.push(e),
})

function send(hwnd, mode) {
  // 参数走环境变量：PS 5.1 在这台机器上 -File 传参会被当成位置参数（2026-11-08 踩过）。
  return execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SEND], {
    encoding: 'utf8',
    env: { ...process.env, TAP_HWND: String(hwnd), TAP_MODE: mode },
  }).trim()
}

const results = []
function check(name, expect, got) {
  const ok = expect === got
  results.push({ name, expect, got, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}：要 ${expect} 次 tap，实得 ${got}`)
}

try {
  await engine.ensure()
  const shown = await engine.request('overlay', { show: true, x: 40, y: 40 }, 15000)
  const dbg = await engine.request('debug', {}, 10000)
  const hwnd = dbg?.hwnd
  if (!hwnd) throw new Error(`没拿到桌宠窗口句柄：${JSON.stringify({ shown, dbg })}`)
  console.log(`桌宠窗口 hwnd=${hwnd} visible=${dbg.visible}`)
  await sleep(600)

  let before = taps.length
  send(hwnd, 'click')
  await sleep(500)
  check('轻点一下', before + 1, taps.length)

  before = taps.length
  send(hwnd, 'hold')
  await sleep(500)
  check('长按不动', before, taps.length)

  before = taps.length
  send(hwnd, 'drag')
  await sleep(600)
  check('按住拖动', before, taps.length)

  before = taps.length
  send(hwnd, 'flick')
  await sleep(600)
  check('短促甩出去', before, taps.length)

  // 拖完之后窗口真的动过，位置要跟原来不一样。
  const after = await engine.request('debug', {}, 10000)
  const moved = after?.bounds && dbg?.bounds
    ? (after.bounds[0] !== dbg.bounds[0] || after.bounds[1] !== dbg.bounds[1] || after.bounds[2] !== dbg.bounds[2])
    : null
  console.log(`${moved ? 'PASS' : 'FAIL'} 拖动之后位置变了：before=${JSON.stringify(dbg?.bounds)} after=${JSON.stringify(after?.bounds)}`)
  results.push({ name: '拖动位移', ok: moved === true })

  // 事件里带的坐标是真坐标（不是 0）。
  const t = taps[0]
  console.log(`tap 样本：${JSON.stringify(t)}`)
  const hasXY = t && Number.isFinite(t.x) && Number.isFinite(t.y)
  results.push({ name: 'tap 带坐标', ok: Boolean(hasXY) })
  if (!hasXY) console.log('FAIL tap 没带坐标')
} finally {
  try { await engine.request('overlay', { show: false }, 8000) } catch { /* ignore */ }
  try { await engine.request('shutdown', {}, 5000) } catch { /* ignore */ }
  engine.stop()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
process.exit(bad.length ? 1 : 0)
