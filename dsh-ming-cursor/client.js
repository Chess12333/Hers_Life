// dsh-ming-cursor 的设置页：一只光标，加上它什么时候在、怎么说话。
//
// 挂在哪里（2026-11-10 她定的）：装了 dsh-ming-graph（「她的一生」）→ 挂进它的顶栏；
// 没装 → 自己注册一个 settings.section。两边都不硬依赖对方。
window.__ModuleLoader__.load({
  id: 'dsh-ming-cursor',
  factory(require) {
    const React = require('react')
    const { useEffect, useState, useCallback } = React
    const h = React.createElement

    const API = '/dsh-ming-cursor/api'
    const ASSET = '/dsh-ming-cursor/assets/cursors'

    const C = {
      text: 'var(--dsw-alias-label-primary, #e8e8ee)',
      sub: 'var(--dsw-alias-label-secondary, #b8b8c4)',
      faint: 'var(--dsw-alias-label-tertiary, #8d8d9c)',
      border: 'var(--dsw-alias-border-primary, rgba(255,255,255,.12))',
      bg: 'var(--dsw-alias-bg-secondary, #191920)',
      input: 'var(--dsw-alias-bg-primary, #101016)',
      accent: 'var(--dsw-alias-brand-primary, #6aa9ff)',
      danger: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
      ok: 'var(--dsw-alias-state-success-primary, #59d18b)',
      warn: '#d9a441',
    }

    const S = {
      page: { maxWidth: '820px', color: C.text },
      card: { border: `1px solid ${C.border}`, borderRadius: '12px', padding: '16px', background: C.bg, marginBottom: '12px' },
      title: { fontSize: '13px', fontWeight: 700, marginBottom: '4px' },
      hint: { fontSize: '11.5px', color: C.faint, lineHeight: '1.7' },
      row: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' },
      modeBtn: (on) => ({
        border: `1px solid ${on ? C.accent : C.border}`,
        background: on ? C.accent : 'transparent',
        color: on ? '#08111f' : C.text,
        borderRadius: '8px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: on ? 700 : 400,
      }),
      btn: { border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: '8px', padding: '7px 12px', fontSize: '12px', cursor: 'pointer' },
      primary: { border: `1px solid ${C.accent}`, background: C.accent, color: '#08111f', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 700 },
      num: { width: '88px', background: C.input, color: C.text, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 8px', fontSize: '12px' },
      range: { flex: '1 1 200px', minWidth: '120px', accentColor: C.accent, cursor: 'pointer' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px', marginTop: '10px' },
      cell: (on) => ({
        border: `1px solid ${on ? C.accent : C.border}`,
        background: on ? 'rgba(106,169,255,.12)' : 'transparent',
        borderRadius: '10px', padding: '10px 6px', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
      }),
      sprite: (px) => ({
        width: px + 'px', height: px + 'px', display: 'block', imageRendering: 'pixelated',
        backgroundImage: '', backgroundSize: '800% 300%', backgroundPosition: '0 0',
      }),
      cellName: { fontSize: '11px', color: C.sub },
      previewBox: {
        width: '104px', height: '104px', borderRadius: '14px', border: `1px solid ${C.border}`,
        background: '#0d0d13', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 104px',
      },
      preview: { display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' },
      stateLine: { fontSize: '11.5px', color: C.faint, lineHeight: '1.7' },
      note: { fontSize: '11.5px', color: C.ok, minHeight: '16px', lineHeight: '1.6' },
      error: { fontSize: '11.5px', color: C.danger, minHeight: '16px', lineHeight: '1.6' },
      banner: {
        border: `1px solid ${C.warn}`, background: 'rgba(217,164,65,.10)',
        borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
        fontSize: '11.5px', color: C.sub, lineHeight: '1.7',
      },
    }

    const STYLES = [
      ['pointer', '指针'], ['link', '链接'], ['text', '文本'], ['cross', '十字'], ['help', '帮助'],
      ['move', '移动'], ['vert', '上下'], ['horz', '左右'], ['dgn1', '斜向1'], ['dgn2', '斜向2'],
      ['unavailiable', '禁止'], ['busy', '忙碌'], ['work', '工作'], ['handwriting', '手写'], ['alternate', '备用'],
    ]
    const STYLE_LABEL = {}
    STYLES.forEach(([id, label]) => { STYLE_LABEL[id] = label })

    // 素材是 8 列 × 3 行的雪碧图：只取左上那一格（整张缩到 32px 就是一团糊）
    function sprite(x, px) {
      return Object.assign({}, S.sprite(px), {
        backgroundImage: 'url(' + ASSET + '/' + x + '.png)',
      })
    }

    function CursorPage() {
      const [cfg, setCfg] = useState({ mode: 'companion', holdMs: 2600, size: 64, style: 'pointer' })
      const [conflict, setConflict] = useState(false)

      // 完整版的陪伴设置：节奏 / 模型 / 晃动识别。桌宠页拿掉了，这些搬到这里（2026-11-10）。
      const [sched, setSched] = useState(null)
      const [models, setModels] = useState(null)
      const [shake, setShake] = useState(null)
      const [petNote, setPetNote] = useState('')

      const loadPet = useCallback(() => {
        fetch('/dsh-ming-mousepet/api/schedule', { cache: 'no-store' }).then((r) => r.json()).then((d) => setSched(d && d.ok ? d : null)).catch(() => setSched(null))
        fetch('/dsh-ming-mousepet/api/models', { cache: 'no-store' }).then((r) => r.json()).then((d) => setModels(d && d.ok ? d : null)).catch(() => setModels(null))
        fetch('/dsh-ming-mousepet/api/shake', { cache: 'no-store' }).then((r) => r.json()).then((d) => setShake(d && d.ok ? d.shake : null)).catch(() => setShake(null))
      }, [])
      useEffect(() => { if (conflict) loadPet() }, [conflict, loadPet])

      const saveSched = useCallback((patch) => {
        setSched((cur) => (cur ? Object.assign({}, cur, patch) : cur))
        setPetNote('')
        return fetch('/dsh-ming-mousepet/api/schedule', {
          method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify(patch),
        })
          .then((r) => r.json())
          .then((d) => { if (d && d.ok) { setSched(d); setPetNote('存好了') } else setPetNote('没存上') })
          .catch(() => setPetNote('没存上'))
      }, [])

      const saveShake = useCallback((patch) => {
        setShake((cur) => Object.assign({}, cur || {}, patch))
        return fetch('/dsh-ming-mousepet/api/shake', {
          method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify(patch),
        })
          .then((r) => r.json()).then((d) => { if (d && d.ok) setShake(d.shake) }).catch(() => null)
      }, [])
      const [loaded, setLoaded] = useState(false)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const [error, setError] = useState('')
      const [live, setLive] = useState('')

      const reload = useCallback(() => {
        fetch(API + '/settings', { cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok && d.settings) { setCfg(d.settings); setConflict(!!d.conflict); setLoaded(true) }
            else setError('设置读不到：' + JSON.stringify(d).slice(0, 120))
          })
          .catch((e) => setError('设置读不到：' + (e && e.message ? e.message : e)))
      }, [])

      useEffect(() => { reload() }, [reload])

      const save = useCallback(async (patch) => {
        setBusy(true); setNote(''); setError('')
        try {
          const body = Object.assign({}, cfg, patch || {})
          const r = await fetch(API + '/settings', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          })
          const d = await r.json()
          if (d && d.ok) { setCfg(d.settings); setNote('存好了') }
          else setError('没存上：' + JSON.stringify(d).slice(0, 160))
        } catch (e) { setError('没存上：' + (e && e.message ? e.message : e)) }
        finally { setBusy(false) }
      }, [cfg])

      // 「试一下」：让它真画到屏幕上，再把位置报回来——不是为了好看，是证明链路通。
      const tryIt = useCallback(async () => {
        setNote(''); setError(''); setLive('正在叫光标…')
        try {
          const r = await fetch(API + '/demo', { method: 'POST', cache: 'no-store' })
          const d = await r.json()
          if (d && d.ok && d.state) {
            setLive(d.state.visible ? ('出来了：(' + d.state.x + ', ' + d.state.y + ') · ' + d.state.size + 'px') : '没出来（sidecar 没连上）')
          } else setLive((d && d.error) || '没叫出来')
        } catch (e) { setError('连不上：' + (e && e.message ? e.message : e)) }
      }, [])

      if (!loaded && !error) return h('div', { style: S.page }, h('div', { style: S.hint }, '正在读光标设置…'))

      return h('div', { style: S.page },
        conflict ? h('div', { style: S.banner },
          '检测到完整版（dsh-ming-mousepet）。一个屏幕只该有一只光标在画——那个自带光标、气泡和桌宠，请停用本插件。') : null,

        // —— 一眼看到它现在是什么样
        h('div', { style: S.card },
          h('div', { style: S.preview },
            h('div', { style: S.previewBox }, h('span', { style: sprite(cfg.style, 72) })),
            h('div', { style: { flex: '1 1 300px', minWidth: 0 } },
              h('div', { style: S.title }, STYLE_LABEL[cfg.style] || cfg.style),
              h('div', { style: S.hint }, cfg.mode === 'clean'
                ? ('露 ' + (Math.round(cfg.holdMs / 100) / 10) + ' 秒，然后自己收')
                : '一直在屏幕上，直到我收起'),
              h('div', { style: Object.assign({}, S.row, { marginTop: '12px' }) },
                h('button', { style: S.modeBtn(cfg.mode === 'companion'), onClick: () => save({ mode: 'companion' }), disabled: busy }, '陪伴'),
                h('button', { style: S.modeBtn(cfg.mode === 'clean'), onClick: () => save({ mode: 'clean' }), disabled: busy }, '整洁'),
                cfg.mode === 'clean' ? h('input', {
                  type: 'number', min: 400, max: 60000, step: 100, style: S.num, value: cfg.holdMs,
                  onChange: (e) => setCfg((c) => Object.assign({}, c, { holdMs: Math.max(400, Math.min(60000, Number(e.target.value) || 2600)) })),
                  onBlur: () => save(),
                }) : null,
                cfg.mode === 'clean' ? h('span', { style: S.hint }, '毫秒') : null,
              ),
            ),
          ),
          h('div', { style: Object.assign({}, S.row, { marginTop: '16px' }) },
            h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '大小'),
            h('input', {
              type: 'range', min: 24, max: 192, step: 4, style: S.range, value: cfg.size,
              onChange: (e) => setCfg((c) => Object.assign({}, c, { size: Number(e.target.value) })),
              onMouseUp: () => save(),
            }),
            h('span', { style: Object.assign({}, S.stateLine, { whiteSpace: 'nowrap', minWidth: '42px' }) }, cfg.size + 'px'),
          ),
        ),

        // —— 换样子：点一下立刻生效，不用保存
        h('div', { style: S.card },
          h('div', { style: S.title }, '样子'),
          h('div', { style: S.hint }, '点一下就换。屏幕上那只按状态自己变姿势，这里定的是默认那只。'),
          h('div', { style: S.grid },
            STYLES.map(([id, label]) => h('div', {
              key: id, style: S.cell(cfg.style === id), title: id,
              onClick: () => { setCfg((c) => Object.assign({}, c, { style: id })); save({ style: id }) },
            },
            h('span', { style: sprite(id, 32) }),
            h('span', { style: S.cellName }, label))),
          ),
        ),

        // —— 陪伴（完整版）：节奏 / 模型 / 晃动识别，桌宠页那几块全搬这儿了
        conflict ? h('div', { style: S.card },
          h('div', { style: S.title }, '陪伴'),
          h('div', { style: S.hint }, '这些归 dsh-ming-mousepet 管，改完下一轮就生效。'),

          sched ? h('div', null,
            h('div', { style: Object.assign({}, S.row, { marginTop: '12px' }) },
              h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '开口节奏'),
              h('select', {
                style: S.num, value: sched.gapMode || 'off',
                onChange: (e) => saveSched({ gapMode: e.target.value }),
              },
                h('option', { value: 'off' }, '关'),
                h('option', { value: 'fixed' }, '定时'),
                h('option', { value: 'random' }, '随机'),
                h('option', { value: 'heartbeat' }, '心跳'),
              ),
              h('span', { style: S.stateLine }, '今天 ' + (sched.spokenToday || 0) + ' 句'),
              sched.nextAt ? h('span', { style: S.stateLine }, '· 下次约 ' + new Date(sched.nextAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)) : null,
            ),
            sched.gapMode === 'heartbeat' ? h('div', { style: S.row },
              h('span', { style: S.hint }, '最低'),
              h('input', { type: 'number', min: 1, max: 1440, title: '最短隔多久', style: S.num, value: sched.hbMin, onChange: (e) => setSched((c) => Object.assign({}, c, { hbMin: Number(e.target.value) })), onBlur: (e) => saveSched({ hbMin: Number(e.target.value) }) }),
              h('span', { style: S.hint }, '中位'),
              h('input', { type: 'number', min: 1, max: 1440, title: '最常落在这个数上', style: S.num, value: sched.hbCenter, onChange: (e) => setSched((c) => Object.assign({}, c, { hbCenter: Number(e.target.value) })), onBlur: (e) => saveSched({ hbCenter: Number(e.target.value) }) }),
              h('span', { style: S.hint }, '最高'),
              h('input', { type: 'number', min: 1, max: 1440, title: '最长隔多久', style: S.num, value: sched.hbMax, onChange: (e) => setSched((c) => Object.assign({}, c, { hbMax: Number(e.target.value) })), onBlur: (e) => saveSched({ hbMax: Number(e.target.value) }) }),
              h('span', { style: S.hint }, '分'),
            ) : h('div', { style: S.row },
              h('span', { style: S.hint }, '间隔'),
              h('input', { type: 'number', min: 1, max: 1440, title: '多少分钟一次（随机模式在这个数上浮动）', style: S.num, value: sched.minGapMinutes, onChange: (e) => setSched((c) => Object.assign({}, c, { minGapMinutes: Number(e.target.value) })), onBlur: (e) => saveSched({ minGapMinutes: Number(e.target.value) }) }),
              h('span', { style: S.hint }, '分'),
            ),
            h('div', { style: S.row },
              h('span', { style: S.hint }, '每天最多'),
              h('input', {
                type: 'number', min: 0, max: 999, style: S.num,
                value: sched.dailyMax < 0 ? '' : sched.dailyMax,
                disabled: sched.dailyMax < 0,
                onChange: (e) => setSched((c) => Object.assign({}, c, { dailyMax: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })),
                onBlur: (e) => saveSched({ dailyMax: Number(e.target.value) }),
              }),
              h('span', { style: S.hint }, '句'),
              h('button', { style: S.btn, onClick: () => saveSched({ dailyMax: sched.dailyMax < 0 ? 6 : -1 }) }, sched.dailyMax < 0 ? '改成限额' : '不限'),
              h('button', { style: S.btn, onClick: loadPet }, '刷新'),
            ),
          ) : h('div', { style: S.hint }, '读不到节奏设置（完整版没在跑？）'),

          models && models.current ? h('div', { style: Object.assign({}, S.row, { marginTop: '14px' }) },
            h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '用哪个模型'),
            h('select', {
              style: Object.assign({}, S.num, { width: '280px' }),
              value: models.current.provider + '||' + models.current.model,
              onChange: (e) => {
                const v = e.target.value
                const at = v.indexOf('||')
                save({ talkProvider: at < 0 ? '' : v.slice(0, at), talkModel: at < 0 ? '' : v.slice(at + 2) })
              },
            },
              h('option', { value: '' }, '插件默认'),
              // models.providers[].models 是 [{id,name}]。按字符串渲染就是 React #31（原来就是这么崩的）
              (models.providers || []).map((p) => (p.models && p.models.length
                ? h('optgroup', { key: 'p-' + p.id, label: p.name || p.id },
                  p.models.map((m) => h('option', {
                    key: p.id + '||' + m.id,
                    value: p.id + '||' + m.id,
                  }, m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id)))
                : h('option', {
                  key: 'p-' + p.id,
                  value: p.id + '||' + models.current.model,
                  disabled: true,
                }, (p.name || p.id) + (p.error ? '（列不出来）' : '（没有模型目录）')))),
            ),
            h('span', { style: S.stateLine }, models.current.fromSettings ? '按这里选的' : '插件默认'),
          ) : null,

          shake ? h('div', { style: Object.assign({}, S.row, { marginTop: '14px' }) },
            h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '晃一下鼠标'),
            h('button', { style: S.modeBtn(shake.on), onClick: () => saveShake({ on: !shake.on }) }, shake.on ? '开' : '关'),
            h('span', { style: S.hint }, '灵敏度'),
            h('select', {
              style: S.num, value: shake.level, onChange: (e) => saveShake({ level: e.target.value }),
            },
              h('option', { value: 'low' }, '低'),
              h('option', { value: 'medium' }, '中'),
              h('option', { value: 'high' }, '高'),
            ),
          ) : null,
          shake ? h('div', { style: S.hint }, '开了之后：晃一下鼠标，光标飞过去问一句「框哪块」。') : null,

          h('div', { style: S.stateLine }, petNote),
        ) : null,

        h('div', { style: S.row },
          h('button', { style: S.primary, onClick: tryIt }, '在屏幕上试一下'),
          h('button', { style: S.btn, onClick: reload, disabled: busy }, '重新读'),
        ),
        h('div', { style: S.stateLine }, live),
        h('div', { style: S.note }, note),
        h('div', { style: S.error }, error),
      )
    }

    // ---------------------------------------------------------------- 挂载
    const DESC = { id: 'cursor', label: '光标', order: 60, title: 'AI 光标：样子 / 大小 / 什么时候在', render: CursorPage }
    const SETTINGS_SPEC = { name: 'settings.section', id: 'ming-cursor', label: () => 'AI 光标', order: 42 }

    function registerSettings(ctx) {
      try {
        ctx.slots.inject('settings.section', () => ctx.slots.register(SETTINGS_SPEC, CursorPage))
        return true
      } catch (e) { return false }
    }

    return {
      apply(ctx) {
        if (typeof window === 'undefined') { registerSettings(ctx); return }

        // ① 「她的一生」已经在了：直接挂进去，设置里不再出现。
        if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') {
          window.__MING_TAB_HOST.add(DESC)
          return
        }

        // ② 它还没挂上，可能马上就挂（两个都是 immediately 加载，先后不定）。
        //    先排队；1.5 秒内没人来收，说明这台机器没装它 —— 自己开一个设置页。
        ;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(DESC)
        setTimeout(() => {
          if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') return
          const q = window.__MING_TABS_PENDING
          if (Array.isArray(q)) {
            const i = q.indexOf(DESC)
            if (i >= 0) q.splice(i, 1)
          }
          registerSettings(ctx)
        }, 1500)
      },
    }
  },
})
