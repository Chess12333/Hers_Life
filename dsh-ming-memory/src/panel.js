/**
 * dsh-ming-memory —— 记忆库面板（Client 半端源码）
 *
 * 这一段会被 build.mjs 拼进 client.js 的 factory 里，所以能直接用外层的
 * h / React / useState 这些，不需要自己 import。
 *
 * 只读：列归档记忆、按关键词过滤、点开看正文。
 * 数据来自 Host 半端 /_dsh/dsh-ming-memory/{list,read}，不经过模型。
 *
 * 2026-11-08 15:5x：整页重排——页头 + 一条搜索 + 一个「归档」区块。
 * 原来是标题、条数、搜索框、刷新全挤在一行，下面直接是一长条没有边界的行。
 */
const MEMORY_API = '/_dsh/dsh-ming-memory'

function useMemoryStyle() {
  useEffect(() => {
    const id = 'ming-memory-style'
    if (document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = MING_UI.css('ming') + `
.ming-mem-list { display: flex; flex-direction: column; }
.ming-mem-item { cursor: pointer; }
.ming-mem-item[data-active="1"] { background: var(--dsw-alias-interactive-bg-active); }
.ming-mem-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ming-mem-body { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.7; }
.ming-mem-input { flex: 1 1 auto; width: 100%; font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); box-sizing: border-box; }
`
    document.head.appendChild(el)
  }, [])
}

function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function MemoryPanel() {
  useMemoryStyle()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [openFile, setOpenFile] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(MEMORY_API + '/list', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.error) { setErr(String(d.error)); return }
        setItems(Array.isArray(d.items) ? d.items : [])
        setTotal(d.total || 0)
      })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const readOne = useCallback((file) => {
    setOpenFile(file)
    setBody('')
    fetch(MEMORY_API + '/read?f=' + encodeURIComponent(file), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.error) setBody('△ ' + d.error); else setBody(d.body || '') })
      .catch((e) => setBody('△ ' + String((e && e.message) || e)))
  }, [])

  const kw = q.trim().toLowerCase()
  const shown = kw
    ? items.filter((it) => (it.id + ' ' + it.tags + ' ' + it.source).toLowerCase().includes(kw))
    : items

  if (openFile) {
    const it = items.find((x) => x.file === openFile) || {}
    return h('div', { className: 'ming-page' },
      h('div', { className: 'ming-ph' },
        h('button', { className: 'ming-btn', onClick: () => { setOpenFile(''); setBody('') } }, '← 返回'),
        h('div', { className: 'ming-ph-tx' },
          h('div', { className: 'ming-ph-t' }, it.id || openFile),
          h('div', { className: 'ming-ph-d' },
            [it.status ? '状态 ' + it.status : '', it.source ? '来源 ' + it.source : '', fmtTime(it.mtime)]
              .filter(Boolean).join(' · ')),
        ),
      ),
      h('div', { className: 'ming-wrap ming-scroll' },
        h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '正文'),
            h('span', { className: 'ming-sec-n' }, openFile),
          ),
          h('div', { className: 'ming-sec-b ming-mem-body' }, body || '…'),
        ),
      ),
    )
  }

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(MemoryIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '记忆库'),
        h('div', { className: 'ming-ph-d' }, '跨会话存下来的归档记忆，只读；点一行看正文'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, busy ? '读取中…' : total + ' 条'),
        h('button', { className: 'ming-btn', onClick: load }, '刷新'),
      ),
    ),

    // 搜索单独一行：跟条数、刷新挤在一起的时候，没人看得出这是个输入框
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--dsw-alias-separator-secondary)' } },
      h('input', {
        className: 'ming-mem-input',
        placeholder: '按 id / 标签 / 来源过滤',
        value: q,
        onChange: (e) => setQ(e.target.value),
      }),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '归档'),
          h('span', { className: 'ming-sec-n' }, shown.length + ' 条' + (kw ? '（筛过的）' : '')),
        ),
        (!err && !shown.length)
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, busy ? '…' : '没有匹配的记忆'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-mem-list ming-list' },
              shown.map((it) => h('div', {
                key: it.file,
                className: 'ming-li ming-mem-item',
                onClick: () => readOne(it.file),
                title: it.id,
              },
                h('span', { className: 'ming-mem-name', style: it.deleted ? { opacity: 0.5 } : null }, it.id),
                it.status ? h('span', { className: 'ming-pill', 'data-tone': it.status === 'active' ? 'ok' : undefined }, it.status) : null,
                it.deleted ? h('span', { className: 'ming-pill', 'data-tone': 'danger' }, '已删') : null,
                h('span', { className: 'ming-note' }, fmtTime(it.mtime)),
              )),
            ),
          ),
      ),
    ),
  )
}

function MemoryIcon() {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }),
    h('path', { d: 'M8 7h8M8 11h8M8 15h5' }),
  )
}
