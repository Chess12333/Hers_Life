/**
 * 卡片「能追问」的契约测试（2026-11-09）。
 *
 * 不连真模型、不连真 sidecar：假 llm + 假 engine。
 * 要证的四条：
 *   1. 问之前先把卡片开起来（第一个 card 动作是 open）；
 *   2. 模型吐的字真的写进卡片（append 里能拼出答案）；
 *   3. 追问时把上一轮带回去（第二次的 messages 比第一次长）；
 *   4. 关掉重置之后就不带了（resetCard 之后回到 1 条）。
 *
 * 另外：startTalker 会写 ~/.dsh/ming-mousepet/pet-state.json 的 nextAt，
 * 那是桌面那只正在用的文件——测完原样写回去，别打乱她的心跳。
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { startTalker } from '../lib/talker.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CARD = join(HERE, 'tmp-ask-card.md')
const STATE = join(homedir(), '.dsh', 'ming-mousepet', 'pet-state.json')

writeFileSync(CARD, '# 测试卡\n\n答得短一点。\n', 'utf8')
const stateBefore = existsSync(STATE) ? readFileSync(STATE) : null

const calls = []
const engine = {
  async request(cmd, args = {}) {
    calls.push({ cmd, args })
    if (cmd === 'status') return { paused: true, cursor: { x: 100, y: 100 }, screen: { x: 0, y: 0, w: 1920, h: 1080 } }
    if (cmd === 'winInfo') return { rect: { x: 0, y: 0, w: 900, h: 700 } }
    if (cmd === 'card') return { ok: true, open: true, bounds: '10,10,440,360', lines: 1 }
    return { ok: true }
  },
}

const seen = []
const llm = {
  stream(options) {
    seen.push(options)
    return (async function* () {
      yield { type: 'text-delta', text: '第一句。' }
      yield { type: 'text-delta', text: '第二句。' }
    })()
  },
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `：${detail}` : ''}`)
}

const talker = startTalker({
  llm,
  engine,
  options: { cardPath: CARD, bubbleMs: 1200, provider: 'test', model: 'fixture' },
  log: () => {},
})

// 冷启动那一轮别参进来
calls.length = 0
seen.length = 0

try {
  const r1 = await talker.cardAsk('这是什么', ['她刚指了网页上一块：测试'])
  const cardOps1 = calls.filter((c) => c.cmd === 'card').map((c) => c.args.op)
  check('先开卡再写', cardOps1[0] === 'open', cardOps1.join(','))
  check('答成了', r1.ok === true, r1.why || '')
  const written1 = calls.filter((c) => c.cmd === 'card' && c.args.op === 'append').map((c) => c.args.text).join('')
  check('答案写进卡片', written1.includes('第一句') && written1.includes('第二句'), written1.replace(/\n/g, '\\n').slice(0, 60))
  check('带上她指过的东西', String(seen[0]?.messages?.[0]?.content?.[0]?.text || '').includes('她刚指了网页上一块'), '')
  const len1 = seen[0]?.messages?.length || 0
  check('第一问只有一条用户消息', len1 === 1, `messages=${len1}`)

  calls.length = 0
  const r2 = await talker.cardAsk('那这个呢')
  const len2 = seen[1]?.messages?.length || 0
  check('追问把上一轮带回去', len2 >= 3, `messages=${len2}`)
  check('第二问也答成了', r2.ok === true, r2.why || '')

  talker.resetCard()
  await talker.cardAsk('重新开始')
  const len3 = seen[2]?.messages?.length || 0
  check('关掉重置后不带历史', len3 === 1, `messages=${len3}`)

  const noLlm = startTalker({ llm: null, engine, options: { cardPath: CARD }, log: () => {} })
  const r4 = await noLlm.cardAsk('没模型的时候')
  check('没模型不崩、给原因', r4.ok === false && Boolean(r4.why), r4.why || '')
  noLlm()
} catch (error) {
  check('跑完', false, error?.message || String(error))
} finally {
  talker()
  if (stateBefore) writeFileSync(STATE, stateBefore)
  if (existsSync(CARD)) unlinkSync(CARD)
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 过`)
if (bad.length) process.exitCode = 1
