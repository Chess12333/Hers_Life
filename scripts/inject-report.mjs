#!/usr/bin/env node
// scripts/inject-report.mjs —— 把「本插件组装了多少」和「上一轮真的送了多少」摆在一起（交接书 K.2 / K-3）
//
// 三档必须分开，不许混：
//   ① 组装值   —— 本插件自己拼出来的字（live/inject-account.json，K-1 落盘）
//   ② 实际请求 —— 宿主/提供商返回的 prompt tokens（~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite）
//   ③ 费用估算 —— 由 graph 的 cost-lib 负责，这里不重复算，只指过去
//
// 不做的事：不拿字符数推 token（中文一字符≠一 token，缓存命中/未命中算法也不一样），
//          不把差值当 bug（差值主要是历史、工具说明、附件、系统提示——那些这一层看不见）。
//
// 用法：
//   node scripts/inject-report.mjs               # 看最近一轮 vs 组装快照
//   node scripts/inject-report.mjs --last=5      # 最近 5 轮
//   node scripts/inject-report.mjs --json        # 机器可读

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const flag = (k, d = '') => {
  const a = argv.find((x) => x.startsWith('--' + k + '='))
  if (a) return a.slice(k.length + 3)
  const i = argv.indexOf('--' + k)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return d
}
const has = (k) => argv.includes('--' + k)

const LIVE = flag('live') || (process.env.MING_WORKSPACE ? path.join(process.env.MING_WORKSPACE, 'live') : 'live')
const SNAP = path.join(LIVE, 'inject-account.json')
const LEDGER = flag('ledger') || path.join(os.homedir(), '.dsh', 'dsh-bottom-info-bar', 'usage-ledger.sqlite')
const LAST = Number(flag('last', '1')) || 1

function readSnapshot() {
  try { return JSON.parse(fs.readFileSync(SNAP, 'utf8')) } catch { return null }
}

let DatabaseSync = null
try { ({ DatabaseSync } = await import('node:sqlite')) } catch { DatabaseSync = null }

function readLedger(n) {
  if (!DatabaseSync) return { ok: false, why: '这个 Node 没有 node:sqlite' }
  if (!fs.existsSync(LEDGER)) return { ok: false, why: '找不到账本：' + LEDGER }
  let db
  try { db = new DatabaseSync(LEDGER, { readOnly: true }) } catch (e) { return { ok: false, why: '打不开账本：' + e.message } }
  try {
    const rows = db.prepare('select ts, payload from records order by seq desc limit ?').all(n)
    return {
      ok: true,
      rows: rows.map((r) => {
        let p = {}
        try { p = JSON.parse(r.payload) } catch { /* 坏行跳过字段 */ }
        return {
          ts: r.ts,
          at: new Date(r.ts).toISOString(),
          model: p.model || '',
          provider: p.provider || '',
          sessionId: p.sessionId || '',
          input: Number(p.input) || 0,
          cacheRead: Number(p.cacheRead) || 0,
          cacheWrite: Number(p.cacheWrite) || 0,
          output: Number(p.output) || 0,
          status: p.status || '',
        }
      }),
    }
  } finally {
    try { db.close() } catch {}
  }
}

const snap = readSnapshot()
const led = readLedger(LAST)

const report = {
  at: new Date().toISOString(),
  assembled: snap ? {
    at: snap.at,
    mode: snap.mode,
    totalChars: snap.totalChars,
    blocksSum: snap.blocksSum,
    checksumOk: snap.checksumOk,
    blocks: (snap.blocks || []).map((b) => ({
      key: b.key,
      includedChars: b.includedChars || 0,
      wrapperChars: b.wrapperChars || 0,
      omittedChars: b.omittedChars || 0,
      omittedUnit: b.omittedUnit || 'chars',
    })),
    uncovered: snap.uncovered || [],
  } : null,
  requests: led.ok ? led.rows : [],
  ledgerError: led.ok ? '' : led.why,
}

if (has('json')) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

console.log('【① 本插件组装】' + (snap ? snap.at : '（没有快照：memory 插件还没跑过一轮）'))
if (snap) {
  console.log('  总长 ' + snap.totalChars + ' 字（UTF-16 单元），分块相加 ' + snap.blocksSum + '，'
    + (snap.checksumOk ? '对得上' : '⚠ 对不上（漏算或双算）'))
  const rows = (snap.blocks || []).map((b) => [
    b.key,
    String(b.includedChars || 0),
    String(b.wrapperChars || 0),
    b.omittedChars ? (b.omittedChars + (b.omittedUnit === 'files' ? ' 篇' : ' 字')) : '-',
  ])
  const w = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), ['块', '原文', '包装', '省略'][i].length))
  const line = (cells) => '  ' + cells.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ')
  console.log(line(['块', '原文', '包装', '省略']))
  for (const r of rows) console.log(line(r))
  console.log('  这一层看不见的：' + (report.assembled.uncovered.join(' / ') || '（无）'))
}

console.log('')
if (!led.ok) {
  console.log('【② 实际请求】读不到账本：' + led.why)
} else {
  console.log('【② 实际请求】最近 ' + led.rows.length + ' 轮（来自 usage-ledger.sqlite）')
  for (const r of led.rows) {
    console.log('  ' + r.at + '  ' + r.model + '  输入 ' + r.input + ' tok（缓存命中 ' + r.cacheRead
      + ' / 写入 ' + r.cacheWrite + '）输出 ' + r.output + ' tok'
      + (r.status && r.status !== 'completed' ? '  [' + r.status + ']' : ''))
    if (r.sessionId) console.log('    session ' + r.sessionId)
  }
  console.log('')
  console.log('  说明：输入 token 是**整轮请求**（历史 + 工具说明 + 附件 + 系统提示 + 本插件组装），')
  console.log('        不是本插件那一段。两者不能互推：字符数≠token 数。')
}

console.log('')
console.log('【③ 费用估算】不在这个脚本里：看记忆关系图「费用技能」那一页（graph/cost-lib.mjs）。')
console.log('  那里是按官方价折算的估值，不是实际扣款。')
