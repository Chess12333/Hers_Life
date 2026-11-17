// sidecar 版本握手 · 逻辑对照测试（2026-11-09 11:5x）
//
// 不起真进程：直接喂 onData 一条 ready 行，看 engine.handshake 判得对不对。
//
// 要证的只有一件事：**文件里写的版本和进程报的版本对不上时，它不再是静默的**，
// 而且桌宠不能因此瘫掉（ready 仍然成立，只是多一句告警）。
//
// 注意：用 cursorMode:'clean'，避开 companion 模式下 ready 后自动 request('overlay') ——
// 那一步在没有真进程的测试环境里会反过来把 ready 打回 false，属于测试假象。

import { readFileSync } from 'node:fs'
import { InputEngine } from '../lib/engine.js'

let failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `　期望 ${JSON.stringify(want)} 实得 ${JSON.stringify(got)}`}`)
}

function makeEngine() {
  const logs = []
  const engine = new InputEngine({ log: (m) => logs.push(String(m)), cursorMode: 'clean' })
  // 假装 sidecar.ps1 里写的是 0.2.0，文件指纹 abc123
  engine.expectedSidecar = { version: '0.2.0', hash: 'abc123', error: null }
  return { engine, logs }
}

function feedReady(engine, readyLine) {
  engine.onData(JSON.stringify(readyLine) + '\n')
}

console.log('=== 握手判定 ===')

// ① 一致
{
  const { engine, logs } = makeEngine()
  feedReady(engine, { event: 'ready', pid: 111, version: '0.2.0' })
  check('版本一致 → ok', engine.handshake.ok, true)
  check('版本一致 → actual', engine.handshake.actual, '0.2.0')
  check('版本一致 → 不打告警', logs.filter((l) => l.includes('版本握手')).length, 0)
  check('版本一致 → ready 成立', engine.ready, true)
}

// ② 文件改了、进程还是旧的（就是那个坑）
{
  const { engine, logs } = makeEngine()
  feedReady(engine, { event: 'ready', pid: 222, version: '0.1.9' })
  check('文件 0.2.0 / 进程 0.1.9 → ok=false', engine.handshake.ok, false)
  check('版本不一致 → 打一条告警', logs.filter((l) => l.includes('版本握手')).length, 1)
  check('告警里带两个版本号', /0\.2\.0/.test(logs.join('')) && /0\.1\.9/.test(logs.join('')), true)
  check('不一致时 ready 仍然成立（桌宠不瘫）', engine.ready, true)
}

// ③ 老 sidecar 不报 version
{
  const { engine, logs } = makeEngine()
  feedReady(engine, { event: 'ready', pid: 333 })
  check('进程没报 version → ok=false', engine.handshake.ok, false)
  check('进程没报 version → 有告警', logs.filter((l) => l.includes('版本握手')).length, 1)
}

// ④ 文件里没写 version（新加的 ps1 漏了这行）
{
  const engine = new InputEngine({ log: () => {}, cursorMode: 'clean' })
  engine.expectedSidecar = { version: null, hash: 'zzz', error: null }
  feedReady(engine, { event: 'ready', pid: 444, version: '0.2.0' })
  check('文件没写 version → ok=false', engine.handshake.ok, false)
}

console.log('\n=== 真文件 ===')
{
  const text = readFileSync(new URL('../sidecar.ps1', import.meta.url), 'utf8')
  const m = text.match(/version\s*=\s*'([^']+)'/)
  check('sidecar.ps1 里有 version 一行', Boolean(m), true)
  console.log(`  文件里写的是 ${m ? m[1] : '(没有)'}，${text.length} 字节`)
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项没过`}`)
process.exit(failed === 0 ? 0 : 1)
