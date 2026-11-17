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
