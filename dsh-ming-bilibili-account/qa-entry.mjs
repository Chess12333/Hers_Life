// dsh-ming-bilibili-account/qa-entry.mjs —— 走**真实入口**的账号状态验收（核查 R01）
//
// 为什么单独一个文件：qa-account 测的是 lib/account.mjs 纯模块，它通过不代表入口接上了。
// 2026-11-17 的病正是「模块好、入口没接」：applyRestore 在 apply 外面引用 rebuildProvider，
// 一进去就 ReferenceError，被 catch 吞掉 → 显示已登录、provider 没换、nav 没校验。
//
// 这里加载真的 index.js，用假宿主 + 假网络复现三个反例：
//   G-RESTORE      服务里有 cookie  → 必须真的校验 nav 并换 provider
//   G-TOMBSTONE    文件是退出标记  → 就算服务里还有 cookie，也不许登回来
//   G-LOGOUT-RACE  poll 在飞时退出  → 迟到的结果不许把号登回去、不许覆盖退出标记
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// 宿主那几个包在离线环境里不存在：复制一份插件到临时目录，塞三个最小 stub 再加载，
// 这样测的仍是**真的 index.js**（跟 qa-load 一个做法）。
const sandbox = mkdtempSync(join(tmpdir(), 'ming-bili-entry-src-'))
cpSync(here, join(sandbox, 'plugin'), { recursive: true })
const stubs = {
  'dsh-tools': 'export const defineTool = x => x;',
  'dsh-attachment': 'export const AttachmentId = x => x;',
  'dsh-llm': 'export const createUserMessage = x => x;',
}
for (const [name, code] of Object.entries(stubs)) {
  const dir2 = join(sandbox, 'node_modules', '@deepseek-ai', name)
  mkdirSync(dir2, { recursive: true })
  writeFileSync(join(dir2, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
  writeFileSync(join(dir2, 'index.js'), code)
}
const ENTRY = pathToFileURL(join(sandbox, 'plugin', 'index.js')).href

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// —— 假网络：只认三条路由，记录调用次数 ——
const net = { nav: 0, generate: 0, poll: 0, pollGate: null }
const json = (body, cookies) => ({
  status: 200,
  text: async () => JSON.stringify(body),
  headers: { getSetCookie: () => cookies || [] },
})
const originalFetch = globalThis.fetch
const originalError = console.error
const errors = []
console.error = (...a) => errors.push(a.join(' '))
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('/x/web-interface/nav')) {
    net.nav += 1
    return json({ code: 0, data: { isLogin: true, uname: '测试号', mid: 123456 } })
  }
  if (u.includes('/qrcode/generate')) {
    net.generate += 1
    return json({ code: 0, data: { qrcode_key: 'key-1', url: 'https://passport.test/qr' } })
  }
  if (u.includes('/qrcode/poll')) {
    net.poll += 1
    if (net.pollGate) await net.pollGate
    return json({ code: 0, data: { code: 0 } }, ['SESSDATA=new-cookie; Path=/', 'bili_jct=csrf-new; Path=/', 'DedeUserID=123456; Path=/'])
  }
  return json({ code: -1 })
}

/** 造一个最小宿主：只给插件真正用到的面。 */
function makeCtx(service) {
  const tools = new Map()
  const ctx = {
    credentials: service,
    systemPrompt: { section() {} },
    tools: { register: (t) => tools.set(t.name, t) },
    inject(_deps, fn) { try { fn(ctx) } catch { /* 没装 attachments 就当没有 */ } },
    attachments: {},
  }
  return { ctx, tools }
}

const dir = mkdtempSync(join(tmpdir(), 'ming-bili-entry-'))
const credFile = join(dir, 'cred.json')
const svcStore = new Map()
const service = {
  resolve: async (k) => (svcStore.has(k) ? { value: svcStore.get(k) } : null),
  set: async (k, v) => { svcStore.set(k, v) },
  unset: async (k) => { svcStore.delete(k) },
}

const { apply } = await import(ENTRY)

// —— G-RESTORE：服务里有 cookie，文件不存在 ——
{
  net.nav = 0
  svcStore.set('MING_BILI_COOKIE', 'SESSDATA=svc-cookie; bili_jct=csrf-svc; DedeUserID=999')
  const { ctx, tools } = makeCtx(service)
  apply(ctx, { credentialFile: credFile })
  await tick()
  ok('G-RESTORE 恢复时真的校验了 nav', net.nav >= 1, 'nav=' + net.nav)
  const st = await tools.get('bili_login').execute({ action: 'status' })
  ok('G-RESTORE 校验通过后显示已登录', /已登录/.test(st) && /测试号/.test(st), st)
}

// —— G-TOMBSTONE：文件写着退出过，服务里还残留 cookie ——
{
  writeFileSync(credFile, JSON.stringify({ loggedOutAt: '2026-11-17T10:00:00Z' }), 'utf8')
  svcStore.set('MING_BILI_COOKIE', 'SESSDATA=old-cookie; bili_jct=csrf-old; DedeUserID=999')
  const { ctx, tools } = makeCtx(service)
  apply(ctx, { credentialFile: credFile })
  await tick()
  const st = await tools.get('bili_login').execute({ action: 'status' })
  ok('G-TOMBSTONE 退出标记优先于服务里的旧 cookie', !/已登录/.test(st), st)
  ok('G-TOMBSTONE 顺手把服务里那份清了', !svcStore.has('MING_BILI_COOKIE'), JSON.stringify([...svcStore.keys()]))
}

// —— G-LOGOUT-RACE：poll 在飞时退出，迟到的结果不许登回来 ——
{
  net.nav = 0
  net.pollGate = null
  const { ctx, tools } = makeCtx(service)
  apply(ctx, { credentialFile: credFile })
  await tick()
  const login = tools.get('bili_login')
  await login.execute({ action: 'start' })

  // 让 poll 卡在半路
  let release
  net.pollGate = new Promise((r) => { release = r })
  const pending = login.execute({ action: 'poll' })
  await tick(10)

  // 期间退出（会写 tombstone、代次 +1）
  const out = await login.execute({ action: 'logout' })
  ok('G-LOGOUT-RACE 退出如实说清了哪层成功', /已退出/.test(out), out)

  release()
  const late = await pending
  ok('G-LOGOUT-RACE 迟到的扫码结果被丢弃', /没写回/.test(late), late)

  const st = await login.execute({ action: 'status' })
  ok('G-LOGOUT-RACE 退出后没有再变成已登录', !/已登录/.test(st), st)
  const file = JSON.parse(readFileSync(credFile, 'utf8'))
  ok('G-LOGOUT-RACE 退出标记没被登录结果覆盖', !!file.loggedOutAt, JSON.stringify(file).slice(0, 120))
}

globalThis.fetch = originalFetch
console.error = originalError
rmSync(dir, { recursive: true, force: true })
rmSync(sandbox, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
