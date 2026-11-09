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
