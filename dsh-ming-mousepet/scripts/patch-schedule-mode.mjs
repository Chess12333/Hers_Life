// 2026-11-08 14:52 补丁十二（第二版）：自动开口的节奏交给她自己调。
// 用普通字符串拼接，避免模板字符串把 ${...} 提前求值。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dry = process.argv.includes('--dry')
const problems = []
const L = (...lines) => lines.join('\n')

function load(rel) {
  const p = fileURLToPath(new URL(rel, import.meta.url))
  const raw = readFileSync(p, 'utf8')
  const bom = raw.charCodeAt(0) === 0xfeff
  const body = bom ? raw.slice(1) : raw
  const crlf = body.includes('\r\n')
  return { p, s: crlf ? body.replace(/\r\n/g, '\n') : body, bom, crlf }
}
function write(f, out) {
  if (dry) return
  const body = f.crlf ? out.replace(/\n/g, '\r\n') : out
  writeFileSync(f.p, (f.bom ? '\uFEFF' : '') + body, 'utf8')
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
  '默认值',
  L('  spokenToday: { day: \'\', count: 0 },'),
  L(
    '  spokenToday: { day: \'\', count: 0 },',
    '  // 2026-11-08 浔要的：自动开口的节奏自己调——心跳 / 随机 / 固定 / 关。',
    "  schedMode: 'heartbeat',",
    '  everyMin: 50,',
    '  dailyCap: 6,',
  ),
)

rep(
  '每日上限读 state',
  L(
    '  if (context.spokenToday >= DAILY_CAP) {',
    '    return { speak: false, why: `今天已经说了 ${context.spokenToday} 次，够了`, context }',
    '  }',
  ),
  L(
    "  const cap = num(state, 'dailyCap', DAILY_CAP)",
    '  if (context.spokenToday >= cap) {',
    '    return { speak: false, why: `今天已经说了 ${context.spokenToday} 次（上限 ${cap}），够了`, context }',
    '  }',
  ),
)

rep(
  'schedGapMs',
  L('export function judgeNudge({ now = new Date(), status, state } = {}) {'),
  L(
    '// 2026-11-08：下一次多久之后再探一次。四种模式——',
    '//   off        关，不排下一轮（留一分钟的复查，改回来自动恢复）',
    '//   fixed      每 everyMin 分钟一次，不管前面说没说过',
    '//   random     everyMin 的 0.5~1.5 倍之间随机',
    '//   heartbeat  以 everyMin 为中位，0.35~1.6 倍，越靠中位越密（默认）',
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
    '',
    'export function judgeNudge({ now = new Date(), status, state } = {}) {',
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
  'import schedGapMs',
  "import { judgeNudge, loadPetState, markSpoken, savePetState } from './pet.js'",
  "import { judgeNudge, loadPetState, markSpoken, savePetState, schedGapMs } from './pet.js'",
)

rept(
  'scheduleNext 读调度模式',
  L('  const scheduleNext = () => {', '    const gap = fixedTick || nextGapMs()'),
  L(
    '  const scheduleNext = async () => {',
    '    // 2026-11-08：间隔交给 pet.js 的 schedGapMs，按 state 里的',
    '    // schedMode（off/heartbeat/random/fixed）+ everyMin 算，改完下一轮就生效。',
    '    let gap = fixedTick',
    '    if (!gap) {',
    '      try { gap = schedGapMs(await loadPetState()) } catch { gap = nextGapMs() }',
    '    }',
    '    if (!gap || gap <= 0) {',
    '      // 关掉了：不排下一轮，只留一分钟的复查，她把模式改回来自动接着跑。',
    '      timer = setTimeout(() => { if (!stopped) scheduleNext() }, 60 * 1000)',
    "      if (typeof timer.unref === 'function') timer.unref()",
    '      if (midTimer) clearTimeout(midTimer)',
    '      return 0',
    '    }',
  ),
)

write(tk, t)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
console.log(dry ? 'dry：全部能匹配' : '写好：pet.js / talker.js')
