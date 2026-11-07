/**
 * dsh-ming-graph —— 记忆关系图（Client 半端）
 *
 * 左侧图标栏一个图标（sidebar.panellist），点开占满主区域（main 面板 key = ming-graph）。
 * 数据来自 Host 半端的 /_dsh/dsh-ming-graph/snapshot，自己拉、自己画，不经过模型。
 *
 * 三个视图：
 *   人 —— 星图，中心是溟，外圈是记忆里出现过的人，边宽 = 关于他的记忆条数
 *   主题 —— 记忆里的词，边 = 同一条记忆里一起出现（只算 ≥2 次的，少而真）
 *   时间线 —— 按天，两侧分开计数
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-graph',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/_dsh/dsh-ming-graph'
    const COLOR = {
      ming: '#4f6ef7',
      dsh: '#14b8a6',
      qq: '#e0803a',
      owner: '#d946a6',
      ring: ['#5b8def', '#14b8a6', '#e0803a', '#a855f7', '#ef6b6b', '#0ea5e9', '#84cc16', '#f59e0b'],
    }

    const CSS = `
.mg-root{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;padding:16px 22px 18px;gap:0;color:var(--dsw-alias-label-primary);font-size:13px}
.mg-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:4px 2px 12px}
.mg-title{font-size:15px;font-weight:600;margin:0}
.mg-meta{color:var(--dsw-alias-label-tertiary);font-size:12px}
.mg-spacer{flex:1}
.mg-seg{display:inline-flex;background:var(--dsw-alias-bg-layer-2);border-radius:9px;padding:3px;gap:2px}
.mg-seg button{font:inherit;font-size:12px;line-height:20px;height:26px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mg-seg button[data-on="1"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 0 0 .5px var(--dsw-alias-border-l3)}
.mg-btn{font:inherit;font-size:12px;height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.mg-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.mg-body{flex:1;display:flex;gap:14px;min-height:0}
.mg-canvas{flex:1;min-width:0;min-height:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);position:relative;overflow:hidden}
.mg-canvas svg{display:block;width:100%;height:100%}
.mg-side{width:290px;flex:none;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);padding:12px 14px;overflow:auto;min-height:0}
.mg-side h4{margin:0 0 8px;font-size:13px;font-weight:600}
.mg-side .row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.mg-side .row b{color:var(--dsw-alias-label-primary);font-weight:600}
.mg-claim{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}
.mg-tagrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.mg-chip{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.mg-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px}
.mg-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);word-break:break-all}
.mg-node{cursor:pointer}
.mg-node text{pointer-events:none;font-size:11px;fill:var(--dsw-alias-label-secondary)}
.mg-node.on text{fill:var(--dsw-alias-label-primary);font-weight:600}
`

    // ---------------- 工具 ----------------
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }

    function forceLayout(nodes, links, W, H, iters) {
      const n = nodes.length
      if (!n) return nodes
      const idx = new Map(nodes.map((d, i) => [d.id, i]))
      nodes.forEach((d, i) => {
        const a = (i / n) * Math.PI * 2
        const r = Math.min(W, H) * (0.16 + 0.22 * ((i * 37) % 11) / 11)
        d.x = W / 2 + Math.cos(a) * r
        d.y = H / 2 + Math.sin(a) * r
      })
      const L = links.filter((e) => idx.has(e.a) && idx.has(e.b)).map((e) => ({ s: idx.get(e.a), t: idx.get(e.b), w: e.w }))
      const k = Math.sqrt((W * H) / Math.max(1, n))
      for (let it = 0; it < iters; it++) {
        const cool = 1 - it / iters
        for (let i = 0; i < n; i++) {
          const a = nodes[i]
          for (let j = i + 1; j < n; j++) {
            const b = nodes[j]
            let dx = a.x - b.x, dy = a.y - b.y
            let d2 = dx * dx + dy * dy
            if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1 }
            const d = Math.sqrt(d2)
            const f = (k * k * 0.42) / d2
            const ux = (dx / d) * f, uy = (dy / d) * f
            a.x += ux; a.y += uy; b.x -= ux; b.y -= uy
          }
        }
        for (const e of L) {
          const a = nodes[e.s], b = nodes[e.t]
          const dx = b.x - a.x, dy = b.y - a.y
          const d = Math.max(1, Math.hypot(dx, dy))
          const f = (d - k * 0.72) * 0.018 * (0.6 + Math.min(2, e.w) * 0.2)
          const ux = (dx / d) * f, uy = (dy / d) * f
          a.x += ux; a.y += uy; b.x -= ux; b.y -= uy
        }
        for (const d of nodes) {
          d.x += (W / 2 - d.x) * 0.006 * cool
          d.y += (H / 2 - d.y) * 0.006 * cool
          d.x = clamp(d.x, 46, W - 46)
          d.y = clamp(d.y, 34, H - 34)
        }
      }
      return nodes
    }

    const fmtAgo = (ms) => {
      if (!ms) return '—'
      const diff = Date.now() - ms
      const d = Math.floor(diff / 86400000)
      if (d > 0) return d + ' 天前'
      const hr = Math.floor(diff / 3600000)
      if (hr > 0) return hr + ' 小时前'
      return Math.max(1, Math.floor(diff / 60000)) + ' 分钟前'
    }

    // ---------------- 人视图 ----------------
    function PeopleGraph({ snap, sel, onSelect }) {
      const W = 1000, H = 620
      const nodes = useMemo(() => {
        const people = (snap.people || []).filter((p) => !p.isOwner && p.count >= 3)
        const owner = (snap.people || []).find((p) => p.isOwner)
        const groups = new Map()
        for (const p of people) {
          const main = (p.rooms[0] && p.rooms[0].key) || '?'
          if (!groups.has(main)) groups.set(main, [])
          groups.get(main).push(p)
        }
        const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
        const out = [{ id: 'ming', name: '溟', x: W / 2, y: H / 2, r: 34, color: COLOR.ming, kind: 'center' }]
        if (owner) {
          // 她单独一个大点，贴在中心右上——不是「一圈里的人」，是这个图的另一半
          out.push({ id: owner.id, name: owner.name, x: W / 2 + 128, y: H / 2 - 66, r: 27, color: COLOR.owner, kind: 'person', data: owner })
        }
        const step = (Math.PI * 2) / Math.max(1, order.length)
        order.forEach(([, list], gi) => {
          const a0 = gi * step
          const a1 = a0 + step
          const spread = Math.max(0.35, Math.min(1, list.length / 10))
          const radius = 175 + Math.min(4, Math.floor(list.length / 8)) * 26 + (gi % 2) * 16
          list.forEach((p, i) => {
            const t = list.length === 1 ? 0.5 : i / (list.length - 1)
            const ang = a0 + step * 0.5 + (t - 0.5) * step * spread * 0.9
            out.push({
              id: p.id,
              name: p.name,
              x: W / 2 + Math.cos(ang) * radius,
              y: H / 2 + Math.sin(ang) * (radius * 0.78),
              r: clamp(5 + Math.sqrt(p.count) * 2.6, 6, 25),
              color: COLOR.ring[gi % COLOR.ring.length],
              kind: 'person',
              data: p,
            })
          })
        })
        return out
      }, [snap])

      const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
      const selId = sel && sel.kind === 'person' ? sel.id : sel && sel.kind === 'center' ? 'ming' : null
      const neighbors = useMemo(() => new Set(selId ? [selId] : []), [selId])

      return h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
        // 星芒
        nodes.filter((n) => n.kind === 'person').map((n) => {
          const c = byId.get('ming')
          const on = !selId || selId === n.id || selId === 'ming'
          return h('line', {
            key: 'l' + n.id, x1: c.x, y1: c.y, x2: n.x, y2: n.y,
            stroke: n.color, 'stroke-opacity': on ? 0.28 : 0.08,
            'stroke-width': clamp(0.7 + Math.log2(1 + (n.data ? n.data.count : 1)) * 0.9, 0.7, 4.2),
          })
        }),
        nodes.map((n) => {
          const active = !selId || selId === n.id || selId === 'ming' || neighbors.has(n.id)
          const isSel = selId === n.id
          return h('g', {
            key: n.id, className: 'mg-node' + (isSel ? ' on' : ''), opacity: active ? 1 : 0.32,
            onClick: () => onSelect(n.kind === 'center' ? { kind: 'center', id: 'ming' } : { kind: 'person', id: n.id }),
          },
            n.kind === 'center'
              ? h('circle', { cx: n.x, cy: n.y, r: n.r, fill: n.color, 'fill-opacity': 0.16, stroke: n.color, 'stroke-width': 2 })
              : h('circle', { cx: n.x, cy: n.y, r: n.r, fill: n.color, 'fill-opacity': isSel ? 0.9 : 0.55, stroke: n.color, 'stroke-width': isSel ? 2 : 1 }),
            h('text', {
              x: n.x, y: n.y + n.r + 13, 'text-anchor': 'middle',
              style: n.kind === 'center' ? { fontSize: 14, fontWeight: 600, fill: 'var(--dsw-alias-label-primary)' } : undefined,
            }, n.name.length > 10 ? n.name.slice(0, 9) + '…' : n.name),
            n.kind === 'person' && n.data && n.data.count >= 12
              ? h('text', { x: n.x, y: n.y + 3.5, 'text-anchor': 'middle', style: { fontSize: 10, fill: '#fff', fontWeight: 600 } }, String(n.data.count))
              : null,
          )
        }),
      )
    }

    // ---------------- 主题视图 ----------------
    function TopicGraph({ snap, sel, onSelect }) {
      const W = 1000, H = 620
      const { nodes, links } = useMemo(() => {
        const terms = (snap.topics || [])
        const max = Math.max(3, Math.floor(H / 44))
        const bySource = { qq: terms.filter((t) => t.source === 'qq').slice(0, max), dsh: terms.filter((t) => t.source === 'dsh').slice(0, max) }
        const list = [...bySource.qq, ...bySource.dsh]
        const keep = new Set(list.map((t) => t.source + ':' + t.label))
        const nodes = list.map((t) => ({
          id: t.source + ':' + t.label,
          name: t.label,
          r: clamp(5 + Math.sqrt(t.count) * 2.1, 5, 22),
          color: t.source === 'qq' ? COLOR.qq : COLOR.dsh,
          kind: 'term',
          data: t,
        }))
        const links = []
        for (const e of snap.edges || []) {
          const pa = (e.source === 'qq' ? 'qq:' : 'dsh:') + e.a
          const pb = (e.source === 'qq' ? 'qq:' : 'dsh:') + e.b
          if (keep.has(pa) && keep.has(pb)) links.push({ a: pa, b: pb, w: e.w })
        }
        forceLayout(nodes, links, W, H, 260)
        return { nodes, links }
      }, [snap])

      const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
      const selId = sel && sel.kind === 'term' ? sel.id : null

      return h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
        links.map((e, i) => {
          const a = byId.get(e.a), b = byId.get(e.b)
          if (!a || !b) return null
          const on = !selId || selId === e.a || selId === e.b
          return h('line', {
            key: 'e' + i, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            stroke: 'var(--dsw-alias-label-tertiary)',
            'stroke-opacity': on ? clamp(0.08 + e.w * 0.07, 0.08, 0.5) : 0.05,
            'stroke-width': clamp(0.6 + e.w * 0.5, 0.6, 3),
          })
        }),
        nodes.map((n) => {
          const isSel = selId === n.id
          const dim = selId && !isSel && !links.some((e) => (e.a === selId && e.b === n.id) || (e.b === selId && e.a === n.id))
          return h('g', {
            key: n.id, className: 'mg-node' + (isSel ? ' on' : ''), opacity: dim ? 0.3 : 1,
            onClick: () => onSelect({ kind: 'term', id: n.id, data: n.data }),
          },
            h('circle', { cx: n.x, cy: n.y, r: n.r, fill: n.color, 'fill-opacity': isSel ? 0.92 : 0.5, stroke: n.color, 'stroke-width': isSel ? 2 : 0.8 }),
            h('text', { x: n.x, y: n.y + n.r + 12, 'text-anchor': 'middle' }, n.name),
          )
        }),
      )
    }

    // ---------------- 时间线 ----------------
    function Timeline({ snap, sel, onSelect }) {
      const W = 1000, H = 520
      const rows = snap.timeline || []
      const max = Math.max(1, ...rows.map((r) => r.qq + r.dsh))
      const padL = 46, padR = 20, padT = 20, padB = 54
      const bw = rows.length ? Math.max(6, Math.min(34, (W - padL - padR) / rows.length - 4)) : 10
      const step = rows.length ? (W - padL - padR) / rows.length : 0
      const scale = (v) => (H - padT - padB) * (v / max)

      return h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' },
        [0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + (H - padT - padB) * (1 - f)
          return h('g', { key: 'g' + f },
            h('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: 'var(--dsw-alias-border-l2)', 'stroke-width': 0.6 }),
            h('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', style: { fontSize: 10, fill: 'var(--dsw-alias-label-tertiary)' } }, String(Math.round(max * f))),
          )
        }),
        rows.map((r, i) => {
          const x = padL + i * step + (step - bw) / 2
          const hq = scale(r.qq), hd = scale(r.dsh)
          const isSel = sel && sel.kind === 'day' && sel.id === r.date
          return h('g', { key: r.date, className: 'mg-node', onClick: () => onSelect({ kind: 'day', id: r.date, data: r }) },
            h('rect', { x, y: H - padB - hq, width: bw, height: hq, rx: 2, fill: COLOR.qq, 'fill-opacity': isSel ? 1 : 0.75 }),
            h('rect', { x, y: H - padB - hq - hd, width: bw, height: hd, rx: 2, fill: COLOR.dsh, 'fill-opacity': isSel ? 1 : 0.75 }),
            i % 3 === 0 || rows.length <= 12
              ? h('text', { x: x + bw / 2, y: H - padB + 18, 'text-anchor': 'middle', style: { fontSize: 10, fill: 'var(--dsw-alias-label-tertiary)' } }, r.date.slice(5))
              : null,
          )
        }),
        h('g', null,
          h('rect', { x: W - 170, y: 6, width: 10, height: 10, rx: 2, fill: COLOR.qq }),
          h('text', { x: W - 154, y: 15, style: { fontSize: 11, fill: 'var(--dsw-alias-label-secondary)' } }, 'QQ 侧'),
          h('rect', { x: W - 100, y: 6, width: 10, height: 10, rx: 2, fill: COLOR.dsh }),
          h('text', { x: W - 84, y: 15, style: { fontSize: 11, fill: 'var(--dsw-alias-label-secondary)' } }, 'DSH 侧'),
        ),
      )
    }

    // ---------------- 详情 ----------------
    function Detail({ snap, sel, setSel }) {
      if (!snap) return null
      if (!sel || sel.kind === 'center') {
        const totalPeople = (snap.people || []).length
        const maxRoom = (snap.rooms || [])[0]
        return h('div', null,
          h('h4', null, '两侧记忆'),
          h('div', { className: 'row' }, h('span', null, 'QQ 侧观察'), h('b', null, String((snap.sources && snap.sources.qq && snap.sources.active) || 0))),
          h('div', { className: 'row' }, h('span', null, 'DSH 侧笔记'), h('b', null, String((snap.sources && snap.sources.dsh && snap.sources.dsh.active) || 0))),
          h('div', { className: 'row' }, h('span', null, '记到的人'), h('b', null, String(totalPeople))),
          h('div', { className: 'row' }, h('span', null, '房间'), h('b', null, String((snap.rooms || []).length))),
          maxRoom ? h('div', { className: 'row' }, h('span', null, '最热的一间'), h('b', null, `${maxRoom.label} · ${maxRoom.count}`)) : null,
          h('h4', { style: { marginTop: 16 } }, '怎么读'),
          h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '19px' } },
            '人：一圈是一个人，边宽就是他有多少条记忆。主题：词与词之间只要「在同一条记忆里一起出现」才连线，出现一次的不算。时间线按天，两色分开。'),
        )
      }
      if (sel.kind === 'person') {
        const p = (snap.people || []).find((x) => x.id === sel.id)
        if (!p) return null
        return h('div', null,
          h('h4', null, p.name),
          h('div', { className: 'row' }, h('span', null, 'QQ'), h('b', null, p.id)),
          h('div', { className: 'row' }, h('span', null, '记忆'), h('b', null, String(p.count))),
          h('div', { className: 'row' }, h('span', null, '最近一条'), h('b', null, fmtAgo(p.lastAt))),
          h('div', { className: 'mg-tagrow' },
            Object.entries(p.types || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('span', { className: 'mg-chip', key: k }, `${k} ${v}`)),
          ),
          h('div', { className: 'mg-tagrow' },
            (p.rooms || []).map((r) => h('span', { className: 'mg-chip', key: r.key }, `${r.label} ${r.count}`)),
          ),
          (p.claims || []).map((c, i) => h('p', { className: 'mg-claim', key: i }, c)),
        )
      }
      if (sel.kind === 'term') {
        const t = (sel.data) || { term: sel.id.split(':')[1], count: 0, source: sel.id.split(':')[0] }
        const related = (snap.edges || []).filter((e) => e.a === t.term || e.b === t.term)
          .sort((a, b) => b.w - a.w).slice(0, 12)
          .map((e) => ({ other: e.a === t.term ? e.b : e.a, w: e.w }))
        return h('div', null,
          h('h4', null, t.term),
          h('div', { className: 'row' }, h('span', null, '来源'), h('b', null, t.source === 'qq' ? 'QQ 侧' : 'DSH 侧')),
          h('div', { className: 'row' }, h('span', null, '出现'), h('b', null, String(t.count) + ' 条')),
          related.length ? h('h4', { style: { marginTop: 14 } }, '常一起出现') : h('p', { style: { marginTop: 12, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 } }, '这个词没有连着别的词。'),
          related.map((r) => h('div', { className: 'row', key: r.other }, h('span', null, r.other), h('b', null, String(r.w)))),
        )
      }
      if (sel.kind === 'day') {
        const d = sel.data
        return h('div', null,
          h('h4', null, d.date),
          h('div', { className: 'row' }, h('span', null, 'QQ 侧记忆'), h('b', null, String(d.qq))),
          h('div', { className: 'row' }, h('span', null, 'DSH 侧笔记'), h('b', null, String(d.dsh))),
        )
      }
      return null
    }

    // ---------------- 页面 ----------------
    function GraphPage() {
      const [snap, setSnap] = useState(null)
      const [err, setErr] = useState('')
      const [view, setView] = useState('people')
      const [sel, setSel] = useState(null)
      const [busy, setBusy] = useState(false)
      const stampRef = useRef(0)

      const load = useCallback((force) => {
        setBusy(true)
        fetch(API + (force ? '/refresh' : '/snapshot'), { cache: 'no-store' })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
          .then((d) => {
            if (d && d.error) { setErr(String(d.error)); return }
            setErr('')
            if (d.generatedAt !== stampRef.current) { stampRef.current = d.generatedAt; setSnap(d) }
          })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setBusy(false))
      }, [])

      useEffect(() => {
        load(false)
        const t = setInterval(() => load(false), 60000)
        return () => clearInterval(t)
      }, [load])

      const onSelect = useCallback((s) => setSel(s), [])

      const views = [['people', '人'], ['topic', '主题'], ['timeline', '时间线']]
      const updated = snap && snap.generatedAt ? new Date(snap.generatedAt).toLocaleTimeString() : '—'

      return h('div', { className: 'mg-root' },
        h('style', null, CSS),
        h('div', { className: 'mg-head' },
          h('h3', { className: 'mg-title' }, '记忆关系图'),
          h('span', { className: 'mg-meta' }, snap ? `两侧 ${((snap.sources.qq && snap.sources.qq.active) || 0) + ((snap.sources.dsh && snap.sources.dsh.active) || 0)} 条 · 更新于 ${updated}` : '读数据中…'),
          h('div', { className: 'mg-spacer' }),
          h('div', { className: 'mg-seg' }, views.map(([k, label]) => h('button', { key: k, 'data-on': view === k ? '1' : '0', onClick: () => { setView(k); setSel(null) } }, label))),
          h('button', { className: 'mg-btn', onClick: () => load(true), disabled: busy }, busy ? '刷新中…' : '刷新'),
        ),
        err ? h('div', { className: 'mg-err' }, err) : null,
        h('div', { className: 'mg-body' },
          h('div', { className: 'mg-canvas' },
            !snap ? h('div', { className: 'mg-empty' }, err ? '读不到数据' : '正在读两侧记忆…')
              : view === 'people' ? h(PeopleGraph, { snap, sel, onSelect })
              : view === 'topic' ? h(TopicGraph, { snap, sel, onSelect })
              : h(Timeline, { snap, sel, onSelect }),
          ),
          h('aside', { className: 'mg-side' }, h(Detail, { snap, sel, setSel })),
        ),
      )
    }

    // ---------------- 侧栏图标 ----------------
    // sidebar.panellist 只问「图标长什么样」，owner props = { size, active }。
    function GraphIcon(props) {
      const s = props && typeof props.size === 'number' ? props.size : 20
      const on = !!(props && props.active)
      const color = on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', {
        width: s, height: s, viewBox: '0 0 20 20', fill: 'none',
        stroke: color, strokeWidth: 1.3, strokeLinecap: 'round',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('line', { x1: 10, y1: 5.6, x2: 4.8, y2: 13.2 }),
        h('line', { x1: 10, y1: 5.6, x2: 15.2, y2: 13.2 }),
        h('line', { x1: 4.8, y1: 13.2, x2: 15.2, y2: 13.2, opacity: 0.5 }),
        h('circle', { cx: 10, cy: 5.6, r: 2.5, fill: color, stroke: 'none' }),
        h('circle', { cx: 4.8, cy: 13.2, r: 1.9, fill: color, stroke: 'none' }),
        h('circle', { cx: 15.2, cy: 13.2, r: 1.9, fill: color, stroke: 'none' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'ming-graph',
        }, GraphPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'ming-graph',
          order: 22,
          label: () => '关系图',
        }, GraphIcon))
      },
    }
  },
})
// touch 1793855795
