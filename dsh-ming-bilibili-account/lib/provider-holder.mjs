// dsh-ming-bilibili-account/lib/provider-holder.mjs —— 可替换的 provider（交接书 G.5 第二轮）
//
// 问题：BilibiliOfficialProvider 构造时把 cookie 抄成自己的字段，之后改 options 它不看。
// 所以「扫码登录了但工具还是匿名」——必须重启 DSH 才生效。
//
// 做法：工具闭包里拿到的是一个**代理**，真正的 provider 放在里面。
// 登录 / 退出 / 启动恢复时只换里面那个，代理不变，工具不用重新注册。

export function createProviderHolder(make, baseOptions = {}, initialCookie = '') {
  if (typeof make !== 'function') throw new TypeError('make 必须是构造函数')
  let real = make({ ...baseOptions, ...(initialCookie ? { cookie: initialCookie } : {}) })
  const history = [initialCookie || '']

  const holder = {
    /** 换一份真身；cookie 空 = 匿名。返回新的真身（测试用）。 */
    swap(cookie = '') {
      real = make({ ...baseOptions, ...(cookie ? { cookie } : {}) })
      history.push(cookie || '')
      return real
    },
    /** 当前真身（只读用途；工具应该用 proxy）。 */
    current() {
      return real
    },
    /** 换过几次、每次用的什么 cookie（脱敏用：只看有没有，不看值）。 */
    swaps() {
      return history.map((c) => ({ hasCookie: !!c, chars: String(c || '').length }))
    },
    /** 给工具用的稳定引用：属性访问与调用都转发到当前真身。 */
    proxy: new Proxy({}, {
      get(_target, prop) {
        const value = real[prop]
        return typeof value === 'function' ? value.bind(real) : value
      },
      has(_target, prop) {
        return prop in real
      },
    }),
  }
  return holder
}
