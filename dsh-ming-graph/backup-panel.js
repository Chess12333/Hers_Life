/**
 * panel.js —— DSH 面板外壳（React 只做两件事：顶部操作栏 + 把 neuron-view 挂进一个 div）
 *
 * 画图、交互、点开看正文全在 neuron-view.js 里，那边不依赖 React。
 * 这样同一份代码既能跑在面板里，也能直接丢进一个空 HTML 对 JSON 预览 ——
 * 「预览好看、面板难看」这种事，就是因为两边跑的不是同一份代码。
 *
 * 2026-11-07：顶部加一条 top 栏（她定的入口，先做布局和入口，不发明新样式）：
 *   视图切换（神经元 / 星图）· 搜索节点 · 筛选关系类型 · 导出 · 刷新。
 *   搜索和筛选不是面板自己过滤，是调 neuron-view 暴露的 setQuery / setWayFilter——
 *   数据只有一份，过滤只在渲染层做。
 */

const API = '/_dsh/dsh-ming-graph'

const PAGE_CSS = `
.mg-mount{height:100%;min-height:0;display:flex;flex-direction:column;position:relative}
.mg-holder{flex:1;min-height:0;display:flex;flex-direction:column}
.mg-msg{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:20px;text-align:center;line-height:20px}
.mg-msg.err{color:var(--dsw-alias-state-error-primary)}
.mg-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-separator-secondary);font-size:12px;color:var(--dsw-alias-label-tertiary)}
.mg-bar .mg-meta{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-btn{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer}
.mg-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.mg-btn:disabled{opacity:.5;cursor:default}
/* ---- top 栏（2026-11-07） ---- */
.mg-top{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-separator-secondary)}
.mg-seg{display:inline-flex;border:1px solid var(--dsw-alias-separator-secondary);border-radius:6px;overflow:hidden}
.mg-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:3px 10px;cursor:pointer}
.mg-seg button.on{background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}
.mg-input{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-primary);
  border-radius:6px;padding:3px 9px;font-size:12px;min-width:180px;outline:none}
.mg-input:focus{border-color:var(--dsw-alias-label-secondary)}
.mg-chip{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-tertiary);
  border-radius:999px;padding:2px 9px;font-size:11.5px;cursor:pointer}
.mg-chip.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.10))}
.mg-gap{flex:1}
.mg-note{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;
  padding:24px;text-align:center;line-height:22px;white-space:pre-wrap}
`

// ---------------- 侧栏图标 ----------------
// sidebar.panellist 只问「图标长什么样」：owner props = { size, active }
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

const WAYS = ['引用', '共词', '归属', '补边', '其他']

function NeuronPanel() {
  const holder = useRef(null)
  const viewRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [view, setView] = useState('neuron')      // neuron | star
  const [q, setQ] = useState('')
  const [ways, setWays] = useState(WAYS.slice())

  // force=false 走缓存；force=true 走 /neurons/refresh（Host 重读文件、重新加载 neuron.js）
  const load = useCallback((force) => {
    setBusy(true)
    const url = API + (force ? '/neurons/refresh' : '/neurons')
    return fetch(url, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.error) { setErr(String(d.error)); setStatus('error'); return }
        if (!window.__MingNeuronView) { setErr('渲染层没装上（neuron-view 未加载）'); setStatus('error'); return }
        if (viewRef.current && viewRef.current.destroy) viewRef.current.destroy()
        viewRef.current = window.__MingNeuronView.mount(holder.current, d, {})
        setStatus('ready')
        setErr('')
        setInfo({
          at: d.generatedAt || 0,
          memories: (d.stats && d.stats.memories) || 0,
          edges: (d.stats && d.stats.edges) || 0,
          loadError: d.neuronLoadError || '',
        })
      })
      .catch((e) => { setErr(String((e && e.message) || e)); setStatus('error') })
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => {
    load(false)
    return () => {
      if (viewRef.current && viewRef.current.destroy) { viewRef.current.destroy(); viewRef.current = null }
    }
  }, [])

  // top 栏 → 渲染层：数据不动，只改「看什么」
  useEffect(() => {
    if (viewRef.current && viewRef.current.setQuery) viewRef.current.setQuery(q)
  }, [q, status])

  useEffect(() => {
    if (viewRef.current && viewRef.current.setWayFilter) viewRef.current.setWayFilter(ways)
  }, [ways, status])

  function toggleWay(t) {
    setWays((cur) => (cur.indexOf(t) >= 0 ? cur.filter((x) => x !== t) : cur.concat([t])))
  }

  function exportJson() {
    const snap = viewRef.current && viewRef.current.snapshot ? viewRef.current.snapshot() : null
    if (!snap) return
    const blob = new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ming-neurons-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  }

  const when = info && info.at ? new Date(info.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''
  const meta = info
    ? `更新于 ${when} · ${info.memories} 条记忆 / ${info.edges} 条线${info.loadError ? ' · 建图代码加载失败，用的是旧模块' : ''}`
    : ''

  // 星图那一格：数据在星汐插件（dsh-xingxi）里，这边还没有合并——说出来，不假装有。
  const starNote = '星图在另一个插件（dsh-xingxi）里画：八章散成星群、日记排成时间星带。\n' +
    '这份面板还没接它——合并口径见 live/星图合并-2026-11-07.md，等她点头再动。'

  return h('div', { className: 'mg-mount' },
    h('style', null, PAGE_CSS),

    // ---- top 栏：全局操作 ----
    h('div', { className: 'mg-top' },
      h('div', { className: 'mg-seg' },
        h('button', { className: view === 'neuron' ? 'on' : '', onClick: () => setView('neuron') }, '神经元'),
        h('button', { className: view === 'star' ? 'on' : '', onClick: () => setView('star') }, '星图'),
      ),
      h('input', {
        className: 'mg-input',
        placeholder: '搜标题 / 正文里的词',
        value: q,
        disabled: view !== 'neuron' || status !== 'ready',
        onChange: (e) => setQ(e.target.value),
      }),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        WAYS.map((t) => h('button', {
          key: t,
          className: 'mg-chip' + (ways.indexOf(t) >= 0 ? ' on' : ''),
          disabled: view !== 'neuron' || status !== 'ready',
          title: '关掉这一类边，节点不删',
          onClick: () => toggleWay(t),
        }, t)),
      ),
      h('span', { className: 'mg-gap' }),
      h('button', { className: 'mg-btn', disabled: view !== 'neuron' || status !== 'ready', onClick: exportJson, title: '把这整份图导出成 JSON' }, '导出'),
      h('button', {
        className: 'mg-btn',
        disabled: busy,
        title: '重读两侧记忆库，并重新加载建图代码（改了 neuron.js 也按这个就生效）',
        onClick: () => load(true),
      }, busy ? '刷新中…' : '刷新'),
    ),

    // ---- 第二行：状态 ----
    h('div', { className: 'mg-bar' },
      h('span', { className: 'mg-meta' }, status === 'ready' ? meta : ''),
    ),

    view === 'neuron'
      ? h('div', { ref: holder, className: 'mg-holder', style: status === 'ready' ? null : { display: 'none' } })
      : h('div', { className: 'mg-note' }, starNote),

    view === 'neuron' && status === 'loading' ? h('div', { className: 'mg-msg' }, '正在读两侧记忆库…（第一次要扫一遍文件，大约两秒）') : null,
    view === 'neuron' && status === 'error' ? h('div', { className: 'mg-msg err' }, '读不到：' + err) : null,
  )
}

return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: 'ming-graph',
    }, NeuronPanel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'ming-graph',
      order: 22,
      label: () => '关系图',
    }, GraphIcon))
  },
}
