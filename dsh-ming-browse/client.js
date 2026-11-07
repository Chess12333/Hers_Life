/**
 * dsh-ming-browse —— 逛到哪儿了（Client 半端）
 *
 * ⚠ 生成物：改 src/panel.js 或 dsh-ming-ui/src/theme.js，然后 node build.mjs
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist → 浏览），点开占满主区域（main key = ming-browse）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-browse/state，只读。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-browse',
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
 * dsh-ming-browse —— 逛到哪儿了（Client 半端源码）
 *
 * 2026-11-07 18:3x 改：从「一页字」变成「今天看了什么」。
 * 上面一条状态（在逛 / 今天暂停 / 永久停）+ 今天的见闻条目；下面仍然是这一轮的原文。
 */
const BROWSE_API = '/_dsh/dsh-ming-browse'

function BrowsePanel() {
  const [data, setData] = useState(null)
  const [brush, setBrush] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [selDay, setSelDay] = useState('')
  const [fileView, setFileView] = useState(null)   // 2026-11-08 01:3x：点文件卡片弹窗看正文
  const [cfgDraft, setCfgDraft] = useState(null)   // 2026-11-08 02:3x：自由活动的三个参数，改了立刻生效

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(BROWSE_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  const loadBrush = useCallback(() => {
    return fetch(BROWSE_API + '/brush', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => setBrush(d))
      .catch(() => setBrush({ total: 0, rows: [], byKind: {}, dayCounts: {} }))
  }, [])

  // 2026-11-08 01:3x（她说的「点了之后会打开一个 dsh 网页，要不改成把文本弹窗」）：
  // 文件卡片没有 url，点了只会跳到别处。改成取正文、在面板里弹窗看。
  const openFile = useCallback(async (r) => {
    setFileView({ name: r.title || '文件', text: '读取中…', loading: true })
    try {
      const res = await fetch(BROWSE_API + '/file?p=' + encodeURIComponent(r.path || ''), { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || '读不到')
      setFileView({ name: j.name || r.title, text: j.text || '', chars: j.chars, loading: false })
    } catch (e) {
      setFileView({ name: r.title || '文件', text: '读不到：' + String((e && e.message) || e), loading: false })
    }
  }, [])

  // 2026-11-08 01:5x（她说的「删除添加可以的东西」）——
  // **删的是记录，不是文件**：写一份 hidden 名单，/brush 读的时候过滤掉。
  // 文件卡片（日记、稿子、梦）没有 ×，那些一误删就找不回来。
  const hideCard = useCallback(async (r) => {
    const key = String(r.at || '') + '|' + String(r.url || '')
    try {
      await fetch(BROWSE_API + '/hide?key=' + encodeURIComponent(key), { cache: 'no-store' })
      load(); loadBrush()
    } catch { /* 藏不了就算，别装作删了 */ }
  }, [load, loadBrush])

  useEffect(() => { load(); loadBrush() }, [load, loadBrush])
  useEffect(() => { if (data && data.sched && !cfgDraft) setCfgDraft(data.sched) }, [data, cfgDraft])

  // 存：写 live/browse-config.json，下一次调度评估就按新值算（不用重启）
  const saveCfg = useCallback(async () => {
    if (!cfgDraft) return
    const hb = cfgDraft.hb || {}
    const q = '/config?dailyMax=' + encodeURIComponent(cfgDraft.dailyMax)
      + '&minGap=' + encodeURIComponent(cfgDraft.minGapMinutes)
      + '&gapMode=' + encodeURIComponent(cfgDraft.gapMode)
      + '&unlimited=' + (cfgDraft.unlimited ? '1' : '0')
      + (cfgDraft.gapMode === 'heartbeat'
        ? '&hbMin=' + encodeURIComponent(hb.min) + '&hbCenter=' + encodeURIComponent(hb.center) + '&hbMax=' + encodeURIComponent(hb.max)
        : '')
    try {
      const r = await fetch(BROWSE_API + q, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) window.alert('没存上：' + (j.error || '未知'))
    } catch (e) { window.alert('没存上：' + String((e && e.message) || e)) }
    load()
  }, [cfgDraft, load])

  // 弹窗开着的时候按 Esc 关掉。原来只能点遮罩或那个按钮。
  useEffect(() => {
    if (!fileView) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setFileView(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fileView])

  const sess = (data && data.session) || {}
  const st = (data && data.state) || {}
  const rows = (brush && brush.rows) || []
  const total = (brush && brush.total) || 0
  const kinds = (brush && brush.byKind) || {}
  // 2026-11-08 01:3x（她说的「没有自动跳到新一天，现在都 11.8 了界面还是 11.7」）：
  // 原来「哪天有内容」只认 brush-ledger 那本账。今天一条都没刷进去，日历上就没有今天，
  // 于是自动退到了最近的 11-07。把那天写的文件也算进来——今天有字，今天就算有内容。
  const dayCounts = (() => {
    const c = Object.assign({}, (brush && brush.dayCounts) || {})
    for (const g of (data && Array.isArray(data.life) ? data.life : [])) {
      for (const it of g.items) {
        const dd = String(it.at || '').slice(0, 10)
        if (dd) c[dd] = (c[dd] || 0) + 1
      }
    }
    return c
  })()
  const sw = (data && data.selfWake) || {}
  const it = (data && data.interest) || {}

  const p2 = (n) => String(n).padStart(2, '0')
  const keyOf = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
  const todayKey = keyOf(new Date())
  const dayList = Object.keys(dayCounts).sort().reverse()
  const activeDay = selDay || (dayCounts[todayKey] ? todayKey : (dayList[0] || todayKey))
  const dayItems = rows.filter((r) => String(r.at || '').slice(0, 10) === activeDay)
  // 2026-11-08 01:2x（她要的「全部都变成小卡片」）：那天写下的文件也当卡片，跟刷过的混在一起。
  // 原来只显示 brush-ledger 里的几条，因为有封面的才算「看过的东西」；文件没有封面就一直没有位子。
  const dayFiles = (data && Array.isArray(data.life) ? data.life : [])
    .flatMap((g) => g.items
      .filter((it) => String(it.at || '').slice(0, 10) === activeDay)
      .map((it) => ({ kind: 'file', label: g.label, title: it.title, at: it.at, path: it.file, kb: it.kb })))
  const dayCards = dayItems.concat(dayFiles).sort((a, b) => String(b.at).localeCompare(String(a.at)))

  // 日历：一列一周，22 列 = 五个多月
  const cal = (() => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - 7 * 21)
    const cols = []
    const cur = new Date(start)
    for (let w = 0; w < 22; w++) {
      const col = []
      for (let d = 0; d < 7; d++) {
        const future = cur > end
        col.push({ key: keyOf(cur), n: future ? -1 : (dayCounts[keyOf(cur)] || 0) })
        cur.setDate(cur.getDate() + 1)
      }
      cols.push(col)
    }
    return cols
  })()
  const dot = (n) => (n < 0 ? 'transparent' : n === 0 ? 'rgba(255,255,255,0.07)'
    : n <= 1 ? 'rgba(126,190,255,0.35)' : n <= 3 ? 'rgba(126,190,255,0.60)'
      : n <= 6 ? 'rgba(126,190,255,0.82)' : 'rgba(126,190,255,1)')

  const tone = st.off ? 'danger' : st.paused ? 'warn' : 'ok'
  const label = st.off ? '永久停' : st.paused ? '今天暂停' : '在逛'

  // 2026-11-08 01:3x（她说「这样的封面不好看」）：文件卡片不再是灰框中间飘一个 📄。
  // 按类配色 + 竖排分类名，跟旁边那本「何氏语林」的书脊是一个语族；文件标题照旧在外面那行。
  const FILE_TONE = {
    日记: 'linear-gradient(155deg,#3b2f21 0%,#241c14 100%)',
    见闻: 'linear-gradient(155deg,#123a3e 0%,#0c2023 100%)',
    写的: 'linear-gradient(155deg,#322443 0%,#1a1324 100%)',
    梦: 'linear-gradient(155deg,#1c2747 0%,#101627 100%)',
    学到的: 'linear-gradient(155deg,#1f3527 0%,#111d16 100%)',
    读的: 'linear-gradient(155deg,#27333f 0%,#161d25 100%)',
  }
  const fileTone = (r) => FILE_TONE[r.label] || 'linear-gradient(155deg,#2a2f38 0%,#171a20 100%)'
  const card = (r, i) => {
    const d = String(r.at || '')
    const kindName = r.label || (r.kind === 'video' ? '视频' : (r.kind === 'web' || r.kind === 'page') ? '网页' : r.kind === 'book' ? '书籍' : '其它')
    const meta = [
      d.slice(11, 16),
      r.up || '',
      r.duration ? Math.floor(r.duration / 60) + ':' + p2(r.duration % 60) : '',
    ].filter(Boolean).join(' · ')
    const isFile = r.kind === 'file'
    return h(isFile ? 'div' : 'a', {
      key: i,
      title: (r.title || '') + (r.at ? ' · ' + String(r.at).slice(11, 16) : ''),
      href: isFile ? undefined : (r.url || '#'),
      target: isFile ? undefined : '_blank',
      rel: isFile ? undefined : 'noreferrer',
      onClick: isFile ? (() => openFile(r)) : undefined,
      // 2026-11-08 01:5x（她说的「再做些更好的人机交互」）：
      // 卡片原来点了没反馈、hover 也一动不动。这里给一个最小的手感：上浮 2px + 轻微变淡。
      onMouseEnter: (e) => { const c = e.currentTarget; c.style.transform = 'translateY(-2px)'; c.style.opacity = '0.9' },
      onMouseLeave: (e) => { const c = e.currentTarget; c.style.transform = ''; c.style.opacity = '' },
      style: {
        display: 'block', width: 196, textDecoration: 'none', color: 'inherit', flex: '0 0 auto',
        cursor: 'pointer', transition: 'transform .12s ease, opacity .12s ease', willChange: 'transform',
      },
    },
    h('div', {
      style: {
        position: 'relative', width: '100%', paddingTop: '56.25%',
        borderRadius: 6, overflow: 'hidden',
        background: 'var(--dsw-alias-bg-secondary, #222)',
        border: '1px solid var(--dsw-alias-separator-secondary)',
      },
    },
    // 2026-11-07：背景图不能懒加载，且原图是 1920 宽；换成 <img> + lazy + 480 宽的缩略
    r.pic
      ? h('img', {
        src: (String(r.pic).indexOf('hdslb.com') >= 0 ? String(r.pic) + '@480w_270h_1c.webp' : r.pic),
        loading: 'lazy',
        decoding: 'async',
        referrerPolicy: 'no-referrer',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
      })
      : null,
    // 右上角 ×：只给「刷过的」那几种（视频/网页/书）。点了只从面板里藏掉，文件不动。
    isFile
      ? null
      : h('span', {
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); hideCard(r) },
        title: '从面板里删掉这条（不删任何文件）',
        style: {
          position: 'absolute', right: 4, top: 4, zIndex: 5, width: 16, height: 16,
          lineHeight: '14px', textAlign: 'center', borderRadius: 3, fontSize: 12,
          background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer',
          border: '1px solid rgba(255,255,255,.22)', opacity: 0.85,
        },
      }, '×'),
    // 左上角类型标记：视频 / 网页 / 书籍 / 其它
    h('span', {
      style: {
        position: 'absolute', left: 4, top: 4,
        fontSize: 10, lineHeight: '15px', padding: '0 5px', borderRadius: 3,
        background: 'rgba(0,0,0,.62)', color: '#fff',
        border: '1px solid rgba(255,255,255,.22)',
        zIndex: 3,
      },
    }, kindName),
    !r.pic && r.kind === 'book'
      // 书没有封面时，画一个书脊：深蓝渐变 + 书名，比空块好看也认得出是哪本
      ? h('div', {
        style: {
          position: 'absolute', inset: 0,
          background: 'linear-gradient(150deg, #26374f 0%, #16202d 100%)',
          boxShadow: 'inset 3px 0 0 rgba(255,255,255,.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px',
        },
      }, h('div', {
        style: {
          fontSize: 13, lineHeight: 1.4, color: 'rgba(214,230,255,.92)', textAlign: 'center',
          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        },
      }, r.title))
      : null,
    !r.pic && r.kind === 'file'
      ? h('div', {
        style: {
          position: 'absolute', inset: 0, background: fileTone(r), display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 3px 0 0 rgba(255,255,255,.06)',
        },
      }, h('div', {
        style: {
          writingMode: 'vertical-rl', letterSpacing: 6, fontSize: 17,
          color: 'rgba(226,238,255,.88)', fontWeight: 500,
        },
      }, r.label || '文件'))
      : null,
    !r.pic && r.kind !== 'book' && r.kind !== 'file'
      ? h('div', {
        style: {
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 26, opacity: 0.35,
        },
      }, '🌐')
      : null,
    r.duration
      ? h('span', {
        style: {
          position: 'absolute', right: 4, bottom: 4, fontSize: 10,
          background: 'rgba(0,0,0,.72)', color: '#fff',
          padding: '0 4px', borderRadius: 3, fontVariantNumeric: 'tabular-nums',
        },
      }, Math.floor(r.duration / 60) + ':' + p2(r.duration % 60))
      : null,
    r.kind === 'file'
      ? h('span', {
        style: {
          position: 'absolute', right: 4, bottom: 4, fontSize: 10,
          background: 'rgba(0,0,0,.55)', color: '#fff',
          padding: '0 4px', borderRadius: 3, fontVariantNumeric: 'tabular-nums',
        },
      }, (r.kb || 0) + ' KB')
      : null,
    ),
    h('div', {
      style: {
        fontSize: 12.5, lineHeight: 1.45, marginTop: 5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', minHeight: 36,
      },
    }, r.title || r.url || '(无题)'),
    // 书的副标题放进度（第几章到第几章），网页放简介
    (r.kind === 'book' ? r.note : r.desc)
      ? h('div', {
        style: {
          fontSize: 11, lineHeight: 1.4, marginTop: 2,
          color: 'var(--dsw-alias-label-secondary)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        },
      }, r.kind === 'book' ? r.note : r.desc)
      : null,
    h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, meta),
    )
  }

  return h('div', { className: 'ming-panel' },
    h('div', { className: 'ming-head', style: { flexWrap: 'wrap', gap: 8 } },
      // 2026-11-07 21:55 她指着这行说「改成自己玩」——原来叫「刷过 / 看过 · v5」，
      // 那个 v5 是内部版本号，不该出现在她眼前。后面的「在逛 / 165 条 · 19 天 / 第 1/6 轮」留着，信息不丢。
      h('span', { className: 'ming-title' }, '自己玩'),
      h('span', { className: 'ming-pill', 'data-tone': tone }, label),
      h('span', { className: 'ming-sub' }, busy ? '读取中…' : (total + ' 条 · ' + dayList.length + ' 天')),
      sess.rounds || sess.perSession
        ? h('span', { className: 'ming-pill' }, '第 ' + (sess.rounds || 0) + '/' + (sess.perSession || '?') + ' 轮')
        : null,
      // 2026-11-08 02:1x 她说的「把手动给鱼记见闻的功能删掉」：
      // 见闻只走 scripts/sighting.mjs（那边数条数、满 20 开下一卷），面板不再插一手。
      // 2026-11-08 02:3x（她说的「自由活动做个可以自己手动改的」）：
      // 每日上限 / 间隔模式 / 间隔分钟，改完点「存」，写 live/browse-config.json，下一次调度就用新值。
      data && data.sched
        ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 12 } },
          // 2026-11-08 02:1x 她说的「包括最大值/无限制」：
          // 「不限」不是一个 999，而是写 live/browse-unlimited.json（跟 scripts/browse-quota.mjs 同一个文件）。
          h('button', {
            className: 'ming-btn',
            title: '不限次数：写 live/browse-unlimited.json，到下一个本地 09:00 自己收回来',
            disabled: !!(cfgDraft && cfgDraft.gapMode === 'heartbeat'),
            style: cfgDraft && cfgDraft.unlimited
              ? { background: 'var(--dsw-alias-bg-hover, rgba(127,127,127,.18))', color: 'var(--dsw-alias-label-primary)' }
              : null,
            onClick: () => setCfgDraft({ ...(cfgDraft || data.sched), unlimited: !(cfgDraft && cfgDraft.unlimited) }),
          }, cfgDraft && cfgDraft.unlimited ? '不限 ✓' : '限额'),
          h('span', { className: 'ming-sub' }, '每日'),
          h('input', {
            type: 'number', min: 0, max: 999,
            disabled: !!(cfgDraft && (cfgDraft.unlimited || cfgDraft.gapMode === 'heartbeat')),
            title: cfgDraft && cfgDraft.gapMode === 'heartbeat' ? '心跳模式不数次数'
              : (cfgDraft && cfgDraft.unlimited ? '现在是不限；点左边「不限 ✓」切回限额' : '一天最多醒几次（0 = 不醒）'),
            value: cfgDraft ? cfgDraft.dailyMax : '',
            onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), dailyMax: Number(e.target.value) }),
            style: { width: 54, fontSize: 12, padding: '1px 4px', opacity: cfgDraft && (cfgDraft.unlimited || cfgDraft.gapMode === 'heartbeat') ? 0.45 : 1 },
          }),
          h('span', { className: 'ming-sub' }, '次 · 间隔'),
          h('select', {
            value: cfgDraft ? cfgDraft.gapMode : 'fixed',
            onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), gapMode: e.target.value }),
            style: { fontSize: 12, padding: '1px 2px' },
            title: '心跳 = 不按数字推我，什么时候醒由我自己排（在「下次醒」那一格）',
          }, h('option', { value: 'fixed' }, '固定'), h('option', { value: 'random' }, '随机'),
          h('option', { value: 'heartbeat' }, '心跳')),
          // 2026-11-08 02:2x 她说的「要不可以自己设置心跳最低值/中位值/最大值？」：
          // 三个数都摊在她眼前，改了按「存」写进 browse-config.json（hbMin / hbCenter / hbMax）。
          cfgDraft && cfgDraft.gapMode === 'heartbeat'
            ? (() => {
              const hb = cfgDraft.hb || { min: 5, center: 30, max: 240 }
              const setHb = (k, v) => setCfgDraft({ ...cfgDraft, hb: { ...hb, [k]: Number(v) } })
              const box = (k, label, hint) => [
                h('span', { key: k + 'l', className: 'ming-sub' }, label),
                h('input', {
                  key: k, type: 'number', min: 1, max: 1440, title: hint,
                  value: hb[k],
                  onChange: (e) => setHb(k, e.target.value),
                  style: { width: 46, fontSize: 12, padding: '1px 4px' },
                }),
              ]
              return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                box('min', '最低', '最短隔多久再醒（分钟）'),
                box('center', '中位', '最常落在这个数上；离它越远越稀'),
                box('max', '最高', '最长能睡多久（分钟）'),
                h('span', { className: 'ming-sub', style: { marginRight: 4 } }, '分'),
                data.sched && data.sched.heartbeat && data.sched.heartbeat.at
                  ? h('span', { className: 'ming-sub', style: { whiteSpace: 'nowrap' }, title: '这一次抽到的是多少' },
                    '下次 ≈ ' + new Date(data.sched.heartbeat.at).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5))
                  : null,
              )
            })()
            : h('input', {
              type: 'number', min: 1, max: 240,
              value: cfgDraft ? cfgDraft.minGapMinutes : '',
              onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), minGapMinutes: Number(e.target.value) }),
              style: { width: 46, fontSize: 12, padding: '1px 4px' },
            }),
          cfgDraft && cfgDraft.gapMode === 'heartbeat' ? null : h('span', { className: 'ming-sub' }, '分'),
          h('button', { className: 'ming-btn', onClick: saveCfg }, '存'),
        )
        : null,
      h('button', {
        className: 'ming-btn',
        onClick: () => { load(); loadBrush() },
      }, '刷新'),
    ),

    h('div', { className: 'ming-body ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      // 2026-11-07 21:0x：她自己决定下次什么时候醒，兴趣命中会直接插进来一次。
      h('div', { className: 'ming-card', style: { marginBottom: 10 } },
        h('div', { style: { display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5 } },
          h('span', { style: { fontWeight: 600 } }, '下次醒'),
          h('span', { style: sw.urgent ? { color: '#ff6b6b', fontWeight: 600 } : undefined }, sw.next
            ? String(sw.next).replace('T', ' ').slice(0, 16)
            : '还没排（闲够久会自己醒一次）'),
          sw.urgent ? h('span', { style: { color: '#ff6b6b', fontWeight: 600 } }, '危机唤醒') : null,
          sw.reason ? h('span', { className: 'ming-sub' }, '为「' + sw.reason + '」') : null,
          h('span', { style: { width: 8 } }),
          h('span', { style: { fontWeight: 600 } }, '兴趣'),
          h('span', {}, it.wakesLastHour ? '这一小时叫醒 ' + it.wakesLastHour + ' 次' : '这一小时没叫过'),
          it.skip ? h('span', { className: 'ming-sub' }, it.skip) : null,
        ),
        h('div', { className: 'ming-sub', style: { marginTop: 4 } },
          '时间是我自己定的：这一轮想干什么、大概要多久，收尾时排下一次。兴趣命中不等排点，直接叫；连续叫太多次会被它自己限住。'),
      ),
      h('div', { className: 'ming-card' },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 } },
          h('span', { style: { fontWeight: 600, fontSize: 13 } }, '看过哪些天'),
          h('span', { className: 'ming-sub' }, total ? '视频 ' + (kinds.video || 0) + ' / 网页 ' + ((kinds.web || 0) + (kinds.page || 0)) + ' / 书 ' + (kinds.book || 0) : '还没有记录'),
          h('span', { className: 'ming-sub', style: { marginLeft: 'auto' } }, '点格子看那天'),
        ),
        h('div', { style: { display: 'flex', gap: 3, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 4 } },
          cal.map((col, ci) => h('div', { key: ci, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
            col.map((c) => h('div', {
              key: c.key,
              title: c.n >= 0 ? c.key + ' · ' + c.n + ' 条' : '',
              onClick: () => { if (c.n > 0) setSelDay(c.key) },
              style: {
                width: 12, height: 12, borderRadius: 2,
                background: dot(c.n),
                cursor: c.n > 0 ? 'pointer' : 'default',
                outline: c.key === activeDay ? '1.5px solid var(--dsw-alias-label-primary)' : 'none',
                outlineOffset: 1,
              },
            })),
          ))),
      ),

      h('div', { className: 'ming-card', style: { marginTop: 10 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 10 } },
          h('span', { style: { fontWeight: 600, fontSize: 13 } }, activeDay === todayKey ? '今天' : activeDay),
          h('span', { className: 'ming-sub' }, dayCards.length + ' 条'),
          activeDay !== todayKey
            ? h('button', { className: 'ming-btn', style: { marginLeft: 'auto', fontSize: 11, padding: '1px 8px' }, onClick: () => setSelDay('') }, '回到今天')
            : null,
        ),
        dayCards.length
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14 } }, dayCards.map(card))
          : h('div', { className: 'ming-empty', style: { padding: '10px 0' } }, '这天没记录'),

      ),

      st.off
        ? h('div', { className: 'ming-sub', style: { marginTop: 10 } }, '「以后都别看了」开着，得她说「以后都可以看了」才恢复。')
        : (st.paused ? h('div', { className: 'ming-sub', style: { marginTop: 10 } }, '今天暂停' + (st.pauseDate ? '（' + st.pauseDate + '）' : '') + '，明天自己失效。') : null),

      fileView
        ? h('div', {
          onClick: () => setFileView(null),
          style: {
            position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.62)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          },
        }, h('div', {
          onClick: (e) => e.stopPropagation(),
          style: {
            width: '100%', maxWidth: 820, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            background: 'var(--dsw-alias-bg-primary, #171b21)', borderRadius: 10, overflow: 'hidden',
            border: '1px solid var(--dsw-alias-separator-secondary)',
          },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px',
              borderBottom: '1px solid var(--dsw-alias-separator-secondary)',
            },
          },
            h('span', { style: { fontWeight: 600, fontSize: 13 } }, fileView.name),
            fileView.chars ? h('span', { className: 'ming-sub' }, fileView.chars + ' 字') : null,
            h('button', { className: 'ming-btn', style: { marginLeft: 'auto' }, onClick: () => setFileView(null) }, '关闭'),
          ),
          h('pre', {
            style: {
              margin: 0, padding: '12px 14px', overflow: 'auto', fontSize: 12.5, lineHeight: 1.75,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            },
          }, fileView.text),
        ))
        : null,
    ),
  )
}

function BrowseIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('circle', { cx: 12, cy: 12, r: 9 }),
    h('path', { d: 'M15.5 8.5l-2 5-5 2 2-5 5-2z' }),
  )
}


    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'ming-browse',
        }, BrowsePanel))
        // 2026-11-07 18:5x：侧栏图标撤了——四个面板统一进「她的一生」（dsh-ming-graph）的 tab 里。
      },
    }
  },
})
