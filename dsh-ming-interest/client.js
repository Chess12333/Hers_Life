/**
 * dsh-ming-interest —— 兴趣面板（Client 半端）
 *
 * ⚠ 生成物：改 src/panel.js 或 dsh-ming-ui/src/theme.js，然后 node build.mjs
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist → 兴趣），点开占满主区域（main key = ming-interest）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-interest/state，只读。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-interest',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

// ⚠ 由 dsh-ming-ui/sync.mjs 生成，不要手改。改 C:\dsh\dsh-ming-ui\src\theme.js
/**
 * dsh-ming-ui —— 我们自己那批插件的共用皮（2026-11-07 立）
 *
 * 一条规矩：**只写 --dsw-alias-* token，不写死颜色、不写死 px 颜色值**。
 * 现在宿主是浅色，`dsh-myskin` 换主题时这些面板要跟着变；写死一个 #fff，
 * 深色底下就是一整块白。
 *
 * 为什么是这么个怪文件：各插件的 build.mjs 是「读源码文本 → 拼进 client.js」，
 * 不是真打包。所以这份源码里不能出现 import/export（拼进 CJS 工厂会炸），
 * 写成 IIFE 挂在 MING_UI 上；末尾留一句 module.exports，Node 里也能 require。
 *
 * 用法（插件里）：
 *   const MING_UI = require('./theme.js')   // 或者直接内联，同名变量已在作用域里
 *   style.textContent = MING_UI.css('ming') // 前缀用来避开宿主的同名类
 *   尺寸走 MING_UI.SCALE，颜色走 MING_UI.TOKENS.xxx
 *
 * 这一份是**唯一源**。改这里，然后 `node sync.mjs` 推到各插件的 src/theme.js。
 */
const MING_UI = (() => {
  /** 颜色：全部对到宿主的 alias token。名字按「用在哪」取，不按色值取。 */
  const TOKENS = {
    bg: 'var(--dsw-alias-bg-base)',
    surface: 'var(--dsw-alias-bg-layer-1)',
    surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
    overlay: 'var(--dsw-alias-bg-overlay)',
    border: 'var(--dsw-alias-border-l2)',
    borderSoft: 'var(--dsw-alias-border-l1)',
    borderStrong: 'var(--dsw-alias-border-l3)',
    separator: 'var(--dsw-alias-separator-secondary)',
    text: 'var(--dsw-alias-label-primary)',
    textDim: 'var(--dsw-alias-label-secondary)',
    textFaint: 'var(--dsw-alias-label-tertiary)',
    accent: 'var(--dsw-alias-brand-primary)',
    hover: 'var(--dsw-alias-interactive-bg-hover)',
    active: 'var(--dsw-alias-interactive-bg-active)',
    danger: 'var(--dsw-alias-state-error-primary)',
    warn: 'var(--dsw-alias-state-warn-primary)',
    ok: 'var(--dsw-alias-state-success-primary)',
  }

  /** 尺子：间距/圆角/字号只从这里取，别在组件里现编一个 7px。 */
  const SCALE = {
    gap: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radius: { sm: 6, md: 10, lg: 14 },
    font: { xs: 11, sm: 12, md: 13, lg: 15, xl: 18, hero: 22 },
    line: 1.55,
  }

  /**
   * 生成一份样式表。prefix 默认 ming，用来避开宿主或其他插件的同名类。
   * 面板骨架只有六个：panel / head / card / row / stat / empty。多一个算我输。
   */
  function css(prefix) {
    const p = prefix || 'ming'
    const S = SCALE
    return `
.${p}-panel {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: ${TOKENS.bg}; color: ${TOKENS.text};
  font-size: ${S.font.md}px; line-height: ${S.line};
}
.${p}-head {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.md}px ${S.gap.lg}px; border-bottom: 1px solid ${TOKENS.separator};
  flex: 0 0 auto;
}
.${p}-title { font-size: ${S.font.lg}px; font-weight: 600; color: ${TOKENS.text}; }
.${p}-sub { font-size: ${S.font.sm}px; color: ${TOKENS.textFaint}; }
.${p}-body {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: ${S.gap.lg}px; display: flex; flex-direction: column; gap: ${S.gap.md}px;
}
.${p}-card {
  background: ${TOKENS.surface}; border: 1px solid ${TOKENS.borderSoft};
  border-radius: ${S.radius.md}px; padding: ${S.gap.md}px ${S.gap.lg}px;
}
.${p}-row {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.sm}px ${S.gap.md}px; border-radius: ${S.radius.sm}px;
  border-bottom: 1px solid ${TOKENS.separator};
}
.${p}-row:last-child { border-bottom: none; }
.${p}-row:hover { background: ${TOKENS.hover}; }
.${p}-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.${p}-kpi { font-size: ${S.font.hero}px; font-weight: 600; color: ${TOKENS.text}; letter-spacing: -0.02em; }
.${p}-empty {
  margin: auto; padding: ${S.gap.xl}px; text-align: center;
  color: ${TOKENS.textFaint}; font-size: ${S.font.sm}px;
}
.${p}-pill {
  display: inline-flex; align-items: center; gap: ${S.gap.xs}px;
  padding: 1px 8px; border-radius: 999px; font-size: ${S.font.xs}px;
  background: ${TOKENS.surfaceAlt}; color: ${TOKENS.textDim};
  border: 1px solid ${TOKENS.borderSoft};
}
.${p}-pill[data-tone="ok"] { color: ${TOKENS.ok}; border-color: ${TOKENS.ok}; }
.${p}-pill[data-tone="warn"] { color: ${TOKENS.warn}; border-color: ${TOKENS.warn}; }
.${p}-pill[data-tone="danger"] { color: ${TOKENS.danger}; border-color: ${TOKENS.danger}; }
.${p}-btn {
  font: inherit; font-size: ${S.font.sm}px; cursor: pointer;
  padding: ${S.gap.xs}px ${S.gap.md}px; border-radius: ${S.radius.sm}px;
  background: ${TOKENS.surfaceAlt}; color: ${TOKENS.text};
  border: 1px solid ${TOKENS.border};
}
.${p}-btn:hover { background: ${TOKENS.hover}; }
.${p}-btn:active { background: ${TOKENS.active}; }
.${p}-btn[data-primary="1"] { background: ${TOKENS.accent}; color: #fff; border-color: transparent; }
.${p}-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.${p}-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1); border-radius: 4px; }
.${p}-scroll::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1); }
`
  }

  return { TOKENS, SCALE, css, version: '0.1.0' }
})()

if (typeof module !== 'undefined' && module.exports) module.exports = MING_UI


/**
 * dsh-ming-interest —— 兴趣面板（Client 半端源码）
 * 拼进 client.js 的 factory，能用外层的 h / React hooks。
 *
 * 2026-11-07 18:3x：从「只能看」变成「能按」——开关就是 live/interest-off 那个文件，
 * 面板只给它一个按钮；关键词还是改 live/interests.json。跳过原因拆开显示，不再是一整行字。
 */
const INTEREST_API = '/_dsh/dsh-ming-interest'

function fmtAgo(ms) {
  if (!ms || ms < 0) return '—'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function InterestPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [switching, setSwitching] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(INTEREST_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = useCallback(() => {
    setSwitching(true)
    fetch(INTEREST_API + '/toggle', { method: 'POST' })
      .then((r) => r.json())
      .then(() => load())
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setSwitching(false))
  }, [load])

  const st = (data && data.state) || {}
  const topics = (data && data.topics) || []
  const quiet = st.quiet || st.skip
  const off = !!st.off
  const tone = off ? 'danger' : quiet ? 'warn' : 'ok'
  const label = off ? '唤醒关着' : quiet ? '现在不叫' : '在线'
  // 「跳过原因」拆成几条：她要知道是哪一条卡着，不是一句日志
  const why = String(st.skip || '').split(/[；;]\s*|\s{2,}/).map((x) => x.trim()).filter(Boolean)

  return h('div', { className: 'ming-panel' },
    h('div', { className: 'ming-head' },
      h('span', { className: 'ming-title' }, '兴趣'),
      h('span', { className: 'ming-pill', 'data-tone': tone }, label),
      h('span', { className: 'ming-sub' }, busy ? '读取中…' : topics.length + ' 个话题'),
      h('button', {
        className: 'ming-btn',
        style: { marginLeft: 'auto' },
        disabled: switching,
        title: off ? '删掉 live/interest-off，恢复关键词叫醒' : '写 live/interest-off，先不叫醒',
        onClick: toggle,
      }, switching ? '切换中…' : (off ? '打开' : '关掉')),
      h('button', { className: 'ming-btn', onClick: load }, '刷新'),
    ),
    h('div', { className: 'ming-body ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,
      h('div', { className: 'ming-card', style: { display: 'flex', gap: 24 } },
        h('div', { className: 'ming-stat' },
          h('span', { className: 'ming-kpi' }, (st.wakesLastHour || 0) + '/' + (st.maxPerHour || '?')),
          h('span', { className: 'ming-sub' }, '这一小时叫醒'),
        ),
        h('div', { className: 'ming-stat' },
          h('span', { className: 'ming-kpi', style: { fontSize: 15 } }, fmtAgo(st.sinceWakeMs)),
          h('span', { className: 'ming-sub' }, '距上次'),
        ),
        h('div', { className: 'ming-stat' },
          h('span', { className: 'ming-kpi', style: { fontSize: 15 } }, st.at ? st.at.slice(5, 16).replace('T', ' ') : '—'),
          h('span', { className: 'ming-sub' }, '状态更新时间（UTC）'),
        ),
      ),

      why.length
        ? h('div', { className: 'ming-card' },
          h('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } }, '现在为什么不叫'),
          h('div', null, why.map((w, i) => h('div', { key: i, className: 'ming-sub', style: { padding: '2px 0' } }, '· ' + w))),
          off ? h('div', { className: 'ming-sub', style: { marginTop: 4 } }, '开关在 live/interest-off，点上面的「打开」就删掉它。') : null,
        )
        : null,

      h('div', null, topics.map((t, i) => h('div', { key: i, className: 'ming-row', style: { alignItems: 'flex-start', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
          h('span', { style: { fontWeight: 600 } }, t.name || '(无名)'),
          h('span', { className: 'ming-sub', style: { marginLeft: 'auto' } }, (t.keywords || []).length + ' 词'),
        ),
        h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
          (t.keywords || []).map((k, j) => h('span', { key: j, className: 'ming-pill' }, k)),
          (t.mute || []).map((k, j) => h('span', { key: 'm' + j, className: 'ming-pill', 'data-tone': 'danger', title: '出现就整条不算' }, '✕ ' + k)),
        ),
      ))),
      h('div', { className: 'ming-sub' }, '要改词就改 live/interests.json，下一轮生效。'),
    ),
  )
}

function InterestIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' }),
  )
}


    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'ming-interest',
        }, InterestPanel))
        // 2026-11-07 18:5x：侧栏图标撤了——四个面板统一进「她的一生」（dsh-ming-graph）的 tab 里。
      },
    }
  },
})
