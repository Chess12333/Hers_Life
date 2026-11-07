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
