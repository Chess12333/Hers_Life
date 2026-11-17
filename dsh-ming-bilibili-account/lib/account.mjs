// dsh-ming-bilibili-account/lib/account.mjs —— 一个账号，一个权威（交接书 G.4）
//
// 要解决的三件事，都是「同一个登录态被两套地方各写一半」造成的：
//   1. 文件（credentialFile）和 DSH 凭证服务（credentials.set/get）是两份权威；
//      logout 只清了服务，文件还在 → 下次启动又从文件「复活」。
//   2. 启动时异步恢复，恢复回来时 provider 已经拿着空 cookie 构造好了 → 字幕永远未登录。
//   3. 迟到的恢复响应会把刚登录/刚退出的状态盖回去。
//
// 这里的口径：
//   · **写和清都两边一起做**：服务 + 文件。任何一边失败都记下来，但不假装成功。
//   · **每次改状态 generation +1**；异步回来的结果带 gen，gen 不对就丢掉。
//   · 退出写一个 tombstone（`{loggedOutAt}`），文件不删成空白——下次读到 tombstone 就是没登录，
//     不会把「文件不存在」误判成「第一次装」。
//   · 这个模块不碰网络、不读 .env、不打印 cookie。

const COOKIE_KEYS = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']

/** 'a=1; b=2' → { a: '1', b: '2' } */
export function parseCookieString(s) {
  const out = {}
  for (const part of String(s || '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

/** 只留 B 站认的几个字段，顺序固定（便于比对和日志脱敏）。 */
export function cookieHeader(obj) {
  return COOKIE_KEYS.filter((k) => obj && obj[k]).map((k) => k + '=' + obj[k]).join('; ')
}

/** 从 set-cookie 列表抽登录态；抽不到返回 null。 */
export function fromSetCookies(list) {
  const jar = {}
  for (const line of Array.isArray(list) ? list : []) {
    const first = String(line).split(';')[0]
    const i = first.indexOf('=')
    if (i <= 0) continue
    const k = first.slice(0, i).trim()
    if (COOKIE_KEYS.includes(k)) jar[k] = first.slice(i + 1).trim()
  }
  return cookieHeader(jar) || null
}

/** cookie 字符串 → { cookie, csrf, uid }（csrf 就是 bili_jct）。 */
export function sessionFromCookie(cookieStr) {
  const jar = parseCookieString(cookieStr)
  if (!jar.SESSDATA) return null
  return { cookie: cookieHeader(jar), csrf: jar.bili_jct || '', uid: jar.DedeUserID || '', uname: '' }
}

export function emptyTombstone() {
  return { loggedOutAt: '' }
}

/**
 * @param {object} io
 * @param {string} io.file                凭证文件路径
 * @param {(s:string)=>Promise<string>} io.readText
 * @param {(s:string,p:string)=>Promise<void>} io.writeText
 * @param {(p:string)=>Promise<void>} io.removeFile
 * @param {{get:Function,set:Function,unset:Function}|null} io.service  DSH 凭证服务
 * @param {string} io.serviceKey
 */
export function createAccount(io) {
  const state = { cookie: '', gen: 0, source: 'none', lastError: '' }

  const readFileState = async () => {
    try {
      const text = await io.readText(io.file)
      if (!text || !text.trim()) return { kind: 'empty' }
      const obj = JSON.parse(text)
      if (obj && obj.loggedOutAt) return { kind: 'tombstone', at: obj.loggedOutAt }
      const cookie = cookieHeader(obj)
      return cookie ? { kind: 'cookie', cookie } : { kind: 'empty' }
    } catch (e) {
      if (e && e.code === 'ENOENT') return { kind: 'missing' }
      return { kind: 'broken', error: String(e && e.message || e) }
    }
  }

  return {
    /** 当前内存态；proc 给的是这一轮调用该用的 cookie。 */
    current() {
      return { cookie: state.cookie, gen: state.gen, source: state.source, loggedIn: !!state.cookie }
    },

    /** 异步结果回来时用：gen 对不上说明期间登录/退出过，丢弃。 */
    isStale(gen) {
      return Number(gen) !== state.gen
    },

    /**
     * 启动恢复。服务优先、文件兜底；tombstone 优先于任何 cookie——
     * 用户明确退出过，就不许另一个副本把它复活。
     */
    async restore() {
      const gen = state.gen
      const fileState = await readFileState()

      let fromService = ''
      if (io.service && typeof io.service.get === 'function') {
        try {
          const v = await io.service.get(io.serviceKey)
          if (v && typeof v === 'string') fromService = v
        } catch { /* 服务不可用就当没有 */ }
      }
      if (this.isStale(gen)) return { applied: false, reason: 'stale' }

      if (fileState.kind === 'tombstone') {
        // 用户明确退出过：以 tombstone 为准，顺手把服务里可能残留的那份也清掉。
        state.cookie = ''
        state.source = 'tombstone'
        let cleaned = false
        if (fromService && io.service && typeof io.service.unset === 'function') {
          try { await io.service.unset(io.serviceKey); cleaned = true } catch { /* 记不到就算了，下次还会试 */ }
        }
        return { applied: false, reason: 'logged-out-before', cleanedService: cleaned }
      }
      const cookie = fromService || (fileState.kind === 'cookie' ? fileState.cookie : '')
      if (!cookie) {
        state.cookie = ''
        state.source = fileState.kind
        return { applied: false, reason: fileState.kind }
      }
      state.cookie = cookie
      state.source = fromService ? 'service' : 'file'
      state.gen += 1
      return { applied: true, source: state.source, gen: state.gen }
    },

    /** 登录成功：两边都写，gen +1。返回哪些层写成功了，失败不掩盖。 */
    async save(cookie) {
      const result = { service: false, file: false, gen: 0 }
      const jar = parseCookieString(cookie)
      if (!jar.SESSDATA) throw new Error('cookie 里没有 SESSDATA，不保存')
      state.cookie = cookieHeader(jar)
      state.source = 'login'
      state.gen += 1
      result.gen = state.gen
      if (io.service && typeof io.service.set === 'function') {
        try { await io.service.set(io.serviceKey, state.cookie); result.service = true } catch (e) { state.lastError = 'service: ' + (e && e.message || e) }
      }
      try {
        await io.writeText(io.file, JSON.stringify(jar, null, 2))
        result.file = true
      } catch (e) { state.lastError = 'file: ' + (e && e.message || e) }
      return result
    },

    /**
     * 退出：三层一起清（内存 / 服务 / 文件），写 tombstone 防止从文件复活。
     * 任何一层失败都记在返回里——「退出都退出」这句承诺，得能指着证据说。
     */
    async clear() {
      const result = { service: false, file: false, tombstone: false, gen: 0 }
      state.cookie = ''
      state.source = 'logout'
      state.gen += 1
      result.gen = state.gen
      if (io.service && typeof io.service.unset === 'function') {
        try { await io.service.unset(io.serviceKey); result.service = true } catch (e) { state.lastError = 'service: ' + (e && e.message || e) }
      }
      try {
        await io.writeText(io.file, JSON.stringify({ ...emptyTombstone(), loggedOutAt: new Date().toISOString() }, null, 2))
        result.tombstone = true
        result.file = true
      } catch (e) { state.lastError = 'file: ' + (e && e.message || e) }
      return result
    },
  }
}
