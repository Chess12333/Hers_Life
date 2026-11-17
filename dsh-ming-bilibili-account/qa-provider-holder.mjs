// dsh-ming-bilibili-account/qa-provider-holder.mjs —— G.5 第二轮：登录后不用重启就能用新 cookie
//
// 用假 provider 类验通用的 holder 行为：
//   · proxy 的属性访问与方法调用都转发到「当前真身」
//   · swap 之后同一个 proxy 看到的是新实例
//   · 不传 cookie = 匿名；历史里能看出换过几次、每次有没有 cookie（不记值）
import { createProviderHolder } from './lib/provider-holder.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

class FakeProvider {
  constructor(opts = {}) {
    this.cookie = opts.cookie || ''
    this.calls = 0
    this.baseUrl = opts.baseUrl || ''
  }
  search(q) { this.calls++; return 'search:' + q + ':cookie=' + (this.cookie ? 'yes' : 'no') }
  get profile() { return { cookie: this.cookie } }
}

// 1) 初始带 cookie
{
  const h = createProviderHolder((o) => new FakeProvider(o), { baseUrl: 'b' }, 'SESSDATA=old')
  ok('初始真身拿到 cookie', h.current().cookie === 'SESSDATA=old')
  ok('proxy 调方法转发到真身', h.proxy.search('x').endsWith('cookie=yes'))
  ok('proxy 读属性转发', h.proxy.profile.cookie === 'SESSDATA=old')
  ok('baseOptions 传进去了', h.current().baseUrl === 'b')
}

// 2) 登录后 swap：同一个 proxy 看到新实例
{
  const h = createProviderHolder((o) => new FakeProvider(o), {}, '')
  const proxy = h.proxy
  ok('初始匿名', proxy.search('q').endsWith('cookie=no'))
  const before = h.current()
  h.swap('SESSDATA=new')
  ok('swap 换了一个新实例', h.current() !== before)
  ok('同一个 proxy 现在带 cookie 了', proxy.search('q').endsWith('cookie=yes'))
  ok('新实例真的带新 cookie', h.current().cookie === 'SESSDATA=new')
}

// 3) 退出后 swap 回匿名
{
  const h = createProviderHolder((o) => new FakeProvider(o), {}, 'SESSDATA=old')
  ok('一开始带 cookie', h.proxy.search('q').endsWith('cookie=yes'))
  h.swap('')
  ok('退出后匿名', h.proxy.search('q').endsWith('cookie=no'))
  ok('真身 cookie 清空', h.current().cookie === '')
}

// 4) 每次 swap 都记历史，但不记 cookie 值
{
  const h = createProviderHolder((o) => new FakeProvider(o), {}, '')
  h.swap('SESSDATA=aaa')
  h.swap('')
  h.swap('SESSDATA=bbb')
  const hist = h.swaps()
  ok('历史条数对', hist.length === 4, JSON.stringify(hist))
  ok('历史记有没有 cookie', hist.map((x) => x.hasCookie).join(',') === 'false,true,false,true')
  ok('历史不记 cookie 值', !JSON.stringify(hist).includes('SESSDATA'))
}

// 5) 方法绑定正确（不丢 this）
{
  const h = createProviderHolder((o) => new FakeProvider(o), {}, '')
  h.proxy.search('a')
  h.proxy.search('b')
  ok('方法调用累加在真身上', h.current().calls === 2, String(h.current().calls))
}

// 6) 参数校验
{
  let threw = false
  try { createProviderHolder(null) } catch { threw = true }
  ok('make 不是函数时抛错', threw)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
