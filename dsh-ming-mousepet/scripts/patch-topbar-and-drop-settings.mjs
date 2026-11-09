// 2026-11-08 15:18 补丁十八：
//   1) 设置栏里那个「桌宠」节删掉（功能都在「她的一生」→ 桌宠页里了）
//   2) 「她的一生」面板 top 栏做明显一点
import { readFileSync, writeFileSync } from 'node:fs'

const dry = process.argv.includes('--dry')
const problems = []

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

// ---------------------------------------------------------------- mousepet client：去掉设置节
const cl = load('C:/dsh/dsh-ming-mousepet/client.js')
let c = cl.s
const OLD = [
  '    return {',
  "      inject: ['slots'],",
  '      apply(ctx) {',
  "        ctx.slots.inject('settings.section', () => ctx.slots.register({",
  "          name: 'settings.section',",
  "          id: 'ming-mousepet',",
  '          order: 70,',
  "          label: () => '桌宠',",
  '        }, Page))',
  '      },',
  '    }',
].join('\n')
const NEW = [
  '    return {',
  '      // 2026-11-08 15:17 她：「把设置栏中的桌宠删掉」。',
  '      // 光标 / 皮肤 / 自动开口现在全在「她的一生」→ 桌宠页里，设置栏这一节是重复的。',
  '      apply() {},',
  '    }',
].join('\n')
if (c.split(OLD).length - 1 !== 1) problems.push('client.js 设置节注册: 没匹配到')
else c = c.replace(OLD, NEW)
write(cl, c)

// ---------------------------------------------------------------- graph panel：top 栏
const pn = load('C:/dsh/dsh-ming-graph/src/panel.js')
let s = pn.s
function rep(label, from, to) {
  const n = s.split(from).length - 1
  if (n !== 1) { problems.push('panel.js ' + label + ': 匹配 ' + n + ' 次'); return }
  s = s.replace(from, to)
}

rep(
  'mg-top',
  '.mg-top{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-separator-secondary)}',
  '.mg-top{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 14px;background:var(--dsw-alias-bg-secondary, rgba(127,127,127,.07));border-bottom:1px solid var(--dsw-alias-separator-primary, rgba(150,150,170,.45));box-shadow:inset 0 -1px 0 rgba(0,0,0,.18)}',
)

rep(
  'mg-brand',
  '.mg-brand{display:inline-flex;align-items:baseline;gap:7px;margin-right:8px;font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary);white-space:nowrap}',
  '.mg-brand{display:inline-flex;align-items:baseline;gap:7px;margin-right:10px;font-size:16px;font-weight:700;letter-spacing:.01em;color:var(--dsw-alias-label-primary);white-space:nowrap}',
)

rep(
  'mg-brand i',
  '.mg-brand i{font-style:normal;font-size:10px;font-weight:400;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);opacity:.7}',
  '.mg-brand i{font-style:normal;font-size:10px;font-weight:400;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);opacity:.55}',
)

rep(
  'mg-seg',
  '.mg-seg{display:inline-flex;border:1px solid var(--dsw-alias-separator-secondary);border-radius:6px;overflow:hidden}',
  '.mg-seg{display:inline-flex;border:1px solid var(--dsw-alias-separator-primary, rgba(150,150,170,.42));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-primary, rgba(0,0,0,.16))}',
)

rep(
  'mg-seg button',
  '.mg-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:3px 10px;cursor:pointer}',
  '.mg-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;padding:6px 15px;cursor:pointer}',
)

rep(
  'mg-seg button.on',
  '.mg-seg button.on{background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
  '.mg-seg button.on{background:var(--dsw-alias-brand-primary, #6aa9ff);color:#08111f;font-weight:700}',
)

write(pn, s)

if (problems.length) { console.error('没写成：\n' + problems.join('\n')); process.exit(1) }
console.log(dry ? 'dry：OK' : '写好：client.js / panel.js')
