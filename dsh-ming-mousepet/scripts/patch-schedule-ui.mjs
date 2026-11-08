// 2026-11-08 14:53 补丁十三：/schedule 接口 + 设置界面里的「自动开口节奏」卡片。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dry = process.argv.includes('--dry')
const problems = []
const L = (...x) => x.join('\n')

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

// ---------------------------------------------------------------- index.js
const ix = load('../index.js')
let s = ix.s
function rep(label, from, to) {
  const c = s.split(from).length - 1
  if (c !== 1) { problems.push('index.js ' + label + ': 匹配 ' + c + ' 次'); return }
  s = s.replace(from, to)
}

rep(
  '/schedule 路由',
  L(
    "      if (req.method === 'POST' && route === '/show') {",
    "        await engine.request('overlay', { show: true }, 30000)",
    '        return json(res, 200, { ok: true })',
    '      }',
    "      return json(res, 404, { ok: false, error: 'not found' })",
  ),
  L(
    "      if (req.method === 'POST' && route === '/show') {",
    "        await engine.request('overlay', { show: true }, 30000)",
    '        return json(res, 200, { ok: true })',
    '      }',
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
    "      return json(res, 404, { ok: false, error: 'not found' })",
  ),
)

write(ix, s)

// ---------------------------------------------------------------- client.js
const cl = load('../client.js')
let c = cl.s
function repc(label, from, to) {
  const n = c.split(from).length - 1
  if (n !== 1) { problems.push('client.js ' + label + ': 匹配 ' + n + ' 次'); return }
  c = c.replace(from, to)
}

repc(
  'state',
  '      const [previewOn, setPreviewOn] = useState(false)',
  L(
    '      const [previewOn, setPreviewOn] = useState(false)',
    '      const [sched, setSched] = useState(null)',
  ),
)

repc(
  'load 读调度',
  L(
    '      const load = async () => {',
    "        const data = await api('/settings')",
    '        applyResult(data)',
    '      }',
  ),
  L(
    '      const load = async () => {',
    "        const data = await api('/settings')",
    '        applyResult(data)',
    '        // 2026-11-08：自动开口的节奏存在 state 文件里，改完下一轮生效，不用重启。',
    "        try { setSched(await api('/schedule')) } catch { setSched(null) }",
    '      }',
  ),
)

repc(
  'save 一起存调度',
  L(
    "          const data = await api('/settings', { method: 'POST', body: settings })",
    '          applyResult(data)',
    "          setNote('已保存并立即生效，不需要重启。')",
  ),
  L(
    "          const data = await api('/settings', { method: 'POST', body: settings })",
    '          applyResult(data)',
    '          if (sched) {',
    '            try {',
    "              const ns = await api('/schedule', { method: 'POST', body: sched })",
    '              setSched(ns)',
    '            } catch (e) {',
    "              setError('节奏没存上：' + e.message)",
    '            }',
    '          }',
    "          setNote('已保存并立即生效，不需要重启。')",
  ),
)

repc(
  '节奏卡片',
  L(
    '        h(\'div\', { style: S.row },',
    '          h(\'button\', { type: \'button\', style: S.primary, disabled: busy, onClick: save }, busy ? \'保存中…\' : \'保存并生效\'),',
  ),
  L(
    '        h(\'div\', { style: S.card },',
    "          h('div', { style: S.title }, '自动开口的节奏'),",
    "          h('div', { style: S.hint }, '桌宠多久自己说一句。关 / 心跳（越靠近基础间隔越容易出现）/ 随机 / 固定。改完下一轮就生效，不用重启。'),",
    "          sched ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },",
    "            h('div', { style: S.row },",
    "              [['heartbeat', '心跳'], ['random', '随机'], ['fixed', '固定'], ['off', '关']].map(([id, label]) =>",
    "                h('button', {",
    "                  key: id, type: 'button',",
    '                  style: S.modeBtn(sched.schedMode === id),',
    '                  onClick: () => setSched((cur) => ({ ...cur, schedMode: id })),',
    '                }, label)),',
    '            ),',
    "            h('div', { style: S.row },",
    "              h('span', { style: S.hint }, '基础间隔'),",
    "              h('input', {",
    "                type: 'number', min: 1, max: 1440, step: 1, style: S.num,",
    '                value: sched.everyMin,',
    "                onChange: (e) => setSched((cur) => ({ ...cur, everyMin: Math.max(1, Math.min(1440, Number(e.target.value) || 50)) })),",
    '              }),',
    "              h('span', { style: S.hint }, '分钟'),",
    "              h('span', { style: S.hint }, '　每天最多'),",
    "              h('input', {",
    "                type: 'number', min: 0, max: 200, step: 1, style: S.num,",
    '                value: sched.dailyCap,',
    "                onChange: (e) => setSched((cur) => ({ ...cur, dailyCap: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })),",
    '              }),',
    "              h('span', { style: S.hint }, '句'),",
    '            ),',
    "            h('div', { style: S.hint }, `今天已经说了 ${sched.spokenToday ?? 0} 句`),",
    "          ) : h('div', { style: S.hint }, '读不到节奏设置'),",
    '        ),',
    '',
    "        h('div', { style: S.row },",
    "          h('button', { type: 'button', style: S.primary, disabled: busy, onClick: save }, busy ? '保存中…' : '保存并生效'),",
  ),
)

write(cl, c)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
console.log(dry ? 'dry：全部能匹配' : '写好：index.js / client.js')
