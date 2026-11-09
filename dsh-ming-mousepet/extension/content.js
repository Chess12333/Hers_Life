// AI的网页取文 v0.2 —— 指一段就交出去，不用先选中。
//
// 判据（照 Pointy 的思路，但只留我们要的）：
//  · 只在「指一段」模式下动 DOM；平时不挂鼠标监听，只留一个消息入口。
//  · 光标下的元素先往上爬，挑「够长但不占满屏」的那一层当块；[ ] 收放。
//  · 输入框、可编辑区、密码框一律不指（指到了也不发）。
//  · 发一次就退出模式，不连发。
//  · 只读文字，不发页面别的东西。

;(() => {
  if (window.top !== window) return // 只在上层页面干活，iframe 里不重复挂

  const SEM = new Set([
    'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'CODE',
    'BLOCKQUOTE', 'TD', 'TH', 'FIGCAPTION', 'DD', 'DT', 'SUMMARY', 'ARTICLE', 'SECTION',
  ])
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'HEAD'])

  let active = false
  let level = 0
  let boxEl = null
  let tipEl = null
  let cur = null // 当前选中的块 {el, r, len}
  let lastX = 0
  let lastY = 0
  let raf = 0

  const norm = (s) => String(s || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  // 影子 DOM 里的元素也要指得到：逐层 elementFromPoint 往下钻。
  function deepElement(x, y) {
    let el = document.elementFromPoint(x, y)
    for (let i = 0; i < 8 && el; i += 1) {
      const root = el.shadowRoot
      if (!root) break
      const inner = root.elementFromPoint(x, y)
      if (!inner || inner === el) break
      el = inner
    }
    return el
  }

  function editable(node) {
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      const tag = n.tagName
      if (tag === 'TEXTAREA' || n.isContentEditable) return true
      if (tag === 'INPUT') {
        const t = String(n.getAttribute('type') || 'text').toLowerCase()
        if (t === 'password' || t === 'email' || t === 'tel') return true
      }
      if (n.getAttribute && /password/i.test(String(n.getAttribute('autocomplete') || ''))) return true
    }
    return false
  }

  // 从光标下那个元素往上爬，把候选块列出来；再按「够长、不占满屏」挑起点。
  function candidates(el) {
    const out = []
    for (let n = el; n && n !== document.body && out.length < 14; n = n.parentElement) {
      if (SKIP.has(n.tagName)) continue
      const r = n.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) continue
      const len = norm(n.innerText).length
      out.push({ el: n, r, len, sem: SEM.has(n.tagName) })
    }
    return out
  }

  function choose(el) {
    const list = candidates(el)
    if (!list.length) return null
    const fits = (c) => c.len >= 8 && c.len <= 8000 && c.r.height <= innerHeight * 0.92
    let base = list.findIndex(fits)
    if (base < 0) base = list.findIndex((c) => c.len > 0)
    if (base < 0) base = 0
    const idx = Math.min(list.length - 1, Math.max(0, base + level))
    return list[idx]
  }

  function draw() {
    if (!cur) {
      if (boxEl) boxEl.style.display = 'none'
      if (tipEl) tipEl.style.display = 'none'
      return
    }
    const r = cur.el.getBoundingClientRect()
    cur.r = r
    if (!boxEl) {
      boxEl = document.createElement('div')
      boxEl.setAttribute('data-ming-pick', 'box')
      Object.assign(boxEl.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: 2147483646,
        border: '2px solid rgba(110,196,255,.95)', borderRadius: '4px',
        background: 'rgba(110,196,255,.12)', boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
        transition: 'all .06s linear',
      })
      document.documentElement.appendChild(boxEl)
    }
    if (!tipEl) {
      tipEl = document.createElement('div')
      tipEl.setAttribute('data-ming-pick', 'tip')
      Object.assign(tipEl.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: 2147483647,
        font: '12px/1.5 "Microsoft YaHei UI",system-ui,sans-serif',
        color: '#eaf4ff', background: 'rgba(24,32,46,.92)',
        border: '1px solid rgba(110,196,255,.45)', borderRadius: '6px',
        padding: '4px 8px', whiteSpace: 'nowrap', maxWidth: '70vw',
        overflow: 'hidden', textOverflow: 'ellipsis',
      })
      document.documentElement.appendChild(tipEl)
    }
    const tag = cur.el.tagName.toLowerCase()
    const note = cur.len > 4000 ? ` · 只发前 4000 字` : ''
    tipEl.textContent = `${tag} · ${cur.len} 字${note} · 点一下交给AI · [ ] 收放 · Esc 取消`
    boxEl.style.display = 'block'
    tipEl.style.display = 'block'
    boxEl.style.left = `${Math.max(0, r.left - 2)}px`
    boxEl.style.top = `${Math.max(0, r.top - 2)}px`
    boxEl.style.width = `${Math.max(4, r.width + 2)}px`
    boxEl.style.height = `${Math.max(4, r.height + 2)}px`
    const ty = r.top > 30 ? r.top - 28 : r.top + 4
    tipEl.style.left = `${Math.max(0, Math.min(innerWidth - 240, r.left))}px`
    tipEl.style.top = `${Math.max(0, ty)}px`
  }

  function hit(x, y) {
    const el = deepElement(x, y)
    if (!el || el === document.documentElement) {
      cur = null
      draw()
      return
    }
    if (editable(el)) {
      cur = null
      draw()
      if (tipEl) {
        // 指到输入框：明确说一句，不静默。
        tipEl.textContent = '这块是输入框，不指'
        tipEl.style.display = 'block'
        tipEl.style.left = `${Math.max(0, Math.min(innerWidth - 240, x + 12))}px`
        tipEl.style.top = `${Math.max(0, y + 12)}px`
      }
      return
    }
    cur = choose(el)
    draw()
  }

  const onMove = (e) => {
    if (!active) return
    lastX = e.clientX
    lastY = e.clientY
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      hit(lastX, lastY)
    })
  }

  const onKey = (e) => {
    if (!active) return
    const k = e.key
    if (k === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      stop('cancel')
      return
    }
    if (k === '[') {
      e.preventDefault()
      e.stopPropagation()
      level = Math.max(-3, level - 1)
      hit(lastX, lastY)
      return
    }
    if (k === ']') {
      e.preventDefault()
      e.stopPropagation()
      level = Math.min(6, level + 1)
      hit(lastX, lastY)
      return
    }
  }

  const onScroll = () => {
    if (active) hit(lastX, lastY)
  }

  // 站点信息：只拿页面上本来就写着的，不猜。
  function siteInfo() {
    const pick = (sel) => {
      const n = document.querySelector(sel)
      return n ? norm(n.innerText || n.getAttribute('content') || '').slice(0, 120) : ''
    }
    const meta = (name) => {
      const n = document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)
      return n ? norm(n.getAttribute('content')).slice(0, 120) : ''
    }
    const out = {
      url: location.href,
      title: document.title,
      site: location.hostname,
      author: pick('[rel="author"]') || pick('.author') || pick('.up-name') || pick('.username') || meta('author') || '',
      published: meta('article:published_time') || meta('og:updated_time') || pick('time') || '',
      lang: document.documentElement.lang || '',
    }
    const m = String(location.href).match(/BV[0-9A-Za-z]{10}/)
    if (m) {
      out.bv = m[0]
      const up = document.querySelector('.up-name,.username,.up-info--name')
      if (up) out.author = norm(up.innerText).slice(0, 80)
      const t = document.querySelector('h1.video-title,h1[title],.video-title')
      if (t) out.title = norm(t.innerText || t.getAttribute('title')).slice(0, 120)
      const v = document.querySelector('video')
      if (v && Number.isFinite(v.currentTime)) out.mediaTime = Math.round(v.currentTime)
    }
    return out
  }

  function send() {
    if (!cur) return
    const text = norm(cur.el.innerText).slice(0, 4000)
    if (!text) {
      stop('empty')
      return
    }
    const payload = { text, tag: cur.el.tagName.toLowerCase(), ...siteInfo() }
    try {
      chrome.runtime.sendMessage({ type: 'webpick', payload })
    } catch {
      /* 扩展被卸载时忽略 */
    }
    stop('sent')
  }

  const onClick = (e) => {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    // A queued hover frame may still point at the previous block.
    hit(e.clientX, e.clientY)
    if (!cur) return
    send()
  }

  const onCtx = (e) => {
    if (!active) return
    e.preventDefault()
    e.stopPropagation()
    stop('cancel')
  }

  // 屏幕角落一行小字，告诉她现在在模式里。
  let badge = null
  function showBadge() {
    if (!badge) {
      badge = document.createElement('div')
      badge.setAttribute('data-ming-pick', 'badge')
      Object.assign(badge.style, {
        position: 'fixed', right: '14px', bottom: '14px', zIndex: 2147483647,
        pointerEvents: 'none', font: '12px/1.6 "Microsoft YaHei UI",system-ui,sans-serif',
        color: '#eaf4ff', background: 'rgba(24,32,46,.92)',
        border: '1px solid rgba(110,196,255,.45)', borderRadius: '8px',
        padding: '6px 10px',
      })
      badge.textContent = 'AI：指一段 · 点一下交出 · Esc 取消'
      document.documentElement.appendChild(badge)
    }
    badge.style.display = 'block'
  }

  function start() {
    if (active) {
      stop('cancel')
      return
    }
    active = true
    level = 0
    cur = null
    document.documentElement.style.cursor = 'crosshair'
    showBadge()
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('contextmenu', onCtx, true)
    window.addEventListener('scroll', onScroll, true)
    hit(lastX || innerWidth / 2, lastY || innerHeight / 2)
  }

  function stop(why) {
    active = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    document.documentElement.style.cursor = ''
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('contextmenu', onCtx, true)
    window.removeEventListener('scroll', onScroll, true)
    if (boxEl) boxEl.style.display = 'none'
    if (tipEl) tipEl.style.display = 'none'
    if (badge) badge.style.display = 'none'
    cur = null
    try {
      chrome.runtime.sendMessage({ type: 'webpick-state', state: 'idle', why })
    } catch {
      /* ignore */
    }
  }

  // 老的「选中 + Ctrl+Alt+S」留着当兜底：两条路都通。
  function selectedPick(e) {
    if (!e.ctrlKey || !e.altKey) return
    if (String(e.key || '').toLowerCase() !== 's') return
    const text = norm(window.getSelection ? window.getSelection().toString() : '')
    if (!text) return
    e.preventDefault()
    try {
      chrome.runtime.sendMessage({ type: 'webpick', payload: { ...siteInfo(), text: text.slice(0, 4000) } })
    } catch {
      /* ignore */
    }
  }
  document.addEventListener('keydown', selectedPick, true)

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return
    if (msg.type === 'webpick-toggle') {
      start()
      sendResponse({ ok: true, active })
      return true
    }
    if (msg.type === 'webpick-status') {
      sendResponse({ ok: true, active })
      return true
    }
  })
})()
