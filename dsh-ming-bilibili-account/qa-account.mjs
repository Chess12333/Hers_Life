// dsh-ming-bilibili-account/qa-account.mjs —— G 离线验收：一个账号，一个权威
//
// 对应交接书 G.4/G.5 的四条硬要求：
//   ① 写和清都两边一起（凭证服务 + 文件）；
//   ② 退出以后不许从文件「复活」；
//   ③ 迟到的恢复响应不能盖掉新状态；
//   ④ 坏了要如实说，不装作已登录。
//
// 全部用假文件 / 假服务，不登录、不碰真实凭证。
import { createAccount, parseCookieString, cookieHeader, fromSetCookies, sessionFromCookie } from './lib/account.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const COOKIE = 'SESSDATA=abc%2C123; bili_jct=csrf1; DedeUserID=42; DedeUserID__ckMd5=m5; sid=xyz'

function makeIo(initial = {}) {
  const files = { ...initial }
  const svc = { value: null, sets: 0, unsets: 0 }
  const io = {
    file: 'cred.json',
    readText: async (p) => {
      if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
      return files[p]
    },
    writeText: async (p, t) => { files[p] = t },
    removeFile: async (p) => { delete files[p] },
    service: {
      get: async () => svc.value,
      set: async (_k, v) => { svc.value = v; svc.sets++ },
      unset: async () => { svc.value = null; svc.unsets++ },
    },
    serviceKey: 'bili',
  }
  return { io, files, svc }
}

// --- 纯函数 ---
ok('parseCookieString 认得分号片段', parseCookieString(COOKIE).DedeUserID === '42')
ok('cookieHeader 只留 B 站认的字段', cookieHeader({ SESSDATA: 'x', foo: 'bar' }) === 'SESSDATA=x')
ok('fromSetCookies 抽登录态', (fromSetCookies([
  'SESSDATA=abc%2C123; Path=/; HttpOnly',
  'bili_jct=csrf1; Path=/',
  'other=zzz; Path=/',
]) || '').includes('SESSDATA=abc%2C123'))
ok('fromSetCookies 没有关键字段返回 null', fromSetCookies(['other=1']) === null)
ok('sessionFromCookie 没 SESSDATA 就是未登录', sessionFromCookie('bili_jct=1') === null)
ok('sessionFromCookie 带出 csrf/uid', (() => { const s = sessionFromCookie(COOKIE); return s.csrf === 'csrf1' && s.uid === '42' })())

// --- 登录：两边都写 ---
{
  const { io, files, svc } = makeIo()
  const acc = createAccount(io)
  const r = await acc.save(COOKIE)
  ok('登录写进凭证服务', r.service === true && !!svc.value)
  ok('登录也写进文件', r.file === true && !!files['cred.json'])
  ok('文件里是 cookie 字段而不是整串', JSON.parse(files['cred.json']).SESSDATA === 'abc%2C123')
  ok('gen 递增', r.gen === 1)
}

// --- 退出：三层一起清 + tombstone，且不会复活 ---
{
  const { io, files, svc } = makeIo()
  const acc = createAccount(io)
  await acc.save(COOKIE)
  const out = await acc.clear()
  ok('退出清掉了凭证服务', out.service === true && svc.value === null)
  ok('退出把文件换成 tombstone', out.tombstone === true && !!JSON.parse(files['cred.json']).loggedOutAt)
  ok('退出后内存里没有 cookie', acc.current().cookie === '')

  // 重启：文件是 tombstone、服务是空的 → 不许复活
  const acc2 = createAccount(io)
  const rr = await acc2.restore()
  ok('重启后不会拿文件复活', rr.applied === false && rr.reason === 'logged-out-before')
  ok('重启后 current 是未登录', acc2.current().loggedIn === false)
}

// --- 退出时服务没清干净：tombstone 仍然赢，并且顺手把服务清掉 ---
{
  const { io, files, svc } = makeIo()
  const acc = createAccount(io)
  await acc.save(COOKIE)
  // 模拟「退出时服务没清成功」
  await acc.clear()
  svc.value = COOKIE
  const acc2 = createAccount(io)
  const rr = await acc2.restore()
  ok('tombstone 优先于服务里的残留', rr.applied === false && rr.reason === 'logged-out-before')
  ok('顺手把服务里那份也清了', rr.cleanedService === true && svc.value === null)
}

// --- 恢复：服务优先，文件兜底 ---
{
  const { io, files, svc } = makeIo()
  svc.value = 'SESSDATA=from-service; bili_jct=c2'
  files['cred.json'] = JSON.stringify({ SESSDATA: 'from-file', bili_jct: 'c1' })
  const acc = createAccount(io)
  const rr = await acc.restore()
  ok('恢复优先用服务', rr.applied === true && rr.source === 'service' && acc.current().cookie.includes('from-service'))
}
{
  const { io, files } = makeIo()
  files['cred.json'] = JSON.stringify({ SESSDATA: 'only-file', bili_jct: 'c1' })
  const acc = createAccount(io)
  const rr = await acc.restore()
  ok('服务空时用文件兜底', rr.applied === true && rr.source === 'file')
}

// --- 迟到响应：gen 变了就丢 ---
{
  const { io } = makeIo()
  const acc = createAccount(io)
  const gen = acc.current().gen
  await acc.save(COOKIE)          // 期间用户登录了，gen+1
  ok('迟到响应能识别为 stale', acc.isStale(gen) === true)
  ok('当前 gen 不是 stale', acc.isStale(acc.current().gen) === false)
}

// --- 坏文件：如实报，不崩、不假装已登录 ---
{
  const { io, files } = makeIo({ 'cred.json': '{not json' })
  const acc = createAccount(io)
  const rr = await acc.restore()
  ok('坏文件不崩', rr.applied === false)
  ok('坏文件标 broken', rr.reason === 'broken')
  ok('坏文件时未登录', acc.current().loggedIn === false)
}

// --- 没有 SESSDATA 的 cookie 不许保存 ---
{
  const { io } = makeIo()
  const acc = createAccount(io)
  let threw = false
  try { await acc.save('bili_jct=only') } catch { threw = true }
  ok('缺 SESSDATA 拒绝保存', threw === true)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
