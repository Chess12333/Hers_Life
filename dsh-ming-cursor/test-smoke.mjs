#!/usr/bin/env node
/**
 * test-smoke.mjs —— 轻量光标的冒烟测试
 *
 * 默认只跑不打扰屏幕的那几项（ping / status / 参数越界）。
 * 加 --visual 才真的把光标画出来、说一句——那一步会占屏，别在跑着活的时候用。
 *
 * 用法：
 *   node test-smoke.mjs                 # 静默项
 *   node test-smoke.mjs --visual        # 加上 show / move / style / size / say
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const visual = process.argv.includes('--visual')

const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'cursor-core.ps1')], {
  cwd: here,
  stdio: ['pipe', 'pipe', 'pipe'],
})

let buf = ''
const waiting = new Map()
ps.stdout.setEncoding('utf8')
ps.stdout.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { console.log('· 非 JSON 输出：' + line); continue }
    const slot = waiting.get(msg.id)
    if (slot) { waiting.delete(msg.id); slot(msg) } else console.log('· 没有对应请求：' + line)
  }
})
ps.stderr.setEncoding('utf8')
ps.stderr.on('data', (s) => { const t = s.trim(); if (t) console.log('· stderr：' + t) })

let seq = 0
function call(cmd, args = {}, timeoutMs = 6000) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(cmd + ' 超时')) }, timeoutMs)
    waiting.set(id, (m) => { clearTimeout(timer); resolve(m) })
    ps.stdin.write(JSON.stringify(Object.assign({ id, cmd }, args)) + '\n')
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let fail = 0
const check = (ok, msg, extra) => {
  console.log((ok ? '✓ ' : '✗ ') + msg + (extra ? '  ' + extra : ''))
  if (!ok) fail++
}

try {
  const p = await call('ping')
  check(p.ok && p.pong, 'sidecar 起得来，ping 通')

  const s0 = await call('status')
  check(s0.ok && s0.state && s0.state.visible === false, '还没画的时候 status 说「不可见」', JSON.stringify(s0.state))

  const sz = await call('size', { px: 9999 })
  check(sz.ok && sz.size === 192, '尺寸越界被夹到 192', 'size=' + sz.size)

  const sz2 = await call('size', { px: 1 })
  check(sz2.ok && sz2.size === 24, '尺寸下限夹到 24', 'size=' + sz2.size)

  const md = await call('mode', { mode: 'clean', holdMs: 1500 })
  check(md.ok && md.mode === 'clean', '切到 clean 模式', 'holdMs=' + md.holdMs)

  const bad = await call('nonsense-command')
  check(bad.ok === false && /unknown cmd/.test(bad.error || ''), '不认识的命令会如实报错', bad.error)

  if (visual) {
    echo('—— 下面几步会画到屏幕上 ——')
    const st = await call('size', { px: 72 })
    check(st.ok, '尺寸设回 72')
    const sh = await call('show', { x: 900, y: 500 })
    check(sh.ok && sh.state.visible === true, '光标出来了', sh.state ? ('at ' + sh.state.x + ',' + sh.state.y) : '')
    await sleep(300)
    const mv = await call('move', { x: 1200, y: 620, ms: 700 })
    await sleep(950)   // 动画是异步的：回执只说明「开始滑了」，到位要重新问一次
    const st2 = await call('status')
    check(mv.ok && st2.state.x === 1200 && st2.state.y === 620, '滑到新位置', st2.state ? (st2.state.x + ',' + st2.state.y) : '')
    const sty = await call('style', { name: 'link' })
    check(sty.ok && sty.style === 'link', '换样式：link')
    const say = await call('say', { text: '轻量版：一句话', x: 1200, y: 620, ms: 3500 })
    check(say.ok && say.at, '气泡出来了', say.at)
    await sleep(600)
    await call('hide')
    const s1 = await call('status')
    check(s1.state.visible === false, '收得回去')
  }

  await call('shutdown')
  await sleep(200)
} catch (e) {
  console.error('✗ 跑挂了：' + e.message)
  fail++
} finally {
  try { ps.stdin.end() } catch { }
  try { ps.kill() } catch { }
}

console.log(fail ? `\n✗ ${fail} 项没过` : '\n✓ 全部通过')
process.exit(fail ? 1 : 0)

function echo(s) { console.log(s) }
