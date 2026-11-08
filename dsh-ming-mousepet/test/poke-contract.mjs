/**
 * 「她点一下 = 桌宠说一句，且不记次数」的契约测试（2026-11-08）。
 *
 * 不连真模型、不连真 sidecar：给 startTalker 一个假 llm 和一个假 engine。
 * 要证的就两条：
 *   1. poke 真的让它开口（engine 收到 say，内容是模型给的那句）；
 *   2. poke 不碰配额——不写 spokenToday、不调 markSpoken / loadPetState。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { startTalker } from '../lib/talker.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CARD = join(HERE, 'tmp-poke-card.md')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

writeFileSync(CARD, '# 测试卡\n\n只说一句短话。\n', 'utf8')

const LINE = '嗯，我在。'
const calls = []
const engine = {
  async request(cmd, args = {}) {
    calls.push({ cmd, args })
    if (cmd === 'status') {
      // paused=true → 启动时那一轮 judgeNudge 会判「别出声」，不会写任何状态文件。
      return { paused: true, cursor: { x: 200, y: 200 }, screen: { x: 0, y: 0, w: 1920, h: 1080 } }
    }
    if (cmd === 'winInfo') return { rect: { x: 0, y: 0, w: 900, h: 700 } }
    return { ok: true }
  },
}
const llm = {
  stream() {
    return (async function* () {
      yield { type: 'text-delta', text: LINE }
    })()
  },
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`)
}

const stop = startTalker({
  llm,
  engine,
  log: () => {},
  options: { tickMs: 3600000, cardPath: CARD, bubbleMs: 800, provider: 'test', model: 'test', logFile: '', screenScript: join(HERE, 'no-such-screen.ps1') },
})

try {
  await sleep(400) // 等启动那一轮跑完（判否，不出声）
  const before = calls.length
  const r = await stop.poke()
  const fresh = calls.slice(before)

  check('poke 说出来了', r?.spoken === true, `spoken=${r?.spoken} why=${r?.why || ''}`)
  check('用的是模型给的那句', r?.line === LINE, `line=${JSON.stringify(r?.line)}`)

  const said = fresh.filter((c) => c.cmd === 'say')
  check('engine 收到 say', said.length === 1, `${said.length} 次`)
  check('气泡内容是那句', said[0]?.args?.text === LINE, JSON.stringify(said[0]?.args?.text))
  check('气泡带了位置', Number.isFinite(said[0]?.args?.x) && Number.isFinite(said[0]?.args?.y), JSON.stringify({ x: said[0]?.args?.x, y: said[0]?.args?.y }))

  // 静态判据：poke 那段里不该出现任何记账动作。
  const src = readFileSync(join(HERE, '..', 'lib', 'talker.js'), 'utf8')
  const at = src.indexOf('async function poke(')
  const end = src.indexOf('async function tick(', at)
  const pokeBody = at >= 0 && end > at ? src.slice(at, end) : ''
  check('poke 里没有 markSpoken', pokeBody.length > 0 && !pokeBody.includes('markSpoken'))
  check('poke 里没有 savePetState', pokeBody.length > 0 && !pokeBody.includes('savePetState'))
  check('poke 里没有 judgeNudge（不判该不该说）', pokeBody.length > 0 && !pokeBody.includes('judgeNudge'))
} finally {
  try { stop() } catch { /* ignore */ }
  if (existsSync(CARD)) { try { unlinkSync(CARD) } catch { /* ignore */ } }
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
process.exit(bad.length ? 1 : 0)
