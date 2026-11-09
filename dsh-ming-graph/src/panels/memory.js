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
