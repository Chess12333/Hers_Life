/**
 * star-view.js —— 星图视图（银河系 · DOM 版）
 *
 * 2026-11-07 15:00 重写。上一版是 canvas，今天在画布上耗了一小时：投影、尺寸链、RO 抖动，
 * 每一层都能让图变成空白，而且「空白」和「没加载」长得一模一样。13:50 一度退成色块网格。
 *
 * 这一版不碰 canvas：每个点就是一个 div，位置用 translate3d，大小用 scale，
 * 景深用透明度。1271 个 div 的 transform 每帧刷新，比一次 drawImage 稳得多——
 * 画不出来只可能是「没挂上」，不可能是「画错了」。
 *
 * 布局照旧（12:15 那版，她说的「银河系」）：
 *   核心   人 + 项目，亮、密、在正中
 *   旋臂   记忆按第一个 tag 分 5 条 + 杂项，沿对数螺旋铺开，越新越靠外
 *   时间环 最外圈一条淡环，按日期钉日记
 *   雾     三层极淡的径向渐变，撑体积
 * 数据只吃统一节点模型（/neurons/unified）：点开的每个点都能回它自己。
 */
;(function () {
  'use strict'

  const ARM_COLORS = ['#5b8def', '#14b8a6', '#e0803a', '#e05a8a', '#a78bfa', '#8b8f96']
  const KIND_COLOR = { memory: '#14b8a6', diary: '#c9cdd4', person: '#e05a8a', project: '#5b8def' }
  const ARM_COUNT = 8          // 主题臂数量，剩下的进「杂项」
  const CORE_SHARE = 0.12      // 核球占半径的比例
  const DOT = 10               // 每个点的基准边长(px)，真大小靠 scale

  const CSS = `
.svx-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}
.svx-head{display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-separator-secondary)}
.svx-head .sp{flex:1}
.svx-legend{display:flex;gap:10px;align-items:center;font-size:11.5px;opacity:.85}
.svx-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.svx-body{flex:1;min-height:0;display:flex}
.svx-stage{flex:1;min-width:0;position:relative;overflow:hidden;cursor:grab;user-select:none;-webkit-user-select:none}
.svx-stage.drag{cursor:grabbing}
.svx-fog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none}
.svx-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.svx-dot{position:absolute;left:0;top:0;width:${DOT}px;height:${DOT}px;border-radius:50%;pointer-events:none;will-change:transform,opacity}
.svx-dot.sel{outline:1px solid var(--dsw-alias-label-primary);outline-offset:2px}
.svx-arm-label{position:absolute;user-select:none;font-size:11px;transform:translate(-50%,0);pointer-events:none;white-space:nowrap;opacity:.85}
.svx-core-label{position:absolute;font-size:11px;color:var(--dsw-alias-label-tertiary);transform:translate(-50%,0);pointer-events:none;white-space:nowrap;opacity:.8}
.svx-side{width:280px;flex:0 0 280px;border-left:1px solid var(--dsw-alias-separator-secondary);overflow:auto;padding:10px 12px;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.svx-side h4{margin:0 0 6px;font-size:13px;color:var(--dsw-alias-label-primary);font-weight:600}
.svx-side .d{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-bottom:8px}
.svx-side .b{white-space:pre-wrap;word-break:break-word}
.svx-side .empty{color:var(--dsw-alias-label-tertiary);font-size:12px}
.svx-side .arm{margin-top:10px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.svx-side .arm i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
`

  // 稳定哈希：同一个 id 每次都落同一条臂、同一个亮度
  function hash(s) {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0)
  }

  function mount(host, data, opts) {
    opts = opts || {}
    if (!host) return { destroy() {} }
    host.innerHTML = ''
    const root = document.createElement('div'); root.className = 'svx-root'
    const style = document.createElement('style'); style.textContent = CSS
    root.appendChild(style)

    const nodes = (data && data.nodes) || []
    const stat = (data && data.stats) || {}

    // ---------- 头 ----------
    const head = document.createElement('div'); head.className = 'svx-head'
    const title = document.createElement('span')
    const chN = stat.chapters || nodes.filter((n) => n.chapter).length || 0
    const diaryN = stat.diaries || nodes.filter((n) => n.kind === 'diary').length
    title.textContent = `星图 · ${stat.unified || nodes.length} 个节点 · ${chN} 章 · ${diaryN} 篇日记`
    const sp = document.createElement('span'); sp.className = 'sp'
    const hint = document.createElement('span'); hint.textContent = '拖动转 · 滚轮缩放 · 点一颗看原话'; hint.style.opacity = '0.7'
    const lg = document.createElement('span'); lg.className = 'svx-legend'
    lg.innerHTML = '<span><i style="background:#14b8a6"></i>记忆</span><span><i style="background:#e05a8a"></i>人</span><span><i style="background:#5b8def"></i>项目</span><span><i style="background:#c9cdd4"></i>日记</span>'
    head.appendChild(title); head.appendChild(sp); head.appendChild(hint); head.appendChild(lg)

    // ---------- 体 ----------
    const body = document.createElement('div'); body.className = 'svx-body'
    const stage = document.createElement('div'); stage.className = 'svx-stage'
    const side = document.createElement('aside'); side.className = 'svx-side'
    side.innerHTML = '<div class="empty">点一颗星看原话。</div>'
    body.appendChild(stage); body.appendChild(side)
    root.appendChild(head); root.appendChild(body)
    host.appendChild(root)

    // 雾（静态，三层）：撑出「有东西在那里」的体积
    for (const k of [0.95, 0.62, 0.34]) {
      const f = document.createElement('div'); f.className = 'svx-fog'
      const d = Math.round(k * 100)
      f.style.width = d + '%'; f.style.height = d + '%'
      f.style.background = 'radial-gradient(closest-side, rgba(160,160,180,.055), rgba(160,160,180,0))'
      stage.appendChild(f)
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'svx-svg')
    stage.appendChild(svg)
    const armPaths = []
    const ringEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
    ringEl.setAttribute('fill', 'none')
    ringEl.setAttribute('stroke', 'rgba(150,150,170,.13)')
    ringEl.setAttribute('stroke-width', '1')
    ringEl.style.display = 'none'
    svg.appendChild(ringEl)

    // ---------- 分臂 ----------
    const memories = nodes.filter((n) => n.kind === 'memory')
    const cores = nodes.filter((n) => n.kind === 'person' || n.kind === 'project')
    const diaries = nodes.filter((n) => n.kind === 'diary')

    // 2026-11-07 18:2x：分臂只用章。上一版[有章用章、没章用来源]，结果一条臂叫[第4章 机器]、
    // 旁边一条叫[深水区]，同一张图上两套尺子。没章的进[未分章]，跟记忆卡那边一样不硬塞。
    const keyOf = (n) => (n.chapter ? ('第' + n.chapter + '章 ' + (n.chapterName || '')) : '未分章')
    const tagCount = new Map()
    for (const n of memories) {
      const t = keyOf(n)
      tagCount.set(t, (tagCount.get(t) || 0) + 1)
    }
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, ARM_COUNT).map(([t]) => t)
    const armOf = new Map()
    for (const n of memories) {
      const t = keyOf(n)
      armOf.set(n.id, topTags.indexOf(t) >= 0 ? t : '杂项')
    }
    const armNames = topTags.concat(memories.some((n) => armOf.get(n.id) === '杂项') ? ['杂项'] : [])
    const armIndex = new Map(armNames.map((t, i) => [t, i]))
    const armColor = (name) => ARM_COLORS[(armIndex.get(name) || 0) % ARM_COLORS.length]

    const buckets = new Map(armNames.map((r) => [r, []]))
    for (const n of memories) {
      const k = armOf.get(n.id)
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(n)
    }
    for (const [, list] of buckets) list.sort((a, b) => ((a.at || 0) - (b.at || 0)))

    let W = 0, H = 0, cx = 0, cy = 0, R = 0
    let yaw = 0.4
    let pitch = 0.16          // 上下点头：往上拖 = 从上往下看
    let zoom = 1
    let hover = null
    let selected = null
    const pos = new Map()
    const dotEl = new Map()

    // 先建点：1271 个 div 一次性 append，之后只改 style，不再增删
    const frag = document.createDocumentFragment()
    for (const n of nodes) {
      const el = document.createElement('i')
      el.className = 'svx-dot'
      el.setAttribute('data-id', n.id)
      el.style.opacity = '0.5'
      dotEl.set(n.id, el)
      frag.appendChild(el)
    }
    stage.appendChild(frag)

    const armLabels = new Map()
    function armLabel(name) {
      let el = armLabels.get(name)
      if (!el) {
        el = document.createElement('div')
        el.className = 'svx-arm-label'
        el.textContent = String(name).replace(/^群 · /, '').slice(0, 12)
        stage.appendChild(el)
        armLabels.set(name, el)
      }
      return el
    }

    const coreLabel = document.createElement('div')
    coreLabel.className = 'svx-core-label'
    stage.appendChild(coreLabel)

    function measure() {
      const r = stage.getBoundingClientRect()
      let w = Math.floor(r.width), h = Math.floor(r.height)
      // 零尺寸保护：刚挂上、或父级还在 display:none 时量到 0。
      // 不在这里报错，退回一个能看的默认尺寸，RO 下一帧会修正。
      if (w < 40) w = Math.max(320, host.clientWidth || 0) || 720
      if (h < 40) h = Math.max(240, host.clientHeight || 0) || 520
      W = w; H = h
      cx = W / 2; cy = H / 2
      R = Math.min(W, H) * 0.46
    }

    function layout() {
      pos.clear()
      const coreR = R * CORE_SHARE
      cores.forEach((n, i) => {
        const a = i * 2.39996
        const rr = coreR * Math.sqrt((i + 0.5) / Math.max(1, cores.length))
        pos.set(n.id, { x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.55, z: 0, r: 2.6, node: n, arm: -1 })
      })

      const inner = R * CORE_SHARE * 1.25
      const outer = R * 0.95
      armNames.forEach((name, ai) => {
        const list = buckets.get(name) || []
        const start = (ai / Math.max(1, armNames.length)) * Math.PI * 2
        const span = Math.PI * 1.45
        const n = list.length || 1
        list.forEach((node, i) => {
          const t = n <= 1 ? 0.5 : (i + 0.5) / n
          const theta = start + t * span
          const jitter = (hash(node.id) % 1000) / 1000 - 0.5
          const rr = inner + (outer - inner) * Math.pow(t, 0.85) + jitter * R * 0.05
          const x = Math.cos(theta) * rr
          const y = Math.sin(theta) * rr * 0.55 + jitter * R * 0.02
          const z = ((hash(node.id + 'z') % 1000) / 1000 - 0.5) * 0.55
          pos.set(node.id, { x, y, z, r: 1.7, node, arm: ai, t })
        })
      })

      const sorted = diaries.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1))
      const ringR = outer * 1.06
      sorted.forEach((d, i) => {
        const a = (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2
        pos.set(d.id, { x: Math.cos(a) * ringR, y: Math.sin(a) * ringR * 0.55, z: 0.6, r: 2.2, node: d, arm: -2 })
      })
    }

    function project(p) {
      const cy1 = Math.cos(yaw), sy1 = Math.sin(yaw)
      const cp = Math.cos(pitch), sp = Math.sin(pitch)
      // 先绕竖轴转（左右拖）
      const x1 = p.x * cy1 - p.z * R * 0.35 * sy1
      const z1 = p.x * sy1 + p.z * R * 0.35 * cy1
      // 再绕横轴点头（上下拖）：2026-11-07 18:2x 加，她说不能上下转
      const y2 = p.y * cp - z1 * sp
      const z2 = p.y * sp + z1 * cp
      const s = 1 + z2 / (R * 4)
      return { x: cx + x1 * zoom, y: cy + (y2 + z2 * 0.12) * zoom, s, z: z2 }
    }

    let raf = 0
    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(false) }) }

    // full=false：只挪位置（拖动中用）；full=true：连透明度/大小/颜色一起刷
    function paint(full) {
      if (!W) measure()
      for (const [id, p] of pos) {
        const el = dotEl.get(id)
        if (!el) continue
        const q = project(p)
        const depth = Math.max(0, Math.min(1, 0.45 + (q.z / (R * 0.9)) * 0.9 + 0.45))
        const isSel = selected && selected.id === id
        const isHov = hover && hover.id === id
        const rad = (p.r + (isSel || isHov ? 2.4 : 0)) * (0.75 + depth * 0.5) * zoom
        const k = Math.max(0.35, rad / (DOT / 2))
        el.style.transform = 'translate3d(' + (q.x - DOT / 2).toFixed(1) + 'px,' + (q.y - DOT / 2).toFixed(1) + 'px,0) scale(' + k.toFixed(2) + ')'
        if (full) {
          el.style.opacity = (0.35 + depth * 0.6).toFixed(2)
          const tag = p.arm + '|' + (isSel ? 1 : 0) + '|' + (isHov ? 1 : 0)
          if (el.__painted !== tag) {
            el.__painted = tag
            el.style.background = p.node.kind === 'memory' && p.arm >= 0
              ? armColor(armOf.get(id))
              : (KIND_COLOR[p.node.kind] || '#888')
            el.className = 'svx-dot' + (isSel ? ' sel' : '')
          }
        }
      }

      // 2026-11-07 19:4x：这一段原来是 if(full)，于是拖动时标签和旋臂线留在原地不动。
      // 位置类的更新每帧都要跑；只有颜色/透明度那类才需要 full。
      {
        // 旋臂描边
        armNames.forEach((name, ai) => {
          const pts = (buckets.get(name) || []).map((n) => pos.get(n.id)).filter(Boolean).map(project)
          let d = ''
          pts.forEach((q, i) => { d += (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1) })
          let path = armPaths[ai]
          if (!path) {
            path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('fill', 'none')
            path.setAttribute('stroke-width', '1')
            path.setAttribute('stroke', armColor(name))
            path.setAttribute('opacity', '0.12')
            svg.insertBefore(path, ringEl)
            armPaths[ai] = path
          }
          path.setAttribute('d', d)
        })
        // 时间环
        if (diaries.length) {
          ringEl.style.display = ''
          ringEl.setAttribute('cx', String(cx)); ringEl.setAttribute('cy', String(cy))
          ringEl.setAttribute('rx', String(R * 0.95 * 1.06 * zoom))
          ringEl.setAttribute('ry', String(R * 0.95 * 1.06 * 0.55 * zoom))
        }
        armNames.forEach((name) => {
          const list = buckets.get(name) || []
          const el = armLabel(name)
          const last = list[list.length - 1]
          if (!last || !pos.get(last.id)) { el.style.display = 'none'; return }
          const q = project(pos.get(last.id))
          el.style.display = ''
          el.style.left = q.x.toFixed(0) + 'px'
          el.style.top = (q.y - 14).toFixed(0) + 'px'
          el.style.color = armColor(name)
        })
        coreLabel.textContent = '核心 · 人与项目 ' + cores.length
        coreLabel.style.left = cx + 'px'
        coreLabel.style.top = (cy + R * CORE_SHARE * 0.75 + 14) + 'px'
        stage.setAttribute('data-dots', String(pos.size))
      }
    }

    function relayout() {
      measure()
      layout()
      paint(true)
    }

    function pick(mx, my) {
      let best = null, bd = 26 * 26
      for (const [, p] of pos) {
        const q = project(p)
        const dx = q.x - mx, dy = q.y - my
        const d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = p }
      }
      return best
    }

    function renderSide() {
      if (!selected) { side.innerHTML = '<div class="empty">点一颗星看原话。</div>'; return }
      // 2026-11-07 18:2x：selected 存的是节点本身，不是 pos 项。上一版这里取 selected.node，
      // 结果是 undefined，侧栏一选中就抛错、什么都没显示——她说的[没有对应的话]就是这个。
      const n = (selected && selected.node) ? selected.node : selected
      const ch = n.chapterName ? `第${n.chapter}章 · ${n.chapterName}` : '未分章'
      const armName = n.kind === 'memory' ? (armOf.get(n.id) || '') : (n.kind === 'diary' ? '时间环' : '核心')
      side.innerHTML = ''
      const h4 = document.createElement('h4'); h4.textContent = n.title || '(无标题)'
      const d = document.createElement('div'); d.className = 'd'
      d.textContent = [n.date || '', ch, n.source].filter(Boolean).join(' · ')
      const b = document.createElement('div'); b.className = 'b'
      b.textContent = String(n.body || n.excerpt || '').slice(0, 1600)
      side.appendChild(h4); side.appendChild(d); side.appendChild(b)
      if (armName) {
        const a = document.createElement('div'); a.className = 'arm'
        a.innerHTML = '<i style="background:' + (n.kind === 'memory' ? armColor(armName) : (KIND_COLOR[n.kind] || '#888')) + '"></i>' + armName
        side.appendChild(a)
      }
    }

    // ---------- 交互 ----------
    let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, movedPx = 0
    stage.addEventListener('pointerdown', (ev) => {
      ev.preventDefault()
      dragging = true; lastX = ev.clientX; lastY = ev.clientY
      downX = ev.clientX; downY = ev.clientY; movedPx = 0
      stage.classList.add('drag')
      try { stage.setPointerCapture(ev.pointerId) } catch (e) {}
    })
    stage.addEventListener('pointermove', (ev) => {
      const r = stage.getBoundingClientRect()
      if (dragging) {
        yaw += (ev.clientX - lastX) * 0.006
        pitch = Math.max(-1.15, Math.min(1.15, pitch + (ev.clientY - lastY) * 0.005))
        movedPx += Math.abs(ev.clientX - lastX) + Math.abs(ev.clientY - lastY)
        lastX = ev.clientX; lastY = ev.clientY
        schedule()
        return
      }
      const p = pick(ev.clientX - r.left, ev.clientY - r.top)
      const id = p ? p.node.id : null
      const cur = hover ? hover.id : null
      if (id !== cur) { hover = p ? p.node : null; paint(true) }
      stage.style.cursor = p ? 'pointer' : 'grab'
    })
    function endDrag(ev) {
      if (!dragging) return
      dragging = false; stage.classList.remove('drag')
      // 没怎么动 = 点击：选最近的一颗星（原来靠 click 事件，拖动时会被一起触发，改在这里判）
      if (movedPx < 6 && ev) {
        const r = stage.getBoundingClientRect()
        const p = pick(ev.clientX - r.left, ev.clientY - r.top)
        if (p) { selected = p.node; renderSide() }
      }
      paint(true)
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)
    stage.addEventListener('pointerleave', endDrag)

    stage.addEventListener('click', (ev) => {
      const r = stage.getBoundingClientRect()
      const p = pick(ev.clientX - r.left, ev.clientY - r.top)
      if (!p) return
      selected = p.node
      renderSide()
      paint(true)
      // 2026-11-07 21:4x：把「我正在看哪一条」报给面板。
      // 之前星图点一颗星，只有星图自己知道；切到记忆 tab 列表还在原地，两边对不上同一条。
      if (opts.onSelect) { try { opts.onSelect(p.node.id) } catch (e) {} }
    })

    stage.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      zoom = Math.max(0.45, Math.min(2.8, zoom * (ev.deltaY > 0 ? 0.92 : 1.08)))
      paint(true)
    }, { passive: false })

    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => relayout())
      ro.observe(stage)
    }
    relayout()
    // 再补一次：从 display:none 切过来时第一次量到的可能是 0
    setTimeout(() => { try { relayout() } catch (e) {} }, 60)

    // 切回星图时对齐到面板记着的那一条（opts.initialId 由 panel 传进来）
    if (opts.initialId) {
      const p0 = pos.get(opts.initialId)
      if (p0) { selected = p0.node; renderSide(); paint(true) }
    }

    return {
      destroy() { try { if (ro) ro.disconnect() } catch (e) {} host.innerHTML = '' },
      stats() {
        return {
          nodes: pos.size, arms: armNames.length, arms_detail: armNames,
          cores: cores.length, diaries: diaries.length, zoom,
          size: [W, H], dots: stage.querySelectorAll('.svx-dot').length,
        }
      },
      focus(id) { const p = pos.get(id); if (p) { selected = p.node; renderSide(); paint(true) } },
      // 给顶部搜索用：命中第一条就选中它
      find(text) {
        const t = String(text || '').trim().toLowerCase()
        if (!t) return null
        for (const [, p] of pos) {
          const n = p.node
          if (String(n.title || '').toLowerCase().indexOf(t) >= 0 ||
              String(n.body || n.excerpt || '').toLowerCase().indexOf(t) >= 0) {
            selected = n; renderSide(); paint(true)
            return n
          }
        }
        return null
      },
    }
  }

  const api = { mount }
  if (typeof window !== 'undefined') window.__MingStarView = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
