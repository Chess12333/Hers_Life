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

// 2026-11-07 21:23：版本号改成「构建那一刻」——它就是判据：面板上印的时间对不上，
// 说明浏览器拿的还是旧 bundle（今天为此白改过两次）。
const MG_VERSION = '2026-11-08 02:17'

// 侧栏那个名字（2026-11-07 22:0x 她说的）：自己用叫「她的一生」，对外发布要另一个名字，
// 两者不该靠改代码切换——写死一个，发布前改一遍、自己用又改回来，迟早漏。
// 默认「她的一生」；发布版在页面里先注入 `window.__MING_GRAPH_LABEL = '...'` 即可覆盖。
const PANEL_LABEL = (typeof window !== 'undefined' && window.__MING_GRAPH_LABEL) || '她的一生'
const API = '/_dsh/dsh-ming-graph'

// 2026-11-08：桌宠的十五只光标（dsh-ming-mousepet/assets/previews 里的）
const PET_SKINS = [
  ['pointer', '指针'], ['work', '工作'], ['link', '链接'], ['text', '文字'],
  ['cross', '精确'], ['busy', '等待'], ['move', '移动'], ['vert', '上下'],
  ['horz', '左右'], ['help', '求助'], ['handwriting', '手写'], ['dgn1', '对角一'],
  ['dgn2', '对角二'], ['alternate', '备用'], ['unavailiable', '不可用'],
]
if (typeof window !== 'undefined' && !window.__MG_ERR_HOOK) {
  window.__MG_ERR_HOOK = 1
  window.__MG_ERR = ''
  window.addEventListener('error', (e) => {
    window.__MG_ERR = String((e && e.message) || '') + ' / ' + String((e && e.error && e.error.stack) || '')
  })
  window.addEventListener('unhandledrejection', (e) => {
    window.__MG_ERR = 'promise: ' + String((e && e.reason && (e.reason.stack || e.reason.message)) || e.reason || '')
  })
}

const PAGE_CSS = `
.mg-mount{height:100%;min-height:480px;display:flex;flex-direction:column;position:relative}
.mg-holder{flex:1;min-height:420px;display:flex;flex-direction:column}
.mg-msg{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:20px;text-align:center;line-height:20px}
.mg-msg.err{color:var(--dsw-alias-state-error-primary)}
/* 2026-11-08 15:30 可读性：统一字号/行高/对比/点按反馈 */
.mg-mount{font-size:13px;line-height:1.62;-webkit-font-smoothing:antialiased}
.mg-holder{color:var(--dsw-alias-label-primary)}
.mg-msg{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);padding:14px 16px}
.mg-msg.err{color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.mg-pop-sec + .mg-pop-sec{margin-top:18px}
.mg-pop-sub{font-size:11.5px;line-height:1.65;color:var(--dsw-alias-label-tertiary, #8d8d9c)}
.mg-btn,.mg-chip{font-size:12.5px;padding:5px 12px;border-radius:8px;
  transition:background .16s ease,color .16s ease,border-color .16s ease,transform .08s ease}
.mg-btn:hover,.mg-chip:hover{background:rgba(127,127,127,.12);color:var(--dsw-alias-label-primary)}
.mg-btn:active,.mg-chip:active{transform:translateY(1px)}
.mg-input{font-size:12.5px;padding:6px 9px;border-radius:8px}
.mg-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-separator-secondary);font-size:12px;color:var(--dsw-alias-label-tertiary)}
.mg-bar .mg-meta{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-btn{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer}
.mg-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.mg-btn:disabled{opacity:.5;cursor:default}
/* ---- top 栏（2026-11-07） ---- */
.mg-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 16px;min-height:34px}
/* 2026-11-08 15:5x：工具条——搜索 + 关系筛选从 top 栏搬下来，独占一行 */
.mg-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;
  border-bottom:1px solid var(--dsw-alias-separator-secondary);background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))}
.mg-tools .mg-input{flex:0 1 260px;min-width:140px}
.mg-tools-l{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-right:2px}
.mg-meta{font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;letter-spacing:.01em}
.mg-top{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 14px;background:var(--dsw-alias-bg-secondary, rgba(127,127,127,.07));border-bottom:1px solid var(--dsw-alias-separator-primary, rgba(150,150,170,.45));box-shadow:inset 0 -1px 0 rgba(0,0,0,.18);transition:background .18s ease}
.mg-brand{display:inline-flex;align-items:baseline;gap:7px;margin-right:10px;font-size:16px;font-weight:700;letter-spacing:.01em;color:var(--dsw-alias-label-primary);white-space:nowrap}
.mg-brand i{font-style:normal;font-size:10px;font-weight:400;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);opacity:.55}
.mg-seg{display:inline-flex;border:1px solid var(--dsw-alias-separator-primary, rgba(150,150,170,.42));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-primary, rgba(0,0,0,.16))}
.mg-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:13px;font-weight:500;padding:6px 15px;cursor:pointer;letter-spacing:.01em;
  transition:color .16s ease,background .16s ease,transform .08s ease;position:relative}
.mg-seg button:hover{color:var(--dsw-alias-label-primary);background:rgba(127,127,127,.12)}
.mg-seg button:active{transform:translateY(1px) scale(.985)}
.mg-seg button.on:hover{background:var(--dsw-alias-brand-primary, #6aa9ff);color:#08111f}
.mg-seg button.on{background:var(--dsw-alias-brand-primary, #6aa9ff);color:#08111f;font-weight:700;
  box-shadow:0 0 0 1px rgba(106,169,255,.45),0 2px 8px rgba(106,169,255,.28)}
.mg-input{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-primary);
  border-radius:6px;padding:3px 9px;font-size:12px;min-width:180px;outline:none}
.mg-input:focus{border-color:var(--dsw-alias-label-secondary)}
.mg-chip{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-tertiary);
  border-radius:999px;padding:2px 9px;font-size:11.5px;cursor:pointer}
.mg-chip.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.10))}
.mg-gap{flex:1}
/* ---- 2026-11-08：top 栏两个浮层（skill 开关 / 费用） ---- */
.mg-btn.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14))}
.mg-veil{position:fixed;inset:0;z-index:40;background:transparent}
.mg-pop{position:absolute;top:48px;right:12px;z-index:41;width:min(520px,calc(100% - 24px));max-height:62vh;overflow:auto;
  background:var(--dsw-alias-bg-overlay,#1b2740);border:1px solid var(--dsw-alias-border-l1, rgba(150,150,170,.28));
  border-radius:10px;box-shadow:0 14px 38px rgba(0,0,0,.34);padding:10px 12px 8px;animation:mgPop .14s ease both}
.mg-pop-h{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-separator-secondary);font-size:12.5px}
.mg-pop-h b{font-weight:600;color:var(--dsw-alias-label-primary)}
.mg-pop-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.mg-pop-line{display:flex;align-items:center;gap:8px;padding:8px 0}
.mg-petpage{padding:12px 14px;overflow:auto;height:100%}
.mg-pethead{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
.mg-pethead h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mg-petrow{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:12.5px;flex-wrap:wrap}
.mg-petrow b{font-weight:600;color:var(--dsw-alias-label-primary);min-width:44px}
.mg-petsect{margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-separator-secondary)}
.mg-petsect h4{margin:0 0 2px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mg-skinwrap{position:relative;display:flex}
.mg-skinwrap.on .mg-skin{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14))}
.mg-skindel{position:absolute;top:-4px;right:-4px;width:18px;height:18px;line-height:1;border-radius:50%;
  border:1px solid var(--dsw-alias-separator-secondary);background:var(--dsw-alias-bg-overlay,#1b2740);
  color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer;padding:0}
.mg-skindel:hover{color:#f87171;border-color:#f87171}
.mg-skins{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;width:100%}
.mg-skin{appearance:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;
  border:1px solid var(--dsw-alias-separator-secondary);border-radius:8px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.1}
.mg-skin img{width:26px;height:26px;image-rendering:pixelated;object-fit:contain}
.mg-skin:hover{border-color:var(--dsw-alias-label-secondary)}
.mg-skin.on{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}
.mg-skin:disabled{opacity:.45;cursor:default}
.mg-pop-line .mg-input{min-width:120px;flex:1}
.mg-pop-empty{padding:14px 2px;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
.mg-pop-foot{margin-top:8px;padding-top:7px;border-top:1px solid var(--dsw-alias-separator-secondary);
  font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.mg-x{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:15px;line-height:1;cursor:pointer;padding:0 2px}
.mg-x:hover{color:var(--dsw-alias-label-primary)}
.mg-skill{display:flex;align-items:flex-start;gap:10px;padding:7px 2px;border-bottom:1px dashed var(--dsw-alias-separator-secondary)}
.mg-skill:last-child{border-bottom:0}
.mg-skill.off .mg-skill-n,.mg-skill.off .mg-skill-d{opacity:.55}
.mg-skill-n{font-size:12.5px;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-skill-d{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mg-tag{font-style:normal;font-size:10px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-separator-secondary);color:var(--dsw-alias-label-tertiary)}
.mg-sw{appearance:none;flex:0 0 auto;min-width:38px;border-radius:999px;border:1px solid var(--dsw-alias-separator-secondary);
  background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;padding:2px 8px;cursor:pointer}
.mg-sw.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.16))}
.mg-sw:disabled{opacity:.5;cursor:default}
.mg-cost{display:grid;grid-template-columns:1fr auto;gap:5px 14px;padding:8px 2px 2px;font-size:12.5px}
.mg-cost span{color:var(--dsw-alias-label-secondary)}
.mg-cost b{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right}
/* 2026-11-07 13:51：DOM 网格（不用 canvas） */
.mg-gridwrap{flex:1;min-height:0;overflow:auto;padding:18px 20px 12px}
.mg-grid{display:grid;row-gap:6px;column-gap:3px}
.mg-rl{font-size:11.5px;color:var(--dsw-alias-label-secondary);text-align:right;padding-right:10px;white-space:nowrap;font-variant-numeric:tabular-nums}
.mg-rl b{color:var(--dsw-alias-label-primary);font-weight:600;margin-left:5px}
.mg-cell{height:26px;border-radius:6px;transition:transform .08s ease}
.mg-cell:hover{transform:scale(1.18);outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px}
.mg-xaxis{margin-top:8px}
.mg-xt{font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;overflow:hidden;opacity:.75}
.mg-legend{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:12px}
.mg-lg{width:15px;height:11px;border-radius:3px}
.mg-note{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;
  padding:24px;text-align:center;line-height:22px;white-space:pre-wrap}
/* ================= 2026-11-07 19:3x 动画与可读性 =================
   她说「给整个界面加动画过渡、更好地可读交互」。
   原则：动的是「出现/切换」，不动位置；一个动画不超过 200ms，不做循环。 */
@keyframes mgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes mgPop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
.mg-holder>.ming-panel,.mg-holder>.svx-root{animation:mgIn .18s ease both}
.ming-panel{font-size:13.5px;line-height:1.72}
.ming-card{transition:border-color .15s ease,box-shadow .15s ease}
.ming-card:hover{border-color:var(--dsw-alias-border-l3)}
.ming-row{padding:6px 6px;border-radius:6px;transition:background .12s ease,transform .06s ease}
.ming-row:hover{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.08))}
.ming-row:active{transform:scale(.997)}
.ming-btn,.mg-btn,.mg-chip,.mg-seg button{transition:color .12s ease,border-color .12s ease,background .12s ease,transform .06s ease}
.ming-btn:active,.mg-btn:active,.mg-chip:active{transform:scale(.96)}
.mg-seg button{position:relative}
.mg-seg button.on::after{content:'';position:absolute;left:10px;right:10px;bottom:1px;height:1.5px;background:currentColor;border-radius:2px;animation:mgIn .16s ease both}
.ming-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ming-kpi{font-variant-numeric:tabular-nums}
.ming-scroll{scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.28) transparent}
.ming-scroll::-webkit-scrollbar{width:9px;height:9px}
.ming-scroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,.22);border-radius:5px;border:2px solid transparent;background-clip:content-box}
.ming-scroll::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.42);background-clip:content-box}
.ming-scroll::-webkit-scrollbar-track{background:transparent}
.mg-zoom{_:_}
.mg-zoom img{animation:mgPop .16s ease both}
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

// 边类型：跟 Host 的 e.kind 一一对应（ref / cokey / project / adjacent / subject）
const WAYS = ['引用', '共词', '归属', '补边', '主语']

// ---- 记忆库视图（2026-11-07） ----
// 她说：有图就别再另开一个侧栏图标，记忆就在这张图顶上开一格。
// 数据走 dsh-ming-memory 的只读路由，跟图没关系——一个列旧账，一个看形状。
const MEMORY_API = '/_dsh/dsh-ming-memory'

function fmtClock(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// 2026-11-07 19:0x：记忆 tab 改成吃**统一节点模型**（/_dsh/dsh-ming-graph/neurons/unified），
// 不再依赖 dsh-ming-memory 的 /list——那个插件的 Host 半端一直没能加载（exports 里没有 "."），
// 每次打开都是 △ HTTP 404。图这边本来就把 notes 全读进来了，章也在里面，不用再绕一圈。
function MemoryView(props) {
  const q = (props && props.q) || ''
  // 2026-11-07 21:4x：选中态穿过视图。外面（星图、搜索）选中了哪条，这里跟着展开；
  // 这里点开一条，也报回上层——切回星图时对着同一颗星。之前三个视图各管各的。
  const selId = (props && props.selId) || ''
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState('')
  const [chap, setChap] = useState('')
  // 2026-11-07 22:3x：按人筛。她的记忆大半跟人绑着，可面板只能按章筛——
  // 「某人说过什么」在界面上根本没有入口。people 是统一节点里现成的字段，不用新数据。
  const [who, setWho] = useState('')
  const [people, setPeople] = useState([])
  // 2026-11-07 22:4x：人太多，chips 只放得下十二个。给一个完整列表——
  // 这是「她这辈子认识的人」唯一一处能一眼看全的地方。
  const [peopleMode, setPeopleMode] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch('/_dsh/dsh-ming-graph/neurons/unified', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.error) { setErr(String(d.error)); return }
        const all = d.nodes || []
        const pName = new Map()
        for (const n of all) if (n.kind === 'person') pName.set(n.id, n.title || n.name || n.id)
        const rows = all
          .filter((n) => n.kind === 'memory')
          .map((n) => ({
            id: n.id,
            title: n.title || n.id,
            body: n.body || n.excerpt || '',
            date: n.date || '',
            at: n.at || 0,
            tags: (n.tags || []).join(' '),
            source: n.source || '',
            chapter: n.chapter || 0,
            chapterName: n.chapterName || '',
            // 兜一层：数据层理论上已带 person: 前缀，没带的这里补上，别让两边各用一套写法
            people: (n.people || []).filter(Boolean).map((p) => (String(p).startsWith('person:') ? String(p) : 'person:' + p)),
          }))
          .sort((a, b) => (b.at || 0) - (a.at || 0))
        setItems(rows)
        // 每个人名下几条，按「有没有名字」再按条数排——纯号码的排后面，认不出名字的少往前放
        const cnt = new Map()
        for (const r of rows) for (const p of r.people) cnt.set(p, (cnt.get(p) || 0) + 1)
        setPeople([...cnt.entries()]
          .map(([id, n]) => ({ id, name: pName.get(id) || id, n, named: pName.has(id) }))
          .sort((a, b) => (Number(b.named) - Number(a.named)) || (b.n - a.n)))
        if (props && props.onData) props.onData({ items: rows, total: rows.length })
      })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!selId) return
    // 点的是人（星图/神经元上那颗人形的点）→ 切到按人筛；点的是记忆 → 展开它
    if (people.some((p) => p.id === selId)) { setWho(selId); setOpenId(''); setPeopleMode(false); return }
    if (items.some((x) => x.id === selId)) setOpenId(selId)
  }, [selId, items, people])

  const kw = q.trim().toLowerCase()
  const shown = items
    .filter((it) => (!kw ? true : (it.id + ' ' + it.title + ' ' + it.tags + ' ' + it.source).toLowerCase().indexOf(kw) >= 0))
    .filter((it) => (!who ? true : (it.people || []).indexOf(who) >= 0))
    .filter((it) => {
      if (!chap) return true
      if (chap === 'none') return !it.chapter
      return String(it.chapter) === chap
    })

  const opened = openId ? items.find((x) => x.id === openId) : null
  if (opened) {
    // 2026-11-08 15:5x：壳已经给了页头，这里不再叠一层 head——直接是「返回 + 这一条的标题」。
    return h('div', { className: 'ming-wrap ming-scroll' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('button', { className: 'mg-btn', onClick: () => setOpenId('') }, '← 返回'),
        h('span', { style: { fontWeight: 600, fontSize: 14.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, opened.title),
        opened.chapter ? h('span', { className: 'ming-pill' }, '第' + opened.chapter + '章') : null,
        h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, opened.date),
      ),
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '正文'),
          h('span', { className: 'ming-sec-n' }, opened.id),
        ),
        h('div', {
          className: 'ming-sec-b',
          style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13.5, lineHeight: 1.85, letterSpacing: '.01em' },
        }, opened.body || '（这条没有正文）'),
      ),
    )
  }

  // 人的完整列表（2026-11-07 22:4x）：chips 只放得下十二个，这里能一眼看全
  if (peopleMode) {
    return h('div', { className: 'ming-wrap ming-scroll' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('button', { className: 'mg-btn', onClick: () => setPeopleMode(false) }, '← 记忆'),
        h('span', { style: { fontWeight: 600, fontSize: 14.5 } }, '人'),
        h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, people.length + ' 位'),
      ),
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '全部的人'),
          h('span', { className: 'ming-sec-n' }, '点一位，看跟他有关的记忆'),
        ),
        people.length === 0
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, busy ? '…' : '还没读出人来'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-list' },
              people.map((p) => h('div', {
                key: p.id,
                className: 'ming-li',
                style: { cursor: 'pointer' },
                title: p.id,
                onClick: () => { setWho(p.id); setPeopleMode(false); if (props.onSelect) props.onSelect(p.id) },
              },
                h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 } }, String(p.name)),
                p.named ? null : h('span', { className: 'ming-pill' }, '没名字'),
                h('span', { className: 'ming-note' }, p.n + ' 条'),
              )),
            ),
          ),
      ),
    )
  }

  // 2026-11-08 15:5x：分成两块——「筛」和「记忆」。原来筛选 chip 和列表贴在一起，
  // 中间没有任何分隔，看不出哪一行是筛、哪一行是内容。
  return h('div', { className: 'ming-wrap ming-scroll' },
    err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

    (people.length || items.length)
      ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '筛'),
          h('span', { className: 'ming-sec-n' },
            (busy ? '读取中…' : items.length + ' 条记忆') +
            (shown.length !== items.length ? ' · 现在显示 ' + shown.length : '')),
        ),
        h('div', { className: 'ming-sec-b' },
          people.length ? h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { className: 'ming-note', style: { marginRight: 2 } }, '人'),
            h('button', { className: 'mg-chip' + (who ? '' : ' on'), onClick: () => setWho('') }, '全部'),
            people.slice(0, 12).map((p) => {
              const nm = String(p.name)
              return h('button', {
                key: p.id,
                className: 'mg-chip' + (who === p.id ? ' on' : ''),
                title: nm,
                onClick: () => { setWho(p.id); if (props.onSelect) props.onSelect(p.id) },
              }, (nm.length > 8 ? nm.slice(0, 8) + '…' : nm) + ' ' + p.n)
            }),
            people.length > 12 ? h('button', {
              className: 'mg-chip',
              onClick: () => setPeopleMode(true),
            }, '全部 ' + people.length + ' 位 →') : null,
          ) : null,
          items.length ? h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { className: 'ming-note', style: { marginRight: 2 } }, '章'),
            ['', '1', '2', '3', '4', '5', '6', '7', '8', 'none'].map((c) => {
              const hit = items.find((x) => String(x.chapter) === c)
              const label = c === '' ? '全部' : c === 'none' ? '未分章' : ((hit && hit.chapterName) || ('第' + c + '章'))
              return h('button', {
                key: c || 'all',
                className: 'mg-chip' + (chap === c ? ' on' : ''),
                onClick: () => setChap(c),
              }, label)
            }),
          ) : null,
        ),
      )
      : null,

    h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '记忆'),
        h('span', { className: 'ming-sec-n' }, shown.length + ' 条 · 点一行看正文'),
      ),
      (!err && shown.length === 0)
        ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, busy ? '…' : '没有匹配的记忆'))
        : h('div', { className: 'ming-sec-b flush' },
          h('div', { className: 'ming-list' },
            shown.map((it) => h('div', {
              key: it.id,
              className: 'ming-li',
              style: { cursor: 'pointer' },
              onClick: () => { setOpenId(it.id); if (props.onSelect) props.onSelect(it.id) },
              title: it.id,
            },
              h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 } }, it.title),
              it.chapter ? h('span', { className: 'ming-pill' }, '第' + it.chapter + '章') : null,
              h('span', { className: 'ming-note' }, it.date || ''),
            )),
          ),
        ),
    ),
  )
}

// 2026-11-07 16:30 加、19:1x 补回（做记忆 tab 替换时被一并切掉了，于是面板一崩就整块黑）。
class PanelBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: '' } }
  static getDerivedStateFromError(e) { return { err: String((e && e.stack) || e) } }
  componentDidCatch(e) {
    try {
      this.setState({ err: String((e && e.stack) || e) + ' / 最近一条全局错误：' + String(window.__MG_ERR || '(无)') })
    } catch (x) {}
  }
  render() {
    if (this.state.err) {
      return h('div', { style: { padding: '14px 18px', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: '18px', whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-state-error-primary)', overflow: 'auto', height: '100%' } },
        '家底崩了（v' + MG_VERSION + '）：' + this.state.err)
    }
    return this.props.children
  }
}

// ===== 2026-11-08：top 栏两个新入口 =====
// 她说的：「再在她的一生的 top 栏中做一个 skill 开关的 top 选项，然后还有费用计费」。
// 两个都做成浮层，不占一格 tab——它们不是「看什么」，是「现在花多少、模型能看见什么」。

function fmtMoney(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  if (v >= 100) return '¥' + v.toFixed(0)
  if (v >= 10) return '¥' + v.toFixed(1)
  return '¥' + v.toFixed(3)
}

// 浮层壳：半透明遮罩负责「点外面关掉」，不拦事件到按钮上
function MgPop(props) {
  return [
    h('div', { key: 'veil', className: 'mg-veil', onClick: props.onClose }),
    h('div', { key: 'pop', className: 'mg-pop' },
      h('div', { className: 'mg-pop-h' },
        h('b', null, props.title),
        props.sub ? h('span', { className: 'mg-pop-sub' }, props.sub) : null,
        h('span', { className: 'mg-gap' }),
        h('button', { className: 'mg-x', onClick: props.onClose, title: '关掉' }, '×'),
      ),
      props.children,
    ),
  ]
}

function SkillsBody(props) {
  const d = props.data
  if (!d) return h('div', { className: 'mg-pop-empty' }, '读清单中…')
  if (d.ok === false) return h('div', { className: 'mg-pop-empty' }, '读不到 skill 清单：' + (d.error || '未知原因'))
  const rows = d.rows || []
  const q = (props.q || '').trim().toLowerCase()
  const shown = q
    ? rows.filter((r) => (r.name || '').toLowerCase().indexOf(q) >= 0 || (r.desc || '').toLowerCase().indexOf(q) >= 0)
    : rows
  return h('div', null,
    h('div', { className: 'mg-pop-line' },
      h('input', {
        className: 'mg-input', placeholder: '过滤名字 / 描述', value: props.q || '',
        onChange: (e) => props.onQ(e.target.value),
      }),
      h('button', { className: 'mg-btn', onClick: props.onReload, title: '重新问一遍宿主' }, '重读'),
      h('span', { className: 'mg-pop-sub' }, '开 ' + (d.total - (d.offCount || 0)) + ' / 共 ' + d.total),
    ),
    shown.length
      ? shown.map((r) => h('div', { key: r.name, className: 'mg-skill' + (r.on ? '' : ' off') },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { className: 'mg-skill-n' },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name),
            r.provider === 'ming-skill-isolate' ? h('i', { className: 'mg-tag', title: '只剩遮罩条目，原文件没找到' }, '遮罩') : null,
            r.source === 'bundled' ? h('i', { className: 'mg-tag' }, '自带') : null,
          ),
          h('div', { className: 'mg-skill-d', title: r.desc || '' }, r.desc || '（没有描述）'),
        ),
        h('button', {
          className: 'mg-sw' + (r.on ? ' on' : ''),
          disabled: props.busy === r.name,
          title: r.on ? '关掉：从模型视野里遮掉（不删文件）' : '开回来',
          onClick: () => props.onToggle(r.name, !r.on),
        }, props.busy === r.name ? '…' : (r.on ? '开' : '关')),
      ))
      : h('div', { className: 'mg-pop-empty' }, '没有匹配的'),
    h('div', { className: 'mg-pop-foot' },
      d.source === 'disk'
        ? '⚠ 宿主 skills 服务没接上，这份是从 ~/.dsh/skills 扫出来的——可能比模型真正看到的多。'
        : '清单来自宿主 skills 服务（跟模型看到的是同一份）。',
      ' 开关写 ' + (d.offFile || 'skills-off.json') + '，只对 ' + (d.cwd || '这个工作区') + ' 生效。',
      '改完立刻算数，但当前这一轮的目录已经组装完——下一次请求才刷新。'),
  )
}

// 2026-11-08 16:1x：费用页改成读我们自己的接口 /_dsh/dsh-ming-graph/cost
// 原来读 dsh-bottom-info-bar 的 getUsageSummary，它返回不出数（账本有 token 没价）。
// 现在口径由 cost-lib.mjs 定，页面只负责显示，并把口径原样印在下面。
function MgCostPage(props) {
  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 19V5M4 19h16' }),
          h('path', { d: 'M8 16v-5M12.5 16V8M17 16v-3' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '费用'),
        h('div', { className: 'ming-ph-d' }, '用量是账本里的实数；金额按官方价折算，不是实际扣款'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('button', { className: 'mg-btn', onClick: props.onReload }, '重读'),
      ),
    ),
    h('div', { className: 'ming-wrap ming-scroll' }, h(CostBody, props)),
  )
}

function SumTokens(x) {
  return (x.input || 0) + (x.cacheRead || 0) + (x.output || 0)
}

function fmtTokens(n) {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}

function CostBody(props) {
  const d = props.data
  if (props.err) {
    return h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'mg-pop-empty' }, '读不到账本：' + props.err),
      ),
    )
  }
  if (!d) return h('div', { className: 'ming-empty' }, '读账本中…')
  if (d.ok === false) {
    return h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'mg-pop-empty' }, '读不到账本：' + (d.error || '未知原因')),
        h('div', { className: 'ming-note' }, '账本在 ~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite，由那个插件写；它没装或没跑起来时这里就是空的。'),
      ),
    )
  }

  const p = d.periods || {}
  const cell = (label, x) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n' }, fmtMoney(x ? x.cost : 0)),
    h('span', { className: 'ming-kpi-l' }, label + ' · ' + fmtTokens(x ? SumTokens(x) : 0) + ' tokens'))

  const rows = (p.all && p.all.models) || []
  return [
    h('div', { key: 'sum', className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '花了多少'),
        h('span', { className: 'ming-sec-n' }, '人民币 · 折算'),
      ),
      h('div', { className: 'ming-kpis' },
        cell('今日（北京）', p.today),
        cell('本月', p.month),
        cell('近 30 天', p.d30),
        cell('全部', p.all),
      ),
    ),

    h('div', { key: 'models', className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '按模型'),
        h('span', { className: 'ming-sec-n' }, rows.length + ' 个'),
      ),
      h('div', { className: 'ming-sec-b flush' },
        h('div', { className: 'ming-list' },
          rows.map((m) => h('div', { key: m.model, className: 'ming-li' },
            h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 } }, m.model),
            m.priced ? null : h('span', { className: 'ming-pill', 'data-tone': 'warn', title: '价目表里没有这个写法，金额按 0 计' }, '未定价'),
            h('span', { className: 'ming-note', style: { width: 64, textAlign: 'right' } }, m.records + ' 次'),
            h('span', { className: 'ming-note', style: { width: 120, textAlign: 'right' } }, fmtTokens(SumTokens(m)) + ' tok'),
            h('span', { className: 'ming-li-t', style: { width: 84, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmtMoney(m.cost)),
          )),
        ),
      ),
    ),

    h('div', { key: 'basis', className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'ming-note' }, d.basis || ''),
        h('div', { className: 'ming-note' }, '价目：' + (d.pricesSource || '内置') + '　账本：' + (d.ledger || '') + '　读于 ' + String(d.at || '').replace('T', ' ').slice(0, 16)),
      ),
    ),
  ]
}

// ---------------------------------------------------------------------------
// 桌宠整页（2026-11-08）
// 她说的：「变成单独页，不是现在这种浮层；做皮肤切换器，可以自己添加删除皮肤，
// 现在这十五只做默认皮肤。」——所以内置那批是只读的，用户自己加的在下面一格。
// ---------------------------------------------------------------------------
function PetPage() {
  const [s, setS] = useState(null)
  const [skins, setSkins] = useState({ builtin: [], custom: [] })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [newName, setNewName] = useState('')
  const [sched, setSched] = useState(null)
  // 2026-11-08（她提的「桌面那只只能用默认模型」）：模型选择器的数据源。
  //   列表由 mousepet 那句 /models 从宿主 llm 现取；手填那一格是兜底。
  const [models, setModels] = useState(null)
  const [modelDraft, setModelDraft] = useState('')
  // 2026-11-08 16:0x 她说的「ai光标大小改成预设+左右拉条吧」：
  //   拉条拖动时只改本地 draft，松手才落盘——不然拖一次会发几十个 POST。
  const [sizeDraft, setSizeDraft] = useState(null)
  const sizeTimer = useRef(0)
  useEffect(() => { setSizeDraft(s && typeof s.cursorSize === 'number' ? s.cursorSize : null) }, [s])

  const loadSettings = useCallback(() => fetch('/dsh-ming-mousepet/api/settings', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setS(d && d.settings ? d.settings : null))
    .catch(() => setS(null)), [])

  const loadSkins = useCallback(() => fetch('/dsh-ming-mousepet/api/skins', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setSkins({ builtin: (d && d.builtin) || [], custom: (d && d.custom) || [] }))
    .catch(() => setSkins({ builtin: [], custom: [] })), [])

  const loadSched = useCallback(() => fetch('/dsh-ming-mousepet/api/schedule', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setSched(d && d.ok ? d : null))
    .catch(() => setSched(null)), [])

  // 2026-11-08：能选哪些模型由宿主 llm 说了算，页面只负责显示和提交。
  const loadModels = useCallback(() => fetch('/dsh-ming-mousepet/api/models', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setModels(d && d.ok ? d : null))
    .catch(() => setModels(null)), [])

  // 2026-11-08：自动开口的节奏（关 / 心跳 / 随机 / 固定 + 基础间隔 + 每日上限）。
  // 存在 pet-state.json 里，改完下一轮就生效，不用重启 DSH。
  const saveSched = useCallback((patch) => {
    setSched((cur) => (cur ? { ...cur, ...patch } : cur))
    return fetch('/dsh-ming-mousepet/api/schedule', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.ok) setSched(d); return d })
      .catch(() => null)
  }, [])

  useEffect(() => { loadSettings(); loadSkins(); loadSched(); loadModels() }, [loadSettings, loadSkins, loadSched, loadModels])

  const save = useCallback((patch) => {
    setBusy(true)
    return fetch('/dsh-ming-mousepet/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.settings) setS(d.settings); return d })
      .catch(() => null)
      .finally(() => setBusy(false))
  }, [])

  const show = useCallback((on) => {
    fetch('/dsh-ming-mousepet/api/' + (on ? 'show' : 'hide'), { method: 'POST', cache: 'no-store' }).catch(() => null)
  }, [])

  const applySkin = useCallback((key) => {
    setNote('换上了：' + key.replace('custom:', ''))
    save({ cursorState: key })
    show(true)
  }, [save, show])

  const upload = useCallback((file) => {
    if (!file) return
    const base = (newName || file.name.replace(/\.[^.]+$/, '') || 'skin').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'skin'
    const reader = new FileReader()
    reader.onload = () => {
      setBusy(true)
      fetch('/dsh-ming-mousepet/api/skins', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: base, data: String(reader.result) }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d && d.ok) {
            setNote('加好了：' + base)
            setNewName('')
            loadSkins()
            applySkin('custom:' + base)
          } else {
            setNote((d && d.error) || '没加成')
          }
        })
        .catch(() => setNote('上传失败'))
        .finally(() => setBusy(false))
    }
    reader.readAsDataURL(file)
  }, [newName, loadSkins, applySkin])

  const removeSkin = useCallback((name) => {
    setBusy(true)
    fetch('/dsh-ming-mousepet/api/skins?name=' + encodeURIComponent(name), { method: 'DELETE' })
      .then((r) => r.json())
      .then((d) => { setNote(d && d.ok ? '删掉了：' + name : ((d && d.error) || '没删掉')); loadSkins() })
      .catch(() => setNote('删除失败'))
      .finally(() => setBusy(false))
  }, [loadSkins])

  const names = {}
  PET_SKINS.forEach(([k, v]) => { names[k] = v })
  const cur = s ? s.cursorState : ''
  const hasSkinApi = skins.builtin && skins.builtin.length > 0

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
          h('path', { d: 'M5 3l6 9-3 .5 2.5 4.5-2 1-2.5-4.5L4 16z' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '桌宠'),
        h('div', { className: 'ming-ph-d' }, s
          ? '桌面上那只 AI 光标：皮肤、大小、什么时候自己开口。改完立刻生效，不用重启'
          : '鼠标插件没应——没装，或 sidecar 没起来'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('button', { className: 'ming-btn', onClick: () => show(true) }, '亮出来'),
        h('button', { className: 'ming-btn', onClick: () => show(false) }, '收起'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },

      // ---- 1. 光标本身 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '光标'),
          h('span', { className: 'ming-sec-n' }, '左键按住能拖走 · 右键有菜单（锁定 / 关掉）'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { className: 'mg-petrow' },
            h('b', null, '大小'),
            [24, 48, 64, 96, 128].map((n) => h('button', {
              key: 'sz' + n,
              className: 'mg-chip' + (s && s.cursorSize === n ? ' on' : ''),
              disabled: busy || !s,
              onClick: () => { setSizeDraft(n); save({ cursorSize: n }) },
            }, String(n))),
            // 2026-11-08 16:1x 她说的「大小能不能实时同步」：拖的时候就跟着变。
            //   只在手上停了 140ms 才落盘一次——曲线是连续的，请求不必也是。
            h('input', {
              type: 'range', min: 24, max: 192, step: 2,
              value: sizeDraft == null ? 64 : sizeDraft,
              disabled: busy || !s,
              title: '拖到哪，桌面那只就变到哪',
              onChange: (e) => {
                const v = Number(e.target.value)
                setSizeDraft(v)
                clearTimeout(sizeTimer.current)
                sizeTimer.current = setTimeout(() => save({ cursorSize: v }), 140)
              },
              style: { flex: '0 1 260px', minWidth: 140, accentColor: 'var(--dsw-alias-brand-primary)' },
            }),
            h('span', { className: 'ming-note', style: { minWidth: 48, fontVariantNumeric: 'tabular-nums' } },
              (sizeDraft == null ? '—' : sizeDraft) + ' px'),
          ),
          h('div', { className: 'mg-petrow' },
            h('b', null, '模式'),
            [['companion', '陪伴（一直亮）'], ['clean', '整洁（用完就收）']].map(([k, label]) => h('button', {
              key: 'md' + k,
              className: 'mg-chip' + (s && s.cursorMode === k ? ' on' : ''),
              disabled: busy || !s,
              onClick: () => save({ cursorMode: k }),
            }, label)),
          ),
        ),
      ),

      // ---- 2. 自动开口的节奏 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '自动开口的节奏'),
          h('span', { className: 'ming-sec-n' }, sched
            ? '今天已经说了 ' + (sched.spokenToday || 0) + ' 句'
            : '读不到节奏设置'),
        ),
        h('div', { className: 'ming-sec-b' },
          sched
            ? h('div', null,
              h('div', { className: 'mg-petrow' },
                h('button', {
                  className: 'mg-btn',
                  title: '关了就完全不自己开口；点回来恢复',
                  style: sched.gapMode === 'off' ? { borderColor: '#ff6b6b', color: '#ff6b6b' } : null,
                  onClick: () => saveSched({ gapMode: sched.gapMode === 'off' ? 'heartbeat' : 'off' }),
                }, sched.gapMode === 'off' ? '关着 ✓' : '开'),
                h('button', {
                  className: 'mg-btn',
                  title: '不限次数 / 每天限几次',
                  style: sched.dailyMax < 0 ? { borderColor: '#6aa9ff', color: '#6aa9ff' } : null,
                  onClick: () => saveSched({ dailyMax: sched.dailyMax < 0 ? 6 : -1 }),
                }, sched.dailyMax < 0 ? '不限 ✓' : '限额'),
                h('span', { className: 'mg-pop-sub' }, '每日'),
                h('input', {
                  className: 'mg-input', type: 'number', min: 0, max: 999, title: sched.dailyMax < 0 ? '现在是不限；点左边「不限 ✓」切回限额' : '一天最多说几句（0 = 不说）',
                  disabled: sched.dailyMax < 0,
                  style: sched.dailyMax < 0 ? { opacity: 0.45 } : null,
                  value: sched.dailyMax < 0 ? '' : sched.dailyMax,
                  onChange: (e) => setSched((cur) => ({ ...cur, dailyMax: Number(e.target.value) })),
                  onBlur: (e) => saveSched({ dailyMax: Number(e.target.value) }),
                }),
                h('span', { className: 'mg-pop-sub' }, '次 · 间隔'),
                h('select', {
                  style: { fontSize: 12, padding: '1px 2px' },
                  value: sched.gapMode,
                  onChange: (e) => saveSched({ gapMode: e.target.value }),
                },
                  h('option', { value: 'fixed' }, '固定'),
                  h('option', { value: 'random' }, '随机'),
                  h('option', { value: 'heartbeat' }, '心跳'),
                ),
                sched.gapMode === 'heartbeat'
                  ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                    h('span', { className: 'mg-pop-sub' }, '最低'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '最短隔多久',
                      value: sched.hbMin,
                      onChange: (e) => setSched((cur) => ({ ...cur, hbMin: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ hbMin: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '中位'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '最常落在这个数上',
                      value: sched.hbCenter,
                      onChange: (e) => setSched((cur) => ({ ...cur, hbCenter: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ hbCenter: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '最高'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '最长隔多久',
                      value: sched.hbMax,
                      onChange: (e) => setSched((cur) => ({ ...cur, hbMax: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ hbMax: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '分'),
                  )
                  : h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                    h('span', { className: 'mg-pop-sub' }, '间隔'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '多少分钟一次（随机模式在这个数上浮动）',
                      value: sched.minGapMinutes,
                      onChange: (e) => setSched((cur) => ({ ...cur, minGapMinutes: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ minGapMinutes: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '分'),
                  ),
                sched.nextAt ? h('span', { className: 'mg-pop-sub', style: { whiteSpace: 'nowrap' } },
                  '下次 ≈ ' + new Date(sched.nextAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)) : null,
                h('button', { className: 'mg-btn', onClick: () => loadSched() }, '刷新'),
              ),
            )
            : h('span', { className: 'mg-pop-sub' }, '读不到节奏设置'),
        ),
      ),
      // ---- 2.5 用哪个模型（2026-11-08 她提的：桌面那只不能只能用默认模型）----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '用哪个模型'),
          h('span', { className: 'ming-sec-n' }, models
            ? (models.current.fromSettings ? '按这里选的 · 改完下一句就用新的' : '插件默认 · 还没在这里选过')
            : '读不到模型列表'),
        ),
        h('div', { className: 'ming-sec-b' },
          models
            ? h('div', null,
              h('div', { className: 'mg-petrow' },
                h('b', null, '现在'),
                h('span', { className: 'mg-pop-sub' }, models.current.provider + ' / ' + (models.current.model || '（没设）')),
                models.current.talkerRunning ? null : h('span', { className: 'mg-pop-sub' }, '· 自动开口关着，选了也不开口'),
              ),
              h('div', { className: 'mg-petrow' },
                h('select', {
                  className: 'mg-input',
                  style: { minWidth: 260, maxWidth: 420 },
                  disabled: busy,
                  value: models.current.provider + '||' + models.current.model,
                  onChange: (e) => {
                    const key = String(e.target.value || '')
                    const at = key.indexOf('||')
                    if (at < 0) return
                    save({ talkProvider: key.slice(0, at), talkModel: key.slice(at + 2) })
                  },
                },
                  h('option', { value: '' }, '插件默认（' + models.current.defaultProvider + ' / ' + (models.current.defaultModel || '未设') + '）'),
                  models.providers.map((p) => (p.models && p.models.length
                    ? h('optgroup', { key: 'p-' + p.id, label: p.name },
                      p.models.map((m) => h('option', {
                        key: p.id + '/' + m.id,
                        value: p.id + '||' + m.id,
                      }, m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id)))
                    : h('option', {
                      key: 'p-' + p.id,
                      value: p.id + '||' + models.current.model,
                      disabled: true,
                    }, p.name + (p.error ? '（列不出来）' : '（没有模型目录）')))),
                ),
                h('button', { className: 'mg-btn', disabled: busy, onClick: () => loadModels() }, '刷新'),
              ),
              h('div', { className: 'mg-petrow' },
                h('b', null, '手填'),
                h('input', {
                  className: 'mg-input',
                  style: { minWidth: 200 },
                  placeholder: '模型 id，比如 hy4-preview',
                  value: modelDraft,
                  disabled: busy,
                  onChange: (e) => setModelDraft(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter' && modelDraft.trim()) save({ talkProvider: models.current.provider, talkModel: modelDraft.trim() }) },
                }),
                h('button', {
                  className: 'mg-btn',
                  disabled: busy || !modelDraft.trim(),
                  onClick: () => save({ talkProvider: models.current.provider, talkModel: modelDraft.trim() }),
                }, '用这个'),
                h('button', { className: 'mg-btn', disabled: busy, onClick: () => { setModelDraft(''); save({ talkProvider: '', talkModel: '' }) } }, '恢复默认'),
              ),
              (models.errors && models.errors.length)
                ? h('div', { className: 'mg-pop-sub', style: { marginTop: 4 } }, models.errors.join(' · '))
                : null,
            )
            : h('span', { className: 'mg-pop-sub' }, '读不到模型列表；可以在插件配置里改 companion.model，或者稍后点刷新'),
        ),
      ),

      // ---- 3. 默认皮肤 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '默认皮肤'),
          h('span', { className: 'ming-sec-n' }, '内置十五只，只读'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { className: 'mg-skins' },
            PET_SKINS.map(([k, label]) => h('button', {
              key: 'b-' + k,
              className: 'mg-skin' + (cur === k ? ' on' : ''),
              disabled: busy || !s,
              title: label,
              onClick: () => applySkin(k),
            },
              h('img', { src: '/dsh-ming-mousepet/assets/' + k + '.png', alt: label }),
              h('span', null, label),
            )),
          ),
        ),
      ),

      // ---- 4. 我自己的皮肤 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '我自己的皮肤'),
          h('span', { className: 'ming-sec-n' }, '任意图片都行，会压成 64×64 用'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { className: 'mg-skins' },
            (skins.custom || []).map((k) => h('div', {
              key: 'c-' + k,
              className: 'mg-skinwrap' + (cur === 'custom:' + k ? ' on' : ''),
            },
              h('button', {
                className: 'mg-skin',
                disabled: busy,
                title: k,
                onClick: () => applySkin('custom:' + k),
              },
                h('img', { src: '/dsh-ming-mousepet/api/skin-image?name=' + encodeURIComponent(k), alt: k }),
                h('span', null, k),
              ),
              h('button', {
                className: 'mg-skindel',
                title: '删掉这张',
                disabled: busy,
                onClick: () => removeSkin(k),
              }, '×'),
            )),
            hasSkinApi && (skins.custom || []).length === 0
              ? h('div', { className: 'mg-pop-empty' }, '还没有。下面加一张，随便什么图都行。')
              : null,
          ),
          h('div', { className: 'mg-petrow' },
            h('input', {
              className: 'mg-input',
              placeholder: '给这张皮起个名字（字母数字，可留空）',
              value: newName,
              onChange: (e) => setNewName(e.target.value),
            }),
            h('label', { className: 'mg-btn', style: { cursor: 'pointer' } },
              busy ? '处理中…' : '选图片',
              h('input', {
                type: 'file',
                accept: 'image/*',
                style: { display: 'none' },
                disabled: busy,
                onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) upload(f); e.target.value = '' },
              }),
            ),
          ),
          note ? h('div', { className: 'ming-note' }, note) : null,
        ),
      ),


    ),
  )

}

function NeuronPanel() {
  const holder = useRef(null)
  const viewRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [view, setView] = useState('neuron')      // neuron | star
  // 2026-11-07 21:4x：一个选中态穿过三个视图（神经元的搜索 / 星图点星 / 记忆列表）。
  // selRef 是给「挂载那一刻」用的：星图 effect 的闭包里拿不到最新的 selId。
  const [selId, setSelId] = useState('')
  const selRef = useRef('')
  useEffect(() => { selRef.current = selId }, [selId])
  const [q, setQ] = useState('')
  const [ways, setWays] = useState(WAYS.slice())
  const starHost = useRef(null)
  const starRef = useRef(null)
  const [starState, setStarState] = useState('idle')   // idle | loading | ready | error
  const [starErr, setStarErr] = useState('')
  // 2026-11-07 12:30：诊断条。她说「没有图」但没给报错，我不猜了——
  // 把 HTTP 状态、拿到几个节点、mount 有没有抛错直接写在面板上。
  const [starInfo, setStarInfo] = useState('')
  const [starData, setStarData] = useState(null)

  // 2026-11-08：top 栏两件事的状态。pop 是哪个浮层开着（'' / 'skill' / 'cost'）。
  const [pop, setPop] = useState('')
  // 2026-11-08：桌宠设置（鼠标显示 / 大小 / 模式）。数据来自 dsh-ming-mousepet 的设置口。
  const [petCfg, setPetCfg] = useState(null)
  const [petBusy, setPetBusy] = useState(false)
  const [skills, setSkills] = useState(null)
  const [skillQ, setSkillQ] = useState('')
  const [skillBusy, setSkillBusy] = useState('')
  const [cost, setCost] = useState(null)
  const [costErr, setCostErr] = useState('')

  const loadSkills = useCallback((force) => {
    return fetch(API + '/skills' + (force ? '/refresh' : ''), { cache: 'no-store' })
      .then((r) => {
        // 404 不是「没装」——是宿主那半边还是旧代码（新路由要有重启才注册）。
        // 这两件事分清楚，不然她看到「读不到」只会以为又坏了。
        if (r.status === 404) throw new Error('宿主还是旧版：dsh-ming-graph 的 skills 路由还没注册，重启 DSH 就有了')
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((d) => setSkills(d && typeof d === 'object' ? d : { ok: false, error: '响应不是对象' }))
      .catch((e) => setSkills({ ok: false, error: String((e && e.message) || e) }))
  }, [])

  const loadPet = useCallback(() => {
    return fetch('/dsh-ming-mousepet/api/settings', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { setPetCfg(d && d.settings ? d.settings : null); return d })
      .catch(() => { setPetCfg(null); return null })
  }, [])

  const petSet = useCallback((patch) => {
    setPetBusy(true)
    return fetch('/dsh-ming-mousepet/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.settings) setPetCfg(d.settings); return d })
      .catch(() => null)
      .finally(() => setPetBusy(false))
  }, [])

  const petShow = useCallback((on) => {
    return fetch('/dsh-ming-mousepet/api/' + (on ? 'show' : 'hide'), { method: 'POST', cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => null)
  }, [])

  const loadCost = useCallback(() => {
    // 2026-11-08 16:1x：不再读那个插件的 getUsageSummary —— 它的账本有 token 没价
    // （价目表里没有 deepseek-v4.1-flash 这个写法），返回不出数。改成读我们自己的 /cost，
    // 价目表是 hers_workplace/live/cost-prices.json，算法在 cost-lib.mjs。
    return fetch(API + '/cost', {
      cache: 'no-store',
    })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { setCost(d || null); setCostErr(d ? '' : '账本没给数（模型/账户还没解析出来）') })
      .catch((e) => setCostErr(String((e && e.message) || e)))
  }, [])

  function toggleSkill(name, on) {
    setSkillBusy(name)
    fetch(API + '/skills/toggle?name=' + encodeURIComponent(name) + '&on=' + (on ? '1' : '0'), { method: 'POST', cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.ok) setSkills(d)
        else setSkills((s) => ({ ...(s || {}), ok: false, error: (d && d.error) || '写不进去' }))
      })
      .catch((e) => setSkills((s) => ({ ...(s || {}), ok: false, error: String((e && e.message) || e) })))
      .finally(() => setSkillBusy(''))
  }

  // 2026-11-08 15:27：切到「费用」页就拉一次，别等两分钟轮询。
  useEffect(() => { if (view === 'cost') loadCost() }, [view, loadCost])

  useEffect(() => {
    // 清单进面板就拉一次（很便宜：一次文件读 + 一次服务调用）；费用两分钟一次，
    // 比下面那条 60 秒的账本轮询低频——面板不是账单页，看个大概就够。
    loadSkills(false)
    loadCost()
    const t = setInterval(loadCost, 120000)
    return () => clearInterval(t)
  }, [])

  // force=false 走缓存；force=true 走 /neurons/refresh（Host 重读文件、重新加载 neuron.js）
  const load = useCallback((force) => {
    setBusy(true)
    const url = API + (force ? '/neurons/refresh' : '/neurons')
    return fetch(url, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        // 2026-11-07 22:1x：群号/群名从本机配置下发，不写进代码（这个仓是公开的）。
        if (d && d.roomLabels) { try { window.__MING_ROOMS = d.roomLabels } catch (e) {} }
        if (d && d.error) { setErr(String(d.error)); setStatus('error'); return }
        if (!window.__MingNeuronView) { setErr('渲染层没装上（neuron-view 未加载）'); setStatus('error'); return }
        if (viewRef.current && viewRef.current.destroy) viewRef.current.destroy()
        // 2026-11-07 22:2x：选中态穿过三个视图——神经元点一个点，切到星图/记忆能对上同一条。
        viewRef.current = window.__MingNeuronView.mount(holder.current, d, { onSelect: setSelId })
        if (selRef.current && viewRef.current.select) { try { viewRef.current.select(selRef.current) } catch (e) {} }
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

  const memRef = useRef(null)
  const [reloadTick, setReloadTick] = useState(0)
  // 2026-11-07 18:3x：星图那份 unified 是带缓存的。记忆卡刚生成、面板还显示 0 章，
  // 就是因为重挂只会再打一次 /neurons/unified（命中缓存）。点刷新要强制重建。
  const forceStar = useRef(false)

  // 导出：三个视图都出东西——神经元出图、星图出统一模型、记忆出当前列表。
  function exportJson() {
    let snap = null
    let tag = 'neurons'
    if (view === 'neuron') {
      snap = viewRef.current && viewRef.current.snapshot ? viewRef.current.snapshot() : null
    } else if (view === 'star') {
      snap = starData; tag = 'unified'
    } else if (view === 'memory') {
      snap = memRef.current; tag = 'archive'
    }
    if (!snap) return
    const blob = new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ming-' + tag + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  }

  function refreshAll() {
    setReloadTick((t) => t + 1)
    setQ('')
    if (view === 'neuron') load(true)
    if (view === 'star') forceStar.current = true
  }

  // 星图：吃同一份统一节点模型（/neurons/unified），画法在 src/star-view.js
  useEffect(() => {
    if (view !== 'star') {
      if (starRef.current && starRef.current.destroy) { starRef.current.destroy(); starRef.current = null }
      setStarState('idle')
      return
    }
    setStarState('loading')
    let alive = true
    const starUrl = API + (forceStar.current ? '/neurons/unified/refresh' : '/neurons/unified')
    forceStar.current = false
    fetch(starUrl, { cache: 'no-store' })
      .then((r) => {
        setStarInfo('HTTP ' + r.status)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((d) => {
        if (d && d.roomLabels) { try { window.__MING_ROOMS = d.roomLabels } catch (e) {} }
        if (!alive) return
        if (d && d.error) { setStarErr(String(d.error)); setStarState('error'); return }
        if (!window.__MingNeuronView) { setStarErr('渲染层没装上（neuron-view 未加载）'); setStarState('error'); return }
        const nNodes = (d.nodes || []).length
        setStarInfo(`HTTP 200 · 节点 ${nNodes} · ${d.stats && d.stats.source || ''}`)
        // 2026-11-07 15:00：不画 canvas 了，改用 DOM 版银河（src/star-view.js 重写）。
        // 这一版每个点是一个 div，画不出来只可能是「没挂上」，不可能是「画错了」。
        const SV = window.__MingStarView
        if (!SV) { setStarErr('星图渲染层没装上（star-view 未加载）'); setStarState('error'); return }
        try {
          if (starRef.current && starRef.current.destroy) starRef.current.destroy()
          starRef.current = SV.mount(starHost.current, d, { onSelect: setSelId, initialId: selRef.current })
          const st = (starRef.current.stats && starRef.current.stats()) || {}
          setStarInfo('节点 ' + nNodes + ' · 已画 ' + (st.dots || 0) + ' 点 · ' + (st.size ? st.size[0] + '×' + st.size[1] : '') + ' · ' + ((d.stats && d.stats.source) || ''))
          setStarState('ready')
        } catch (e) {
          setStarErr('挂载失败：' + String((e && e.message) || e))
          setStarState('error')
        }
      })
      .catch((e) => { if (alive) { setStarErr(String((e && e.message) || e)); setStarState('error') } })
    return () => { alive = false }
  }, [view, reloadTick])


  const when = info && info.at ? new Date(info.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''
  const meta = info
    ? `更新于 ${when} · ${info.memories} 条记忆 / ${info.edges} 条线${info.loadError ? ' · 建图代码加载失败，用的是旧模块' : ''}`
    : ''

  // 星图那一格：真的接上了（2026-11-07），数据来自 /neurons/unified，画法是 src/star-view.js。

  return h('div', { className: 'mg-mount' },
    h('style', null, PAGE_CSS + MING_UI.css('ming')),

    // ---- top 栏：全局操作 ----
    h('div', { className: 'mg-top' },
      // 2026-11-07 21:53 她定：名字用回「她的一生」，括号里挂 hers life。
      // 上一轮我起的「家底」她不要——名字是她的，我改回来，理由记在 live/星图合并 里。
      h('span', { className: 'mg-brand' }, '她的一生', h('i', null, 'hers life')),
      // tab 分两组：竖线左边是记下来的，右边是我干活用的。
      h('div', { className: 'mg-seg' },
        [['neuron', '神经元'], ['star', '星图'], ['memory', '记忆'], ['|'],
          ['browse', '自己玩'], ['interest', '兴趣'], ['voice', '声音'],
          // 2026-11-08 15:20 她：「把桌宠和费用都放到 tab 后面」
          ['pet', '桌宠'], ['cost', '费用'], ['|']]  // 2026-11-08 01:4x 她选 3：接续的 tab 从 top 栏拿掉（插件留着，插话接续照跑）
          // 2026-11-08 03:4x：桌面 tab 一起去掉。它的数据来自 /_dsh/dsh-ming-desktop，
          //   那个插件 11-08 被 mousepet 取代后停用，接口实测 404，点开是一格空的。
          .map(([k, label]) => k === '|'
            ? h('span', { key: 'sep', style: { width: 1, height: 18, background: 'var(--dsw-alias-border-secondary, rgba(150,150,170,.28))', margin: '0 4px', alignSelf: 'center' } })
            : h('button', { key: k, className: view === k ? 'on' : '', onClick: () => setView(k) }, label)),
        // 2026-11-08 15:27：费用改成独立页（view='cost'），不再是浮层。
      ),
      h('span', { className: 'mg-gap' }),
      // 2026-11-08：skill 开关（关掉的不进系统提示词，按工作区生效）
      h('button', {
        className: 'mg-btn' + (pop === 'skill' ? ' on' : ''),
        title: '按工作区开关 skill：关掉的不再进系统提示词，文件不动',
        onClick: () => { const next = pop === 'skill' ? '' : 'skill'; setPop(next); if (next) loadSkills(false) },
      }, skills && skills.total
        ? 'skill ' + (skills.total - (skills.offCount || 0)) + '/' + skills.total
        : (skills && skills.ok === false ? 'skill 读不到' : 'skill')),
    ),

    // ---- 2026-11-08 15:5x：这三个视图自己画布、没有子页头，所以壳这边给一个 ----
    // 她说的「至少要分清哪一块是哪一块」——原来这里只有一行灰色小字，跟下面的画布糊在一起。
    // 自己玩/兴趣/声音/桌宠/费用/接续各自已经有页头了，这里不重复。
    (view === 'neuron' || view === 'star' || view === 'memory')
      ? h('div', { className: 'ming-ph' },
        h('div', { className: 'ming-ph-ic' },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
            view === 'neuron'
              ? [h('circle', { key: 'a', cx: 6, cy: 7, r: 2 }), h('circle', { key: 'b', cx: 18, cy: 6, r: 2 }),
                h('circle', { key: 'c', cx: 12, cy: 17, r: 2 }), h('path', { key: 'd', d: 'M8 8l8 2M7 9l4 6M17 8l-4 7' })]
              : view === 'star'
                ? [h('path', { key: 'a', d: 'M12 3l2.2 5.6L20 10l-5.8 1.4L12 17l-2.2-5.6L4 10l5.8-1.4z' }),
                  h('path', { key: 'b', d: 'M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z' })]
                : [h('rect', { key: 'a', x: 4, y: 3, width: 16, height: 18, rx: 2 }),
                  h('path', { key: 'b', d: 'M8 7h8M8 11h8M8 15h5' })]),
        ),
        h('div', { className: 'ming-ph-tx' },
          h('div', { className: 'ming-ph-t' },
            view === 'neuron' ? '神经元' : view === 'star' ? '星图' : '记忆'),
          h('div', { className: 'ming-ph-d' },
            view === 'memory' ? '只读，点一行看正文'
              : view === 'neuron' ? (status === 'ready' ? meta : '正在读两侧记忆库…（第一次要扫一遍文件，大约两秒）')
                : (starState === 'error' ? '读不到：' + starErr
                  : starState === 'ready' ? ('统一节点模型 · ' + (starInfo || '已加载'))
                    : '正在拼统一节点模型…')),
        ),
        h('div', { className: 'ming-ph-a' },
          h('button', {
            className: 'mg-btn',
            disabled: view === 'neuron' ? status !== 'ready' : (view === 'star' ? starState !== 'ready' : false),
            onClick: exportJson,
            title: view === 'memory' ? '导出当前这份归档列表' : (view === 'star' ? '导出统一节点模型' : '把这整份图导出成 JSON'),
          }, '导出'),
          h('button', {
            className: 'mg-btn',
            disabled: busy,
            title: '重读数据源（神经元顺带重新加载建图代码）',
            onClick: refreshAll,
          }, busy ? '刷新中…' : '刷新'),
        ),
      )
      : null,

    // ---- 工具条：搜索三个视图共用（神经元过滤节点 / 星图找一颗星 / 记忆过滤列表）；
    //      关系类型只有神经元用得上。从 top 栏搬下来，免得一屏里全是控件。 ----
    (view === 'neuron' || view === 'star' || view === 'memory')
      ? h('div', { className: 'mg-tools' },
        h('input', {
          className: 'mg-input',
          placeholder: view === 'memory' ? '按 id / 标签 / 来源过滤' : (view === 'star' ? '找一颗星：标题或正文里的词' : '搜标题 / 正文里的词'),
          value: q,
          onChange: (e) => setQ(e.target.value),
        }),
        view === 'neuron'
          ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { className: 'mg-tools-l' }, '关系'),
            WAYS.map((t) => h('button', {
              key: t,
              className: 'mg-chip' + (ways.indexOf(t) >= 0 ? ' on' : ''),
              disabled: status !== 'ready',
              title: '关掉这一类边，节点不删',
              onClick: () => toggleWay(t),
            }, t)),
          )
          : null,
      )
      : null,

    // 2026-11-07 12:37：报错 `Cannot set properties of null (setting 'innerHTML')`。
    // 根因：星图那个 div 是条件渲染的，effect 跑的那一瞬 ref 还是 null，mount 里 host.innerHTML 就炸在这。
    // 改成**两个容器都常驻**、只用 display 切换：ref 从挂载起一直有效，切换时不再有「还没有节点」的空窗。
    // 记忆库（跟另外两块并列，同样靠 display 切换；切走就卸载，省得一直挂着轮询）
    h('div', { key: 'mem' + reloadTick, className: 'mg-holder', style: view === 'memory' ? null : { display: 'none' } },
      view === 'memory' ? h(MemoryView, { q, selId, onSelect: setSelId, onData: (d) => { memRef.current = d } }) : null,
    ),
    // 逛到哪儿 / 兴趣 / 声音：从各自的插件搬进来的渲染，路由还是各自的
    h('div', { key: 'browse' + reloadTick, className: 'mg-holder', style: view === 'browse' ? null : { display: 'none' } },
      view === 'browse' ? h(BrowsePanel) : null,
    ),
    h('div', { key: 'interest' + reloadTick, className: 'mg-holder', style: view === 'interest' ? null : { display: 'none' } },
      view === 'interest' ? h(InterestPanel) : null,
    ),
    h('div', { key: 'voice' + reloadTick, className: 'mg-holder', style: view === 'voice' ? null : { display: 'none' } },
      view === 'voice' ? h(VoicePanel) : null,
    ),
    // 2026-11-07 19:1x 她说「还是别合并了」：桌面和接续各留一格。
    h('div', { key: 'pet' + reloadTick, className: 'mg-holder', style: view === 'pet' ? null : { display: 'none' } },
      view === 'pet' ? h(PetPage) : null,
    ),
    // 2026-11-08 15:27 她：「费用也做成独立页而不是弹窗栏」。
    h('div', { key: 'cost' + reloadTick, className: 'mg-holder', style: view === 'cost' ? null : { display: 'none' } },
      view === 'cost' ? h(MgCostPage, { data: cost, err: costErr, onReload: loadCost }) : null,
    ),
    h('div', { key: 'resume' + reloadTick, className: 'mg-holder', style: view === 'resume' ? null : { display: 'none' } },
      view === 'resume' ? h(ResumePanel) : null,
    ),

    h('div', {
      ref: holder, className: 'mg-holder',
      style: view === 'neuron' && status === 'ready' ? null : { display: 'none' },
    }),
    // 星图：DOM 版银河（src/star-view.js），mount 到这个 ref；切走就 destroy，别让 1271 个 div 一直挂着。
    // 2026-11-07 18:1x：这个 div 里**只能有我挂的东西**。上一版把「加载中/读不到」两行字也渲染在里面，
    // star-view 挂载时 host.innerHTML='' 把它们清掉了，React 回头要删这两行 —— 它已经不在 DOM 里，
    // 于是 NotFoundError: removeChild。提示挪到外面，容器本身永远空着。
    h('div', { className: 'mg-holder', style: view === 'star' ? null : { display: 'none' } },
      starState === 'loading' ? h('div', { className: 'mg-msg' }, '正在拼统一节点模型…') : null,
      starState === 'error' ? h('div', { className: 'mg-msg err' }, '星图读不到：' + starErr) : null,
      h('div', { ref: starHost, style: { flex: 1, minHeight: '420px', display: 'flex', flexDirection: 'column' } }),
    ),

    view === 'neuron' && status === 'loading' ? h('div', { className: 'mg-msg' }, '正在读两侧记忆库…（第一次要扫一遍文件，大约两秒）') : null,
    view === 'neuron' && status === 'error' ? h('div', { className: 'mg-msg err' }, '读不到：' + err) : null,

    // 2026-11-08：两个 top 浮层。锚在 .mg-mount 上（它 position:relative），遮罩负责点外面关掉。
    pop === 'skill' ? h(MgPop, {
      key: 'pop-skill',
      title: 'skill 开关',
      sub: skills && skills.source === 'disk' ? '磁盘兜底（宿主的 skills 服务没接上）' : '',
      onClose: () => setPop(''),
    }, h(SkillsBody, {
      data: skills,
      q: skillQ,
      busy: skillBusy,
      onQ: setSkillQ,
      onReload: () => loadSkills(true),
      onToggle: toggleSkill,
    })) : null,

  )
}

return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: 'ming-graph',
    }, () => h(PanelBoundary, null, h(NeuronPanel))))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'ming-graph',
      order: 22,
      label: () => PANEL_LABEL,
    }, GraphIcon))
  },
}
