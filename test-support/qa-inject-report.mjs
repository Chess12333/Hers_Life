// test-support/qa-inject-report.mjs —— K-2 对照报告：三档分开，不混字符和 token
//
// 用合成快照 + 合成 sqlite 账本跑 scripts/inject-report.mjs，验：
//   · 组装值来自 K-1 的快照（分块对账）
//   · 实际请求来自账本（input/cacheRead/output）
//   · 两档并列显示，脚本自己说明「不能互推」
//   · 账本缺失时如实报错，不编数字
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'inject-report.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'ming-inject-report-'))
const LIVE = join(tmp, 'live')
mkdirSync(LIVE, { recursive: true })

// 合成快照：分块相加等于总长
const blocks = [
  { key: 'heading', includedChars: 0, wrapperChars: 70 },
  { key: 'persona', candidateChars: 120, includedChars: 120, wrapperChars: 10, omittedChars: 0, reason: 'included_full' },
  { key: 'diary', candidateChars: 900, includedChars: 400, wrapperChars: 20, omittedChars: 2, omittedUnit: 'files', reason: 'configured_budget' },
  { key: 'ledger', includedChars: 0, wrapperChars: 60 },
  { key: 'discipline', includedChars: 0, wrapperChars: 120 },
]
const total = blocks.reduce((n, b) => n + (b.includedChars || 0) + (b.wrapperChars || 0), 0)
writeFileSync(join(LIVE, 'inject-account.json'), JSON.stringify({
  schemaVersion: 1, stage: 'assembled', unit: 'utf16_code_units', mode: 'full',
  at: '2026-11-17T04:00:00.000Z', blocks, totalChars: total, blocksSum: total, checksumOk: true,
  uncovered: ['host_history', 'tool_schema', 'attachments'],
}), 'utf8')

// 合成账本
const LEDGER = join(tmp, 'usage-ledger.sqlite')
{
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(LEDGER)
  db.exec('CREATE TABLE records(seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, ts REAL NOT NULL, account TEXT NOT NULL, currency TEXT NOT NULL, cost REAL, offpeak REAL, folded INTEGER NOT NULL, payload TEXT NOT NULL)')
  const ins = db.prepare('INSERT INTO records(id,ts,account,currency,cost,offpeak,folded,payload) VALUES(?,?,?,?,?,?,?,?)')
  const now = Date.parse('2026-11-17T04:00:10Z')
  ins.run('r1', now, 'a', 'CNY', 0, 0, 0, JSON.stringify({
    model: 'test-model', provider: 'test', sessionId: 'session-abc',
    input: 7702, cacheRead: 468096, cacheWrite: 0, output: 453, status: 'completed',
  }))
  db.close()
}

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000 })

// 1) 正常
{
  const r = run(['--live=' + LIVE, '--ledger=' + LEDGER, '--last=1'])
  ok('退出 0', r.status === 0, r.stderr.slice(-300))
  const out = r.stdout
  ok('报「本插件组装」', out.includes('本插件组装'))
  ok('报总长与对账', out.includes(String(total)) && out.includes('对得上'))
  ok('列出分块', out.includes('persona') && out.includes('diary'))
  ok('报「实际请求」', out.includes('实际请求'))
  ok('带出 input tokens', out.includes('7702'))
  ok('带出缓存命中', out.includes('468096'))
  ok('带出 sessionId', out.includes('session-abc'))
  ok('明说不可以互推', out.includes('不能互推') || out.includes('字符数≠token'))
  ok('费用估算指到 graph', out.includes('cost-lib.mjs'))
  ok('省略项按篇报', out.includes('2 篇'))
}

// 2) JSON 模式
{
  const r = run(['--live=' + LIVE, '--ledger=' + LEDGER, '--json'])
  ok('JSON 模式退出 0', r.status === 0)
  let j
  try { j = JSON.parse(r.stdout) } catch { j = null }
  ok('JSON 可解析', !!j)
  ok('JSON 里组装与请求都在', j && j.assembled && Array.isArray(j.requests) && j.requests.length === 1)
  ok('JSON 里请求带 input', j && j.requests[0].input === 7702)
  ok('JSON 不伪造 tokenEstimate', j && !('tokenEstimate' in (j.assembled || {})))
}

// 3) 账本缺失：如实报，不编
{
  const r = run(['--live=' + LIVE, '--ledger=' + join(tmp, 'nope.sqlite')])
  ok('账本缺失仍退出 0（组装值还能看）', r.status === 0)
  ok('明确说读不到账本', r.stdout.includes('读不到账本'))
  ok('没有编 input 数', !r.stdout.includes('7702'))
}

// 4) 没有快照：如实说，不崩
{
  const empty = mkdtempSync(join(tmpdir(), 'ming-empty-'))
  const r = run(['--live=' + join(empty, 'live'), '--ledger=' + LEDGER])
  ok('没有快照时不崩', r.status === 0, r.stderr.slice(-200))
  ok('明说没有快照', r.stdout.includes('没有快照'))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
