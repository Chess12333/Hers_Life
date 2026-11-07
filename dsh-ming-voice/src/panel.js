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

  return h('div', { className: 'ming-panel' },
    h('div', { className: 'ming-head' },
      h('span', { className: 'ming-title' }, '声音'),
      h('span', { className: 'ming-sub' }, busy ? '读取中…' : files.length + ' 个最近文件'),
      h('button', { className: 'ming-btn', style: { marginLeft: 'auto' }, onClick: load }, '刷新'),
    ),
    h('div', { className: 'ming-body ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,
      h('div', { className: 'ming-card', style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        h('span', { className: 'ming-pill' }, '引擎 ' + (data ? data.engine || '—' : '…')),
        h('span', { className: 'ming-pill' }, '音色 ' + (data ? data.voice || '—' : '…')),
        h('span', { className: 'ming-pill' }, '语速 ' + (data ? data.rate || '—' : '…')),
      ),
      files.length === 0 && !err
        ? h('div', { className: 'ming-empty' }, '还没有合成过语音')
        : h('div', null, files.map((f, i) => h('div', { key: i, style: { padding: '4px 0', borderBottom: '1px solid var(--dsw-alias-separator-secondary)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('button', {
              className: 'ming-btn',
              style: { padding: '1px 8px' },
              title: playing === f.name ? '收起' : '试听',
              onClick: () => setPlaying(playing === f.name ? '' : f.name),
            }, playing === f.name ? '■' : '▶'),
            h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: f.name }, f.name),
            h('span', { className: 'ming-sub' }, fmtSize(f.size)),
            h('span', { className: 'ming-sub', style: { width: 76, textAlign: 'right' } }, fmtDay(f.mtime)),
          ),
          playing === f.name
            ? h('audio', {
              controls: true,
              autoPlay: true,
              style: { width: '100%', marginTop: 4 },
              src: VOICE_API + '/file?name=' + encodeURIComponent(f.name),
            })
            : null,
        ))),
    ),
  )
}

function VoiceIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('path', { d: 'M4 10v4h3l4 3V7L7 10H4z' }),
    h('path', { d: 'M15 9a4 4 0 010 6M17.5 6.5a7.5 7.5 0 010 11' }),
  )
}
