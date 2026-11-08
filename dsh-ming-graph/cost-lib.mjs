/**
 * cost-lib.mjs —— 我们自己的费用账（2026-11-08）
 *
 * 为什么自己算：面板「费用」页一直显示「读不到费用」。
 * 查下来 dsh-bottom-info-bar 的账本**记得很清楚**，但它内置价目表里没有
 * `deepseek-v4.1-flash` 这个写法（它有的是 `deepseek-flash` 和
 * `volcengine-ark:deepseek-v4-1-flash-*`），于是 4.5 万条记录全被标成 unpriced，
 * getUsageSummary 就返回不出数——不是没数，是没价。
 *
 * 这一份只读它的 sqlite，按我们自己的价目表算；价目表放
 * `hers_workplace/live/cost-prices.json`（`{ "models": { 模型名: {peak:[命中,未命中,输出], offpeak:[...] } } }`），
 * 缺省用这里内置的官方价。
 *
 * 口径写在返回值里（basis），别让它变成第二个"看起来有数"的地方。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/** CNY / 百万 tokens：[缓存命中, 输入未命中, 输出]。峰谷跟官方一致：北京时间工作日 9-12、14-18 为高峰。 */
export const BUILTIN_PRICES = {
  'deepseek-flash': { peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0] },
  'deepseek-v4.1-flash': { peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0] },
  'deepseek-v4-flash': { peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0] },
  'deepseek-v4-flash-vision-exp': { peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0] },
  'deepseek-v4-pro': { peak: [0.30, 9.0, 27.0], offpeak: [0.15, 4.5, 13.5] },
}

export const DEFAULT_LEDGER = path.join(os.homedir(), '.dsh', 'dsh-bottom-info-bar', 'usage-ledger.sqlite')

function loadPrices(pricesFile) {
  let extra = {}
  if (pricesFile) {
    try {
      const j = JSON.parse(fs.readFileSync(pricesFile, 'utf8'))
      extra = (j && j.models) || {}
    } catch { /* 没有就用内置的 */ }
  }
  return { ...BUILTIN_PRICES, ...extra }
}

/** 北京时间；工作日 09:00–12:00 / 14:00–18:00 算高峰。节假日没单算（会略微高估）。 */
function isPeak(ts) {
  const d = new Date(ts + 8 * 3600e3)
  const day = d.getUTCDay()
  if (day === 0 || day === 6) return false
  const m = d.getUTCHours() * 60 + d.getUTCMinutes()
  return (m >= 540 && m < 720) || (m >= 840 && m < 1080)
}

const dayKey = (ts) => new Date(ts + 8 * 3600e3).toISOString().slice(0, 10)

function tally(rows, prices) {
  let cost = 0
  let unpricedRecords = 0
  let unpricedTokens = 0
  const byModel = new Map()
  for (const r of rows) {
    const p = prices[r.model]
    const b = byModel.get(r.model) || { model: r.model, records: 0, input: 0, cacheRead: 0, output: 0, cost: 0, priced: !!p }
    b.records += 1
    b.input += r.input
    b.cacheRead += r.cacheRead
    b.output += r.output
    if (p) {
      const t = isPeak(r.ts) ? p.peak : p.offpeak
      const c = (r.input * t[1] + r.cacheRead * t[0] + r.cacheWrite * t[1] + r.output * t[2]) / 1e6
      cost += c
      b.cost += c
    } else {
      unpricedRecords += 1
      unpricedTokens += r.input + r.cacheRead + r.output
    }
    byModel.set(r.model, b)
  }
  return {
    cost,
    records: rows.length,
    input: rows.reduce((s, r) => s + r.input, 0),
    cacheRead: rows.reduce((s, r) => s + r.cacheRead, 0),
    output: rows.reduce((s, r) => s + r.output, 0),
    unpricedRecords,
    unpricedTokens,
    models: [...byModel.values()].sort((a, b) => b.records - a.records),
  }
}

/**
 * @param {{ledger?:string, pricesFile?:string, now?:number}} opts
 * @returns {{ok:boolean, error?:string, at?:string, periods?:object, basis?:string, pricesSource?:string}}
 */
export function readCost(opts = {}) {
  const ledger = opts.ledger || DEFAULT_LEDGER
  const pricesFile = opts.pricesFile || ''
  const now = opts.now || Date.now()

  if (!fs.existsSync(ledger)) {
    return { ok: false, error: '找不到账本：' + ledger }
  }
  let db
  try {
    db = new DatabaseSync(ledger, { readOnly: true })
    const rows = db.prepare(`select ts as ts,
        json_extract(payload,'$.model') as model,
        coalesce(json_extract(payload,'$.input'),0) as input,
        coalesce(json_extract(payload,'$.cacheRead'),0) as cacheRead,
        coalesce(json_extract(payload,'$.cacheWrite'),0) as cacheWrite,
        coalesce(json_extract(payload,'$.output'),0) as output
      from records order by ts desc`).all()
    const prices = loadPrices(pricesFile)
    const today = dayKey(now)
    const month = today.slice(0, 7)
    const d30 = now - 30 * 86400e3
    const pick = {
      today: rows.filter((r) => dayKey(r.ts) === today),
      month: rows.filter((r) => dayKey(r.ts).startsWith(month)),
      d30: rows.filter((r) => r.ts >= d30),
      all: rows,
    }
    const periods = {}
    for (const k of Object.keys(pick)) periods[k] = tally(pick[k], prices)
    return {
      ok: true,
      at: new Date().toISOString(),
      ledger,
      pricesSource: pricesFile && fs.existsSync(pricesFile) ? pricesFile : '内置价目',
      basis: '按 DeepSeek 官方价折算（CNY/百万 tokens，工作日 9-12、14-18 走高峰价，节假日未单算）——不是实际扣款：我们走的是 wb-proxy 额度。',
      periods,
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) }
  } finally {
    try { db && db.close() } catch { /* ignore */ }
  }
}
