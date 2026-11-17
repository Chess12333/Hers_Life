// 2026-11-08 15:03 补丁十五：自动开口的节奏改成和「自己玩」同一种界面/口径。
// 字段：gapMode(fixed|random|heartbeat|off) / hbMin / hbCenter / hbMax / minGapMinutes / dailyMax / nextAt
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dry = process.argv.includes('--dry')
const problems = []
const L = (...x) => x.join('\n')

function load(rel) {
  const p = fileURLToPath(new URL(rel, import.meta.url))
  const raw = readFileSync(p, 'utf8')
  const bom = raw.charCodeAt(0) === 0xfeff
  const b = bom ? raw.slice(1) : raw
  const crlf = b.includes('\r\n')
  return { p, s: crlf ? b.replace(/\r\n/g, '\n') : b, bom, crlf }
}
function write(f, out) {
  if (dry) return
  const b = f.crlf ? out.replace(/\n/g, '\r\n') : out
  writeFileSync(f.p, (f.bom ? '\uFEFF' : '') + b, 'utf8')
}

// ---------------------------------------------------------------- pet.js
const pet = load('../lib/pet.js')
let s = pet.s
function rep(label, from, to) {
  const c = s.split(from).length - 1
  if (c !== 1) { problems.push('pet.js ' + label + ': 匹配 ' + c + ' 次'); return }
  s = s.replace(from, to)
}

rep(
  'schedGapMs 换成三档口径',
  L(
    'export function schedGapMs(state, rand = Math.random) {',
    "  const mode = String(state?.schedMode || 'heartbeat')",
    "  const everyMin = num(state, 'everyMin', 50)",
    '  const base = Math.max(60 * 1000, everyMin * 60 * 1000)',
    "  if (mode === 'off') return 0",
    "  if (mode === 'fixed') return base",
    "  if (mode === 'random') return Math.round(base * (0.5 + rand()))",
    '  const min = base * 0.35',
    '  const max = base * 1.6',
    '  const u = rand()',
    '  const f = (base - min) / (max - min)',
    '  if (u < f) return Math.round(min + Math.sqrt(u * (max - min) * (base - min)))',
    '  return Math.round(max - Math.sqrt((1 - u) * (max - min) * (max - base)))',
    '}',
  ),
  L(
    '// 2026-11-08 15:03 她：「怎么不是做成这样」——参照「自己玩」那条：',
    '// 限额 + 间隔模式（固定/随机/心跳/关）+ 最低/中位/最高 三个数。',
    'export function schedGapMs(state, rand = Math.random) {',
    '  const st = state || {}',
    "  const mode = String(st.gapMode || (st.schedMode === 'off' ? 'off' : (st.schedMode || 'heartbeat')))",
    '  const minutes = (v, d) => {',
    '    const n = Number(v)',
    '    return Number.isFinite(n) && n > 0 ? n : d',
    '  }',
    '  const single = Math.max(1, minutes(st.minGapMinutes ?? st.everyMin, 50)) * 60000',
    "  if (mode === 'off') return 0",
    "  if (mode === 'fixed') return Math.round(single)",
    "  if (mode === 'random') return Math.round(single * (0.5 + rand()))",
    '  const lo = Math.max(0.2, minutes(st.hbMin, 15)) * 60000',
    '  const mid = Math.max(lo, minutes(st.hbCenter, 30) * 60000)',
    '  const midM = Math.max(mid, minutes(st.hbCenter, 30) * 60000)',
    '  const hi = Math.max(midM, minutes(st.hbMax, 60) * 60000)',
    '  const u = rand()',
    '  const f = (midM - lo) / Math.max(1, hi - lo)',
    '  if (u < f) return Math.round(lo + Math.sqrt(u * (hi - lo) * (midM - lo)))',
    '  return Math.round(hi - Math.sqrt((1 - u) * (hi - lo) * (hi - midM)))',
    '}',
  ),
)

rep(
  '每日上限读 dailyMax',
  "  const cap = num(state, 'dailyCap', DAILY_CAP)",
  L(
    '  // 2026-11-08：dailyMax 优先（自己玩那边也叫这个名），老字段 dailyCap 留着兼容。',
    '  const dailyMaxRaw = Number(state?.dailyMax)',
    '  const cap = Number.isFinite(dailyMaxRaw) && dailyMaxRaw >= 0 ? dailyMaxRaw : num(state, \'dailyCap\', DAILY_CAP)',
  ),
)

rep(
  '默认值',
  L("  schedMode: 'heartbeat',", '  everyMin: 50,', '  dailyCap: 6,'),
  L(
    "  gapMode: 'heartbeat',",
    '  hbMin: 15,',
    '  hbCenter: 30,',
    '  hbMax: 60,',
    '  minGapMinutes: 50,',
    '  dailyMax: 6,',
    '  nextAt: 0,',
  ),
)

write(pet, s)

// ---------------------------------------------------------------- talker.js
const tk = load('../lib/talker.js')
let t = tk.s
function rept(label, from, to) {
  const c = t.split(from).length - 1
  if (c !== 1) { problems.push('talker.js ' + label + ': 匹配 ' + c + ' 次'); return }
  t = t.replace(from, to)
}

rept(
  '排期时记 nextAt',
  L(
    '    let gap = fixedTick',
    '    if (!gap) {',
    '      try { gap = schedGapMs(await loadPetState()) } catch { gap = nextGapMs() }',
    '    }',
  ),
  L(
    '    let gap = fixedTick',
    '    if (!gap) {',
    '      try {',
    '        const st = await loadPetState()',
    '        gap = schedGapMs(st)',
    '        // 2026-11-08：把这一轮排到什么时候写进 state，面板上「下次 ≈」就是它。',
    '        if (gap > 0) {',
    '          try { await savePetState({ ...(await loadPetState()), nextAt: Date.now() + gap }) } catch { /* 记不下来不拦 */ }',
    '        }',
    '      } catch { gap = nextGapMs() }',
    '    }',
  ),
)

write(tk, t)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
console.log(dry ? 'dry：全部能匹配' : '写好：pet.js / talker.js')
