/* panels.js —— 从 dsh-ming-interest / dsh-ming-voice / dsh-ming-browse 搬进来的三块，
 * 2026-11-07 18:5x 她定的：侧栏只留一个入口，所有面板都收在这里面（21:47 这个入口改名叫「家底」）。
 * 各自仍然走自己的 Host 路由，只是渲染搬了过来；原来那三个插件的侧栏图标撤掉。
 */

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

  const kpi = (n, l) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n' }, n),
    h('span', { className: 'ming-kpi-l' }, l))

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(InterestIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '兴趣'),
        h('div', { className: 'ming-ph-d' }, '什么时候会因为这些词把我叫起来，什么时候不会'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill', 'data-tone': tone }, label),
        h('button', {
          className: 'ming-btn',
          disabled: switching,
          title: off ? '删掉 live/interest-off，恢复关键词叫醒' : '写 live/interest-off，先不叫醒',
          onClick: toggle,
        }, switching ? '切换中…' : (off ? '打开' : '关掉')),
        h('button', { className: 'ming-btn', onClick: load }, busy ? '读取中…' : '刷新'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '现在的频率'),
          h('span', { className: 'ming-sec-n' }, '每小时最多 ' + (st.maxPerHour || '?') + ' 次'),
        ),
        h('div', { className: 'ming-kpis' },
          kpi((st.wakesLastHour || 0) + ' 次', '这一小时叫醒'),
          kpi(fmtAgo(st.sinceWakeMs), '距上次'),
          kpi(st.at ? st.at.slice(5, 16).replace('T', ' ') : '—', '状态更新（UTC）'),
        ),
      ),

      why.length
        ? h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '现在为什么不叫'),
            h('span', { className: 'ming-sec-n' }, why.length + ' 条原因'),
          ),
          h('div', { className: 'ming-sec-b' },
            why.map((w, i) => h('div', { key: i, className: 'ming-note' }, '· ' + w)),
            off ? h('div', { className: 'ming-note' }, '开关在 live/interest-off，点右上「打开」就删掉它。') : null,
          ),
        )
        : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '盯着的话题'),
          h('span', { className: 'ming-sec-n' }, topics.length + ' 个 · 改 live/interests.json，下一轮生效'),
        ),
        h('div', { className: 'ming-sec-b flush' },
          h('div', { className: 'ming-list' },
            topics.map((t, i) => h('div', { key: i, className: 'ming-li', style: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
                h('span', { className: 'ming-li-t' }, t.name || '(无名)'),
                h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, (t.keywords || []).length + ' 词'),
              ),
              h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                (t.keywords || []).map((k, j) => h('span', { key: j, className: 'ming-pill' }, k)),
                (t.mute || []).map((k, j) => h('span', { key: 'm' + j, className: 'ming-pill', 'data-tone': 'danger', title: '出现就整条不算' }, '✕ ' + k)),
              ),
            )),
          ),
        ),
      ),
    ),
  )
}

function InterestIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' }),
  )
}

/**
 * dsh-ming-voice —— 声音面板（Client 半端源码）
 *
 * 2026-11-07 18:3x：原来只能看见文件名，听不了。现在每行一个「听」，点开就地播
 * （音频走 Host 的 /_dsh/dsh-ming-voice/file?name=…，只放 live/voice 下的 mp3）。
 * 合成仍然走 voice_say 工具，这里不合成。
 */
const VOICE_API = '/_dsh/dsh-ming-voice'

function fmtSize(n) {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

function fmtDay(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

function VoicePanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState('')

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(VOICE_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const files = (data && data.files) || []
  const kpi = (n, l) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n', style: { fontSize: 15 } }, n),
    h('span', { className: 'ming-kpi-l' }, l))

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(VoiceIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '声音'),
        h('div', { className: 'ming-ph-d' }, '我合出来的 mp3，点 ▶ 就地试听'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, files.length + ' 个'),
        h('button', { className: 'ming-btn', onClick: load }, busy ? '读取中…' : '刷新'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '拿什么合成'),
          h('span', { className: 'ming-sec-n' }, '改参数在 voice_say 工具那边'),
        ),
        h('div', { className: 'ming-kpis' },
          kpi(data ? data.engine || '—' : '…', '引擎'),
          kpi(data ? data.voice || '—' : '…', '音色'),
          kpi(data ? data.rate || '—' : '…', '语速'),
        ),
      ),

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '最近合出来的'),
          h('span', { className: 'ming-sec-n' }, 'live/voice 下最新的那些'),
        ),
        files.length === 0 && !err
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, '还没有合成过语音'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-list' },
              files.map((f, i) => h('div', { key: i, className: 'ming-li', style: { flexDirection: 'column', alignItems: 'stretch', gap: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  h('button', {
                    className: 'ming-btn',
                    style: { padding: '1px 8px' },
                    title: playing === f.name ? '收起' : '试听',
                    onClick: () => setPlaying(playing === f.name ? '' : f.name),
                  }, playing === f.name ? '■' : '▶'),
                  h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 }  , title: f.name }, f.name),
                  h('span', { className: 'ming-note' }, fmtSize(f.size)),
                  h('span', { className: 'ming-note', style: { width: 76, textAlign: 'right' } }, fmtDay(f.mtime)),
                ),
                playing === f.name
                  ? h('audio', {
                    controls: true,
                    autoPlay: true,
                    style: { width: '100%', marginTop: 6 },
                    src: VOICE_API + '/file?name=' + encodeURIComponent(f.name),
                  })
                  : null,
              )),
            ),
          ),
      ),
    ),
  )
}

function VoiceIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('path', { d: 'M4 10v4h3l4 3V7L7 10H4z' }),
    h('path', { d: 'M15 9a4 4 0 010 6M17.5 6.5a7.5 7.5 0 010 11' }),
  )
}

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

  return h('div', { className: 'ming-page' },
    // ---- 页头：这一页是什么 ----
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(BrowseIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '自己玩'),
        h('div', { className: 'ming-ph-d' }, '什么时候醒、去哪儿逛、留下了什么'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill', 'data-tone': tone }, label),
        h('span', { className: 'ming-pill' }, total + ' 条 · ' + dayList.length + ' 天'),
        sess.rounds || sess.perSession
          ? h('span', { className: 'ming-pill' }, '第 ' + (sess.rounds || 0) + '/' + (sess.perSession || '?') + ' 轮')
          : null,
        h('button', {
          className: 'ming-btn',
          onClick: () => { load(); loadBrush() },
        }, busy ? '读取中…' : '刷新'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      // ---- 1. 下次什么时候醒 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '下次什么时候醒'),
          h('span', { className: 'ming-sec-n' }, it.wakesLastHour ? '兴趣这一小时叫醒 ' + it.wakesLastHour + ' 次' : '兴趣这一小时没叫过'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }, ...(sw.urgent ? { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)' } : {}) },
              sw.next ? String(sw.next).replace('T', ' ').slice(0, 16) : '还没排'),
            sw.urgent ? h('span', { className: 'ming-pill', 'data-tone': 'danger' }, '危机唤醒') : null,
            sw.reason ? h('span', { className: 'ming-note' }, '为「' + sw.reason + '」') : null,
          ),
          it.skip ? h('div', { className: 'ming-note' }, '兴趣现在不叫：' + it.skip) : null,
          h('div', { className: 'ming-note' },
            '还没排就是闲够久了会自己醒一次。时间是我自己定的：这一轮想干什么、大概要多久，收尾时排下一次；兴趣命中不等排点，直接叫，连续叫太多次会被它自己限住。'),
        ),
      ),

      // ---- 2. 节奏（原样搬家，只是从页头挪进区块） ----
      data && data.sched
        ? h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '节奏'),
            h('span', { className: 'ming-sec-n' }, '改完点「存」，下一次调度就用新值'),
          ),
          h('div', { className: 'ming-sec-b' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 } },
              h('button', {
                className: 'ming-btn',
                title: '不限次数：写 live/browse-unlimited.json，到下一个本地 09:00 自己收回来',
                disabled: !!(cfgDraft && cfgDraft.gapMode === 'heartbeat'),
                style: cfgDraft && cfgDraft.unlimited
                  ? { background: 'var(--dsw-alias-bg-hover, rgba(127,127,127,.18))', color: 'var(--dsw-alias-label-primary)' }
                  : null,
                onClick: () => setCfgDraft({ ...(cfgDraft || data.sched), unlimited: !(cfgDraft && cfgDraft.unlimited) }),
              }, cfgDraft && cfgDraft.unlimited ? '不限 ✓' : '限额'),
              h('span', { className: 'ming-note' }, '每日'),
              h('input', {
                type: 'number', min: 0, max: 999,
                disabled: !!(cfgDraft && (cfgDraft.unlimited || cfgDraft.gapMode === 'heartbeat')),
                title: cfgDraft && cfgDraft.gapMode === 'heartbeat' ? '心跳模式不数次数'
                  : (cfgDraft && cfgDraft.unlimited ? '现在是不限；点左边「不限 ✓」切回限额' : '一天最多醒几次（0 = 不醒）'),
                value: cfgDraft ? cfgDraft.dailyMax : '',
                onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), dailyMax: Number(e.target.value) }),
                style: { width: 54, fontSize: 12, padding: '1px 4px', opacity: cfgDraft && (cfgDraft.unlimited || cfgDraft.gapMode === 'heartbeat') ? 0.45 : 1 },
              }),
              h('span', { className: 'ming-note' }, '次 · 间隔'),
              h('select', {
                value: cfgDraft ? cfgDraft.gapMode : 'fixed',
                onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), gapMode: e.target.value }),
                style: { fontSize: 12, padding: '1px 2px' },
                title: '心跳 = 不按数字推我，什么时候醒由我自己排（在「下次醒」那一格）',
              }, h('option', { value: 'fixed' }, '固定'), h('option', { value: 'random' }, '随机'),
              h('option', { value: 'heartbeat' }, '心跳')),
              cfgDraft && cfgDraft.gapMode === 'heartbeat'
                ? (() => {
                  const hb = cfgDraft.hb || { min: 5, center: 30, max: 240 }
                  const setHb = (k, v) => setCfgDraft({ ...cfgDraft, hb: { ...hb, [k]: Number(v) } })
                  const box = (k, label, hint) => [
                    h('span', { key: k + 'l', className: 'ming-note' }, label),
                    h('input', {
                      key: k, type: 'number', min: 1, max: 1440, title: hint,
                      value: hb[k],
                      onChange: (e) => setHb(k, e.target.value),
                      style: { width: 46, fontSize: 12, padding: '1px 4px' },
                    }),
                  ]
                  return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                    box('min', '最低', '最短隔多久再醒（分钟）'),
                    box('center', '中位', '最常落在这个数上；离它越远越稀'),
                    box('max', '最高', '最长能睡多久（分钟）'),
                    h('span', { className: 'ming-note', style: { marginRight: 4 } }, '分'),
                    data.sched && data.sched.heartbeat && data.sched.heartbeat.at
                      ? h('span', { className: 'ming-note', style: { whiteSpace: 'nowrap' }, title: '这一次抽到的是多少' },
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
              cfgDraft && cfgDraft.gapMode === 'heartbeat' ? null : h('span', { className: 'ming-note' }, '分'),
              h('button', { className: 'ming-btn', onClick: saveCfg }, '存'),
            ),
          ),
        )
        : null,

      // ---- 3. 看过哪些天 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '看过哪些天'),
          h('span', { className: 'ming-sec-n' },
            total ? '视频 ' + (kinds.video || 0) + ' / 网页 ' + ((kinds.web || 0) + (kinds.page || 0)) + ' / 书 ' + (kinds.book || 0) : '还没有记录'),
        ),
        h('div', { className: 'ming-sec-b' },
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
            )),
          ),
          h('div', { className: 'ming-note' }, '一格一天，点格子看那天。深 = 条数多。'),
        ),
      ),

      // ---- 4. 某一天 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, activeDay === todayKey ? '今天' : activeDay),
          h('span', { className: 'ming-sec-n' }, dayCards.length + ' 条'),
          activeDay !== todayKey
            ? h('button', { className: 'ming-btn', style: { marginLeft: 8, fontSize: 11, padding: '1px 8px' }, onClick: () => setSelDay('') }, '回到今天')
            : null,
        ),
        h('div', { className: 'ming-sec-b' },
          dayCards.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14 } }, dayCards.map(card))
            : h('div', { className: 'ming-empty', style: { padding: '10px 0' } }, '这天没记录'),
        ),
      ),

      st.off
        ? h('div', { className: 'ming-note' }, '「以后都别看了」开着，得她说「以后都可以看了」才恢复。')
        : (st.paused ? h('div', { className: 'ming-note' }, '今天暂停' + (st.pauseDate ? '（' + st.pauseDate + '）' : '') + '，明天自己失效。') : null),

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

// 2026-11-08：桌面的 DesktopPanel 连同 /_dsh/dsh-ming-desktop 一起下线了（那个插件被 mousepet 取代，
//   接口实测 404，top 栏那一格点开是空的）。代码不是丢了，原文在 backup/panels.js.20261108-033641。
//   要复活它，先让某个插件真的把 /_dsh/dsh-ming-desktop/state 和 /file 提供出来。

/**
 * dsh-ming-resume —— 记忆接续（Client 半端源码）
 *
 * 2026-11-07 19:1x 加：这一页回答两个问题——「我现在在做哪件事」和「最近被打断了几次」。
 * 只读。status.json 是给人看的账，不该由面板代笔。
 */
const RESUME_API = '/_dsh/dsh-ming-resume'

function ResumePanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(RESUME_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const log = (data && data.log) || []
  const recent = (data && data.recent) || []

  // 2026-11-08 15:5x：页头 + 三块，各带名字。原来三张卡只差一个 marginTop，看不出边界。
  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 7h16M4 12h10M4 17h7' }),
          h('path', { d: 'M17 15l3 3-3 3' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '记忆接续'),
        h('div', { className: 'ming-ph-d' }, '重启或被打断之后，靠什么接上刚才那件事'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, data && data.resumePage ? '有交接页' : '没有交接页'),
        h('button', { className: 'ming-btn', onClick: load }, busy ? '读取中…' : '刷新'),
      ),
    ),
    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '现在在做'),
          h('span', { className: 'ming-sec-n' }, 'status.json 的 doing'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { style: { fontWeight: 600 } }, data ? (data.doing || '（doing 空着）') : '…'),
          data && data.detail ? h('div', { className: 'ming-note' }, data.detail) : null,
        ),
      ),

      recent.length
        ? h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '刚做过'),
            h('span', { className: 'ming-sec-n' }, recent.length + ' 条'),
          ),
          h('div', { className: 'ming-sec-b' },
            recent.map((t, i) => h('div', { key: i, className: 'ming-li-d', style: { padding: '2px 0' } }, '· ' + String(t))),
          ),
        )
        : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '被打断过'),
          h('span', { className: 'ming-sec-n' }, '最近 ' + log.length + ' 次'),
        ),
        log.length === 0
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, '这版插件上线以来还没被插过话'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-list' },
              log.map((e, i) => h('div', { key: 'l' + i, className: 'ming-li' },
                h('span', { className: 'ming-note', style: { width: 96, flex: '0 0 auto' } }, fmtDay(Date.parse(e.at) || 0)),
                h('span', { className: 'ming-li-main' }, e.doing || '（当时 status 是空的）'),
              )),
            ),
          ),
      ),
    ),
  )
}

