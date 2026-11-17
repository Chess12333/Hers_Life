// 2026-11-08 15:04 补丁十六：/schedule 换成「自己玩」那套字段；桌宠面板画成同一种条。
import { readFileSync, writeFileSync } from 'node:fs'

const dry = process.argv.includes('--dry')
const problems = []
const L = (...x) => x.join('\n')

function load(p) {
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

// ---------------------------------------------------------------- index.js
const ix = load('C:/dsh/dsh-ming-mousepet/index.js')
let s = ix.s
function rep(label, from, to) {
  const c = s.split(from).length - 1
  if (c !== 1) { problems.push('index.js ' + label + ': 匹配 ' + c + ' 次'); return }
  s = s.replace(from, to)
}

rep(
  '/schedule 字段',
  L(
    "      if (route === '/schedule') {",
    "        if (req.method === 'GET') {",
    '          const st = await loadPetState()',
    '          return json(res, 200, {',
    '            ok: true,',
    "            schedMode: String(st.schedMode || 'heartbeat'),",
    '            everyMin: Number(st.everyMin) || 50,',
    '            dailyCap: Number(st.dailyCap) || 6,',
    '            quietHours: st.quietHours !== false,',
    '            spokenToday: spokenToday(st),',
    '          })',
    '        }',
    "        if (req.method === 'POST') {",
    '          const body = await readBody(req)',
    '          const st = await loadPetState()',
    '          const next = { ...st }',
    "          const mode = String(body?.schedMode || '')",
    "          if (['off', 'heartbeat', 'random', 'fixed'].includes(mode)) next.schedMode = mode",
    '          const every = Number(body?.everyMin)',
    '          if (Number.isFinite(every)) next.everyMin = Math.max(1, Math.min(1440, Math.round(every)))',
    '          const cap = Number(body?.dailyCap)',
    '          if (Number.isFinite(cap)) next.dailyCap = Math.max(0, Math.min(200, Math.round(cap)))',
    "          if (typeof body?.quietHours === 'boolean') next.quietHours = body.quietHours",
    '          await savePetState(next)',
    '          return json(res, 200, {',
    '            ok: true,',
    "            schedMode: String(next.schedMode || 'heartbeat'),",
    '            everyMin: Number(next.everyMin) || 50,',
    '            dailyCap: Number(next.dailyCap) || 6,',
    '            quietHours: next.quietHours !== false,',
    '            spokenToday: spokenToday(next),',
    '          })',
    '        }',
    '      }',
  ),
  L(
    "      if (route === '/schedule') {",
    '        // 2026-11-08 15:03：字段跟「自己玩」对齐——',
    '        // gapMode(fixed|random|heartbeat|off) / hbMin / hbCenter / hbMax / minGapMinutes / dailyMax / nextAt。',
    '        const view = (st) => {',
    '          const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d }',
    '          return {',
    '            ok: true,',
    "            gapMode: String(st.gapMode || st.schedMode || 'heartbeat'),",
    '            hbMin: n(st.hbMin, 15),',
    '            hbCenter: n(st.hbCenter, 30),',
    '            hbMax: n(st.hbMax, 60),',
    '            minGapMinutes: n(st.minGapMinutes ?? st.everyMin, 50),',
    '            dailyMax: n(st.dailyMax ?? st.dailyCap, 6),',
    '            nextAt: n(st.nextAt, 0),',
    '            quietHours: st.quietHours !== false,',
    '            spokenToday: spokenToday(st),',
    '          }',
    '        }',
    "        if (req.method === 'GET') {",
    '          return json(res, 200, view(await loadPetState()))',
    '        }',
    "        if (req.method === 'POST') {",
    '          const body = await readBody(req)',
    '          const st = await loadPetState()',
    '          const next = { ...st }',
    '          const clamp = (v, lo, hi, d) => {',
    '            const x = Number(v)',
    '            return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d',
    '          }',
    "          const mode = String(body?.gapMode || '')",
    "          if (['off', 'heartbeat', 'random', 'fixed'].includes(mode)) next.gapMode = mode",
    '          if (body?.hbMin !== undefined) next.hbMin = clamp(body.hbMin, 1, 1440, 15)',
    '          if (body?.hbCenter !== undefined) next.hbCenter = clamp(body.hbCenter, 1, 1440, 30)',
    '          if (body?.hbMax !== undefined) next.hbMax = clamp(body.hbMax, 1, 1440, 60)',
    '          if (body?.minGapMinutes !== undefined) next.minGapMinutes = clamp(body.minGapMinutes, 1, 1440, 50)',
    '          if (body?.dailyMax !== undefined) next.dailyMax = clamp(body.dailyMax, 0, 999, 6)',
    "          if (typeof body?.quietHours === 'boolean') next.quietHours = body.quietHours",
    '          await savePetState(next)',
    '          return json(res, 200, view(next))',
    '        }',
    '      }',
  ),
)

write(ix, s)

// ---------------------------------------------------------------- panel.js
const pn = load('C:/dsh/dsh-ming-graph/src/panel.js')
let c = pn.s
function repc(label, from, to) {
  const n = c.split(from).length - 1
  if (n !== 1) { problems.push('panel.js ' + label + ': 匹配 ' + n + ' 次'); return }
  c = c.replace(from, to)
}

const oldStart = L(
  "    h('div', { className: 'mg-pop-sec' },",
  "      h('h3', null, '自动开口的节奏'),",
)
const startIdx = c.indexOf(oldStart)
if (startIdx < 0) problems.push('panel.js 找不到上一版的节奏块')
else {
  const endMark = L('        : h(\'span\', { className: \'mg-pop-sub\' }, \'读不到节奏设置\'),', '    ),')
  const endIdx = c.indexOf(endMark, startIdx)
  if (endIdx < 0) problems.push('panel.js 找不到节奏块结尾')
  else {
    const endPos = endIdx + endMark.length
    const box = (key, label, hint) => L(
      "              h('span', { className: 'mg-pop-sub' }, '" + label + "'),",
      "              h('input', {",
      "                className: 'mg-input', type: 'number', min: 1, max: 1440, title: '" + hint + "',",
      '                value: sched.' + key + ',',
      '                onChange: (e) => setSched((cur) => ({ ...cur, ' + key + ': Number(e.target.value) })),',
      '                onBlur: (e) => saveSched({ ' + key + ': Number(e.target.value) }),',
      '              }),',
    )
    const next = L(
      "    h('div', { className: 'mg-pop-sec' },",
      "      h('h3', null, '自动开口的节奏'),",
      '      sched',
      "        ? h('div', null,",
      "            h('div', { className: 'mg-petrow' },",
      "              h('button', {",
      "                className: 'mg-btn',",
      "                title: '关了就完全不自己开口；点回来恢复',",
      '                style: sched.gapMode === \'off\' ? { borderColor: \'#ff6b6b\', color: \'#ff6b6b\' } : null,',
      '                onClick: () => saveSched({ gapMode: sched.gapMode === \'off\' ? \'heartbeat\' : \'off\' }),',
      "              }, sched.gapMode === 'off' ? '关着 ✓' : '开'),",
      "              h('span', { className: 'mg-pop-sub' }, '每日'),",
      "              h('input', {",
      "                className: 'mg-input', type: 'number', min: 0, max: 999, title: '一天最多说几句（0 = 不说）',",
      '                value: sched.dailyMax,',
      '                onChange: (e) => setSched((cur) => ({ ...cur, dailyMax: Number(e.target.value) })),',
      '                onBlur: (e) => saveSched({ dailyMax: Number(e.target.value) }),',
      '              }),',
      "              h('span', { className: 'mg-pop-sub' }, '次 · 间隔'),",
      "              h('select', {",
      "                className: 'mg-input',",
      '                value: sched.gapMode,',
      '                onChange: (e) => saveSched({ gapMode: e.target.value }),',
      '              },',
      "                h('option', { value: 'fixed' }, '固定'),",
      "                h('option', { value: 'random' }, '随机'),",
      "                h('option', { value: 'heartbeat' }, '心跳'),",
      '              ),',
      "              sched.gapMode === 'heartbeat'",
      "                ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },",
      box('hbMin', '最低', '最短隔多久'),
      box('hbCenter', '中位', '最常落在这个数上'),
      box('hbMax', '最高', '最长隔多久'),
      "                  h('span', { className: 'mg-pop-sub' }, '分'),",
      '                )',
      "                : h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },",
      box('minGapMinutes', '间隔', '多少分钟一次（随机模式在这个数上浮动）'),
      "                  h('span', { className: 'mg-pop-sub' }, '分'),",
      '                ),',
      "              sched.nextAt ? h('span', { className: 'mg-pop-sub', style: { whiteSpace: 'nowrap' } },",
      "                '下次 ≈ ' + new Date(sched.nextAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)) : null,",
      "              h('button', { className: 'mg-btn', onClick: () => loadSched() }, '刷新'),",
      '            ),',
      "            h('div', { className: 'mg-pop-sub' }, '今天已经说了 ' + (sched.spokenToday || 0) + ' 句'),",
      '          )',
      "        : h('span', { className: 'mg-pop-sub' }, '读不到节奏设置'),",
      '    ),',
    )
    c = c.slice(0, startIdx) + next + c.slice(endPos)
  }
}

write(pn, c)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
console.log(dry ? 'dry：OK' : '写好：index.js / panel.js')
