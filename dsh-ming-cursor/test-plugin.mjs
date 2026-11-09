// 不装进 DSH 也能验：mock 一个最小 ctx，看 apply 能不能把两个工具和两条路由挂上。
import { apply } from './index.js'

const tools = []
const routes = []
const logs = []
const ctx = {
  logger: { info: (m) => logs.push(m) },
  tools: { register: (t) => { tools.push(t); return () => {} } },
  webServer: { register: (spec) => { routes.push(spec); return () => {} } },
  effect: (fn) => { const d = fn(); return d },
}

await apply(ctx, { size: 64, mode: 'companion' })

let fail = 0
const check = (ok, msg, extra) => { console.log((ok ? '✓ ' : '✗ ') + msg + (extra ? '  ' + extra : '')); if (!ok) fail++ }

check(tools.length === 2, '注册了两个工具', tools.map((t) => t.name).join(' / '))
check(tools.some((t) => t.name === 'cursor'), 'cursor 在')
check(tools.some((t) => t.name === 'cursor_say'), 'cursor_say 在')
check(routes.length === 2, '挂了两条路由', routes.map((r) => r.path).join(' / '))
// 2026-11-10 的教训：DSH 强制每个工具声明 output，不写就 TypeError、整个插件被判 failed，
// 界面上只表现为「工具没出现、路由 404」。所以这条必须本地就查得出来，不能等重启看日志。
check(
  tools.every((t) => t.output && t.output.schema && typeof t.output.render === 'function'),
  '每个工具都声明了 output（DSH 强制）',
  tools.filter((t) => !t.output).map((t) => t.name).join(',') || '都齐',
)

const cursor = tools.find((t) => t.name === 'cursor')
const r = await cursor.execute({ action: 'status' })
// 本机装着完整版时，status 会老实回「完整版在场，不启动」——那也是对的，别判成失败
check((r && r.meta && r.meta.ok === true) || /光标/.test(r.text) || /完整版/.test(r.text), 'status 能跑', r && r.text)
const bad = await cursor.execute({ action: 'nope' })
check(bad.meta.ok === false, '不认识的 action 会报错')

// 路由要真调一次：handler 的签名是 (req,res,next)，路径从 req.url 解析。
// 2026-11-10 踩过——把第三参当 url 读，每条路由都落成 '/'，界面上只看到 404。
const apiRoute = routes.find((x) => x.path.endsWith('/api'))
if (apiRoute && typeof apiRoute.handler === 'function') {
  const res = { code: 0, body: '', writeHead(c) { this.code = c }, end(b) { this.body = String(b || '') } }
  await apiRoute.handler({ method: 'GET', url: '/dsh-ming-cursor/api/settings' }, res, () => {})
  let parsed = null
  try { parsed = JSON.parse(res.body) } catch { }
  check(res.code === 200 && parsed && parsed.ok === true && parsed.settings, 'GET /api/settings 走得到', 'code=' + res.code)
} else {
  check(false, '拿到 api 路由的 handler')
}

console.log(fail ? `\n✗ ${fail} 项没过` : '\n✓ 插件层通')
process.exit(fail ? 1 : 0)
