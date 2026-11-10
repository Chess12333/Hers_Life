// 设置 → 桌宠：AI 光标样式 / 大小 / 陪伴或整洁。
// 纯手写客户端 chunk，格式与官方客户端插件一致；不需要构建。
window.__ModuleLoader__.load({
  id: 'dsh-ming-mousepet',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement

    const API = '/dsh-ming-mousepet/api'
    const ASSET = '/dsh-ming-mousepet/assets'

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
    }

    const S = {
      page: { maxWidth: '780px', color: C.text },
      lead: { fontSize: '12px', color: C.sub, lineHeight: 1.8, marginBottom: '14px' },
      card: { border: `1px solid ${C.border}`, borderRadius: '12px', padding: '14px', background: C.bg, marginBottom: '12px' },
      title: { fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '4px' },
      hint: { fontSize: '11px', color: C.faint, lineHeight: 1.7, marginBottom: '10px' },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      modeBtn: (on) => ({
        border: `1px solid ${on ? C.accent : C.border}`,
        background: on ? C.accent : 'transparent',
        color: on ? '#08111f' : C.text,
        borderRadius: '8px',
        padding: '7px 12px',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: on ? 700 : 400,
      }),
      grid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' },
      stateGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 16px' },
      stateItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', minWidth: 0 },
      stateThumb: {
        width: '30px',
        height: '30px',
        imageRendering: 'pixelated',
        background: '#20242c',
        borderRadius: '6px',
        display: 'block',
        flex: '0 0 30px',
      },
      stateName: { fontSize: '12px', color: C.text, lineHeight: 1.35 },
      stateWhy: { fontSize: '10.5px', color: C.faint, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      range: { width: '100%', accentColor: C.accent, cursor: 'pointer' },
      num: { width: '76px', background: C.input, color: C.text, border: `1px solid ${C.border}`, borderRadius: '7px', padding: '6px 8px', fontSize: '12px' },
      btn: { border: `1px solid ${C.border}`, background: 'transparent', color: C.text, borderRadius: '8px', padding: '7px 12px', fontSize: '12px', cursor: 'pointer' },
      primary: { border: `1px solid ${C.accent}`, background: C.accent, color: '#08111f', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', cursor: 'pointer', fontWeight: 700 },
      note: { fontSize: '12px', color: C.ok, minHeight: '18px', lineHeight: 1.6 },
      error: { fontSize: '12px', color: C.danger, minHeight: '18px', lineHeight: 1.6 },
    }

    const STATE_ROWS = [
      ['pointer', '指针', '默认 / 移动 / 普通点击'],
      ['link', '链接', '点到可点的按钮或链接'],
      ['text', '文本', '输入文字 / 按键'],
      ['vert', '上下', '上下滚动 / 竖向拖拽'],
      ['horz', '左右', '左右滚动 / 横向拖拽'],
      ['move', '移动', '拖动'],
      ['dgn1', '斜向1', '斜向拖拽（正斜率）'],
      ['dgn2', '斜向2', '斜向拖拽（负斜率）'],
      ['cross', '十字', '精确物理点击'],
      ['unavailiable', '禁止', '暂停 / 主人接管'],
      ['help', '帮助', '没点中 / 需要处理'],
      ['work', '工作', '执行中（预留）'],
      ['busy', '忙碌', '等待中（预留）'],
      ['handwriting', '手写', '手写（预留）'],
      ['alternate', '备用', '兜底状态'],
    ]

    async function api(path, options = {}) {
      const init = {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
      }
      if (options.body !== undefined) init.body = JSON.stringify(options.body)
      let response
      try {
        response = await fetch(`${API}${path}`, init)
      } catch {
        throw new Error('连不上独立输入插件（sidecar 可能还没起来）')
      }
      const raw = await response.text().catch(() => '')
      let data = null
      try { data = raw ? JSON.parse(raw) : null } catch { throw new Error('后端返回的不是 JSON') }
      if (!data?.ok) throw new Error(data?.error || `请求失败 ${response.status}`)
      return data
    }

    // >>> 共享光标页（源 C:/dsh/dsh-ming-ui/src/cursor-page.js —— 改源后跑 sync-cursor-page.mjs，别手改这段）
    function makeCursorPage(React, io) {
      const h = React.createElement

      // 15 个状态的名字两边共用一份，免得同一个图标在两边叫不同的名字
      const STYLE_LABELS = {
        pointer: '指针', work: '干活', unavailiable: '不可用', link: '可点', text: '文本',
        cross: '精确', busy: '等待', move: '移动', vert: '上下', horz: '左右',
        help: '求助', handwriting: '手写', dgn1: '对角一', dgn2: '对角二', alternate: '备用',
      }
      const labelOf = (id) => STYLE_LABELS[id] || id

      const S = {
        page: { padding: '18px 20px 26px', maxWidth: '1080px', color: '#e8edf6', fontSize: '14px' },
        head: { display: 'flex', alignItems: 'baseline', gap: '12px', margin: '0 0 14px' },
        h1: { fontSize: '17px', fontWeight: 600, margin: 0, letterSpacing: '.3px' },
        headNote: { fontSize: '12.5px', color: '#8b9ab3' },
        banner: {
          margin: '0 0 14px', padding: '10px 14px', borderRadius: '10px',
          background: 'rgba(255,170,60,.10)', border: '1px solid rgba(255,170,60,.32)',
          color: '#f0b45c', fontSize: '13px', lineHeight: 1.7,
        },
        card: {
          border: '1px solid rgba(255,255,255,.09)', borderRadius: '14px',
          background: 'rgba(255,255,255,.025)', padding: '16px 18px', margin: '0 0 14px',
        },
        hero: { display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' },
        stage: {
          width: '132px', height: '132px', flex: '0 0 auto', borderRadius: '12px',
          background: 'radial-gradient(circle at 50% 45%, rgba(120,170,255,.18), rgba(0,0,0,.25) 70%)',
          border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        body: { flex: '1 1 320px', minWidth: 0 },
        title: { fontSize: '15px', fontWeight: 600, margin: '2px 0 6px' },
        hint: { fontSize: '12.5px', color: '#8b9ab3', lineHeight: 1.7 },
        row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '12px' },
        seg: { display: 'inline-flex', border: '1px solid rgba(255,255,255,.14)', borderRadius: '10px', overflow: 'hidden' },
        segBtn: (on) => ({
          padding: '7px 15px', fontSize: '13px', cursor: 'pointer', border: 0,
          background: on ? 'rgba(120,170,255,.22)' : 'transparent',
          color: on ? '#cfe2ff' : '#98a6bd', fontWeight: on ? 600 : 400,
        }),
        num: {
          width: '92px', padding: '6px 9px', borderRadius: '8px', fontSize: '13px',
          border: '1px solid rgba(255,255,255,.14)', background: 'rgba(0,0,0,.22)', color: '#e8edf6',
        },
        range: { flex: '1 1 220px', minWidth: '160px', accentColor: '#78aaff' },
        value: { fontSize: '12.5px', color: '#9fb3d1', minWidth: '52px', textAlign: 'right' },
        secTitle: { fontSize: '13px', fontWeight: 600, color: '#c7d5ea', margin: '0 0 4px' },
        grid: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' },
        cell: (on) => ({
          width: '76px', padding: '9px 6px 7px', borderRadius: '10px', cursor: 'pointer', textAlign: 'center',
          border: on ? '1px solid rgba(120,170,255,.75)' : '1px solid rgba(255,255,255,.09)',
          background: on ? 'rgba(120,170,255,.16)' : 'rgba(255,255,255,.02)',
        }),
        cellName: { display: 'block', fontSize: '11.5px', color: '#9fb3d1', marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        foot: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '4px' },
        primary: {
          padding: '8px 18px', borderRadius: '10px', border: 0, cursor: 'pointer', fontSize: '13.5px', fontWeight: 600,
          background: 'linear-gradient(180deg,#6f9dff,#4a7fe6)', color: '#fff',
        },
        btn: {
          padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px',
          border: '1px solid rgba(255,255,255,.16)', background: 'rgba(255,255,255,.04)', color: '#cbd8ea',
        },
        line: { fontSize: '12.5px', color: '#8b9ab3', marginTop: '10px', minHeight: '18px' },
        err: { fontSize: '12.5px', color: '#ff9a9a', marginTop: '6px', minHeight: '18px' },
        empty: { padding: '40px', textAlign: 'center', color: '#8b9ab3', fontSize: '13px' },
      }

      return function CursorPage() {
        const [cfg, setCfg] = React.useState(null)
        const [styles, setStyles] = React.useState([])
        const [busy, setBusy] = React.useState(false)
        const [note, setNote] = React.useState('')
        const [error, setError] = React.useState('')
        const [live, setLive] = React.useState('')
        const [banner, setBanner] = React.useState('')
        const [extra, setExtra] = React.useState(null)   // 完整版才有：开口节奏 / 模型 / 晃动识别
        const [holdDraft, setHoldDraft] = React.useState(null)   // 输入框里正在打的数，别每敲一下都保存
        const [sizeDraft, setSizeDraft] = React.useState(null)

        const reload = React.useCallback(() => {
          setError('')
          Promise.resolve()
            .then(() => io.load())
            .then((r) => {
              setCfg(r.cfg)
              setStyles(r.styles || [])
              setBanner(r.banner || '')
              return io.extra ? io.extra.load().then((x) => setExtra(x || null)).catch(() => setExtra(null)) : null
            })
            .catch((e) => setError('读不到：' + (e && e.message ? e.message : e)))
        }, [])

        React.useEffect(() => { reload() }, [reload])

        const put = (patch) => {
          const merged = Object.assign({}, cfg, patch || {})
          setCfg(merged)
          setBusy(true); setNote(''); setError('')
          Promise.resolve()
            .then(() => io.save(merged))
            .then((r) => { if (r && r.cfg) setCfg(r.cfg); setNote('已生效') })
            .catch((e) => setError('没存上：' + (e && e.message ? e.message : e)))
            .then(() => setBusy(false), () => setBusy(false))
        }

        const putExtra = (kind, patch) => {
          if (!io.extra) return
          Promise.resolve()
            .then(() => io.extra.save(kind, patch))
            .then((r) => { if (r) setExtra((cur) => Object.assign({}, cur, r)); setNote('已生效') })
            .catch((e) => setError('没存上：' + (e && e.message ? e.message : e)))
        }

        const tryIt = () => {
          setLive('正在叫光标…'); setError('')
          Promise.resolve()
            .then(() => io.tryIt())
            .then((t) => setLive(t || '好了'))
            .catch((e) => { setLive(''); setError('没叫出来：' + (e && e.message ? e.message : e)) })
        }

        if (!cfg && !error) return h('div', { style: S.page }, h('div', { style: S.empty }, '正在读光标设置…'))

        if (!cfg) {
          return h('div', { style: S.page },
            h('div', { style: S.head }, h('div', { style: S.h1 }, 'AI 光标')),
            h('div', { style: S.banner }, error),
            h('div', { style: S.foot }, h('button', { style: S.btn, onClick: reload }, '重试')))
        }

        const clean = cfg.mode === 'clean'
        const secs = Math.round((cfg.holdMs || 2600) / 100) / 10

        return h('div', { style: S.page },
          h('div', { style: S.head },
            h('div', { style: S.h1 }, 'AI 光标'),
            h('div', { style: S.headNote }, io.note || '桌面上那只指针；它按正在做的事自己换姿势')),

          banner ? h('div', { style: S.banner }, banner) : null,

          // ① 一眼看到：现在长什么样 + 什么时候在
          h('div', { style: S.card },
            h('div', { style: S.hero },
              h('div', { style: S.stage }, h('span', { style: io.sprite(cfg.style, 72) })),
              h('div', { style: S.body },
                h('div', { style: S.title }, labelOf(cfg.style)),
                h('div', { style: S.hint }, clean
                  ? '露 ' + secs + ' 秒，然后自己收（适合不想被它一直挡着的时候）'
                  : '一直在屏幕上，直到收起（陪伴：看得见它在忙什么）'),

                h('div', { style: S.row },
                  h('div', { style: S.seg },
                    h('button', { style: S.segBtn(!clean), disabled: busy, onClick: () => put({ mode: 'companion' }) }, '陪伴'),
                    h('button', { style: S.segBtn(clean), disabled: busy, onClick: () => put({ mode: 'clean' }) }, '整洁')),
                  clean ? h('span', { style: S.hint }, '露多久') : null,
                  clean ? h('input', {
                    type: 'number', min: 400, max: 60000, step: 100, style: S.num,
                    value: holdDraft == null ? cfg.holdMs : holdDraft,
                    onChange: (e) => setHoldDraft(Number(e.target.value)),
                    onBlur: () => { const v = Math.max(400, Math.min(60000, Number(holdDraft) || cfg.holdMs)); setHoldDraft(null); if (v !== cfg.holdMs) put({ holdMs: v }) },
                  }) : null,
                  clean ? h('span', { style: S.hint }, '毫秒') : null,
                ),

                h('div', { style: S.row },
                  h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '大小'),
                  h('input', {
                    type: 'range', min: 24, max: 192, step: 4, style: S.range,
                    value: sizeDraft == null ? cfg.size : sizeDraft,
                    onChange: (e) => setSizeDraft(Number(e.target.value)),
                    onMouseUp: () => { if (sizeDraft != null && sizeDraft !== cfg.size) put({ size: sizeDraft }); setSizeDraft(null) },
                    onTouchEnd: () => { if (sizeDraft != null && sizeDraft !== cfg.size) put({ size: sizeDraft }); setSizeDraft(null) },
                  }),
                  h('span', { style: S.value }, (sizeDraft == null ? cfg.size : sizeDraft) + 'px')),
              )),
          ),

          // ② 换样子：点一下就换
          h('div', { style: S.card },
            h('div', { style: S.secTitle }, '样子'),
            h('div', { style: S.hint }, '点一下就换。屏幕上那只按状态自己变姿势，这里定的是默认那只。'),
            h('div', { style: S.grid },
              styles.map((id) => h('div', {
                key: id, style: S.cell(cfg.style === id), title: id,
                onClick: () => put({ style: id }),
              },
              h('span', { style: io.sprite(id, 30) }),
              h('span', { style: S.cellName }, labelOf(id)))))),

          // ②' 陪伴（只有完整版才有这些；轻量版 io.extra 为空，整块不出现）
          extra ? h('div', { style: S.card },
            h('div', { style: S.secTitle }, '陪伴'),
            h('div', { style: S.hint }, '它什么时候自己开口、用哪个模型、晃一下鼠标算不算叫你——这些归完整版管，改完立刻生效。'),

            extra.sched ? h('div', null,
              h('div', { style: S.row },
                h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '开口节奏'),
                h('select', {
                  style: S.num, value: extra.sched.gapMode || 'off',
                  onChange: (e) => putExtra('sched', { gapMode: e.target.value }),
                },
                  h('option', { value: 'off' }, '关'),
                  h('option', { value: 'fixed' }, '定时'),
                  h('option', { value: 'random' }, '随机'),
                  h('option', { value: 'heartbeat' }, '心跳')),
                h('span', { style: S.hint }, '今天 ' + (extra.sched.spokenToday || 0) + ' 句'),
                extra.sched.nextAt ? h('span', { style: S.hint }, '· 下次约 ' + String(extra.sched.nextAt).slice(11, 16)) : null),

              extra.sched.gapMode === 'heartbeat' ? h('div', { style: S.row },
                h('span', { style: S.hint }, '最低'),
                h('input', { type: 'number', min: 1, max: 1440, style: S.num, value: extra.sched.hbMin,
                  onChange: (e) => setExtra((c) => Object.assign({}, c, { sched: Object.assign({}, c.sched, { hbMin: Number(e.target.value) }) })),
                  onBlur: (e) => putExtra('sched', { hbMin: Number(e.target.value) }) }),
                h('span', { style: S.hint }, '中位'),
                h('input', { type: 'number', min: 1, max: 1440, style: S.num, value: extra.sched.hbCenter,
                  onChange: (e) => setExtra((c) => Object.assign({}, c, { sched: Object.assign({}, c.sched, { hbCenter: Number(e.target.value) }) })),
                  onBlur: (e) => putExtra('sched', { hbCenter: Number(e.target.value) }) }),
                h('span', { style: S.hint }, '最高'),
                h('input', { type: 'number', min: 1, max: 1440, style: S.num, value: extra.sched.hbMax,
                  onChange: (e) => setExtra((c) => Object.assign({}, c, { sched: Object.assign({}, c.sched, { hbMax: Number(e.target.value) }) })),
                  onBlur: (e) => putExtra('sched', { hbMax: Number(e.target.value) }) }),
                h('span', { style: S.hint }, '分'))
                : h('div', { style: S.row },
                  h('span', { style: S.hint }, '间隔'),
                  h('input', { type: 'number', min: 1, max: 1440, style: S.num, value: extra.sched.minGapMinutes,
                    onChange: (e) => setExtra((c) => Object.assign({}, c, { sched: Object.assign({}, c.sched, { minGapMinutes: Number(e.target.value) }) })),
                    onBlur: (e) => putExtra('sched', { minGapMinutes: Number(e.target.value) }) }),
                  h('span', { style: S.hint }, '分钟')),

              h('div', { style: S.row },
                h('span', { style: S.hint }, '每天最多'),
                h('input', { type: 'number', min: 0, max: 999, style: S.num,
                  value: extra.sched.dailyMax < 0 ? '' : extra.sched.dailyMax,
                  disabled: extra.sched.dailyMax < 0,
                  onChange: (e) => setExtra((c) => Object.assign({}, c, { sched: Object.assign({}, c.sched, { dailyMax: Number(e.target.value) }) })),
                  onBlur: (e) => putExtra('sched', { dailyMax: Number(e.target.value) }) }),
                h('span', { style: S.hint }, '句'),
                h('button', { style: S.btn, onClick: () => putExtra('sched', { dailyMax: extra.sched.dailyMax < 0 ? 6 : -1 }) },
                  extra.sched.dailyMax < 0 ? '改成限额' : '不限'),
                h('button', { style: S.btn, onClick: reload }, '刷新')))
              : h('div', { style: S.hint }, '读不到节奏设置（完整版没在跑？）'),

            extra.models && extra.models.current ? h('div', { style: S.row },
              h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '用哪个模型'),
              h('select', {
                style: Object.assign({}, S.num, { width: '300px' }),
                value: extra.models.current.provider + '||' + extra.models.current.model,
                onChange: (e) => {
                  const at = e.target.value.indexOf('||')
                  putExtra('model', at < 0
                    ? { talkProvider: '', talkModel: '' }
                    : { talkProvider: e.target.value.slice(0, at), talkModel: e.target.value.slice(at + 2) })
                },
              },
                h('option', { value: '' }, '插件默认'),
                (extra.models.providers || []).map((p) => (p.models && p.models.length
                  ? h('optgroup', { key: p.id, label: p.name || p.id },
                    p.models.map((m) => h('option', { key: p.id + '||' + m.id, value: p.id + '||' + m.id },
                      m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id)))
                  : h('option', { key: p.id, value: p.id + '||' + extra.models.current.model, disabled: true },
                    (p.name || p.id) + (p.error ? '（列不出来）' : '（没有模型目录）'))))),
              h('span', { style: S.hint }, extra.models.current.fromSettings ? '按这里选的' : '插件默认'))
              : null,

            extra.shake ? h('div', null,
              h('div', { style: S.row },
                h('span', { style: Object.assign({}, S.hint, { whiteSpace: 'nowrap' }) }, '晃一下鼠标'),
                h('div', { style: S.seg },
                  h('button', { style: S.segBtn(!!extra.shake.on), onClick: () => putExtra('shake', { on: true }) }, '算叫你'),
                  h('button', { style: S.segBtn(!extra.shake.on), onClick: () => putExtra('shake', { on: false }) }, '不理')),
                h('span', { style: S.hint }, '灵敏度'),
                h('select', { style: S.num, value: extra.shake.level, onChange: (e) => putExtra('shake', { level: e.target.value }) },
                  h('option', { value: 'low' }, '低'),
                  h('option', { value: 'medium' }, '中'),
                  h('option', { value: 'high' }, '高'))),
              h('div', { style: S.hint }, '开了之后：晃一下鼠标，光标飞过去问一句「框哪块」。'))
              : null)
            : null,

          // ③ 到底动没动：叫出来看一眼，别只信「保存成功」
          h('div', { style: S.foot },
            h('button', { style: S.primary, onClick: tryIt }, '在屏幕上试一下'),
            h('button', { style: S.btn, disabled: busy, onClick: reload }, '重新读')),

          h('div', { style: S.line }, live || note),
          h('div', { style: S.err }, error))
      }
    }
    // <<< 共享光标页

    // 完整版：读写自己的 settings（cursor* 三个字段），映射成共享页那套 {mode, holdMs, size, style}。
    // 顺带看一眼轻量版在不在跑——两边都画就是两只光标，页上给一句提示，别让人自己去猜。
    const toCfg = (s) => ({
      mode: s && s.cursorMode === 'clean' ? 'clean' : 'companion',
      holdMs: (s && Number(s.cursorHoldMs)) || 2600,
      size: (s && Number(s.cursorSize)) || 64,
      style: (s && s.cursorState) || 'pointer',
    })
    const CursorTab = makeCursorPage(React, {
      note: '桌面上那只指针；它按正在做的事自己换姿势',
      // 完整版的素材服务只认 /assets/<style>.png（单张 64×64 的预览图，来自 assets/previews）。
      // /assets/cursors/... 不在白名单里，会 404 —— 2026-11-10 撞过一次：图全黑就是这个。
      sprite: (id, px) => ({
        display: 'inline-block', width: px + 'px', height: px + 'px',
        backgroundImage: 'url(' + ASSET + '/' + id + '.png)',
        backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', imageRendering: 'pixelated',
      }),
      load: async () => {
        const d = await (await fetch(API + '/settings', { cache: 'no-store' })).json()
        if (!d || !d.ok || !d.settings) throw new Error('读不到设置')
        let styles = []
        try {
          const k = await (await fetch(API + '/skins', { cache: 'no-store' })).json()
          if (k && k.ok) styles = (k.builtin || []).slice()
        } catch (e) { /* 没有就用下面那份 */ }
        if (!styles.length) styles = ['pointer', 'work', 'unavailiable', 'link', 'text', 'cross', 'busy', 'move', 'vert', 'horz', 'help', 'handwriting', 'dgn1', 'dgn2', 'alternate']
        let banner = ''
        try {
          const c = await (await fetch('/dsh-ming-cursor/api/settings', { cache: 'no-store' })).json()
          if (c && c.ok) banner = '轻量版（dsh-ming-cursor）也在跑，两只光标会打架。建议在插件里把它禁用——光标页仍然在这一页，不受影响。'
        } catch (e) { /* 没装就没有 */ }
        return { cfg: toCfg(d.settings), styles, banner }
      },
      save: async (c) => {
        const d = await (await fetch(API + '/settings', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            cursorMode: c.mode === 'clean' ? 'clean' : 'companion',
            cursorHoldMs: c.holdMs,
            cursorSize: c.size,
            cursorState: c.style,
          }),
        })).json()
        if (!d || !d.ok) throw new Error('没存上')
        return { cfg: toCfg(d.settings) }
      },
      tryIt: async () => {
        const d = await (await fetch(API + '/show', { method: 'POST', cache: 'no-store' })).json()
        if (!d || !d.ok) throw new Error('完整版没在跑？')
        return '完整版那只光标已经叫出来了'
      },
      // 陪伴那几块（开口节奏 / 用哪个模型 / 晃动识别）：只有完整版有，轻量版不提供，页面上就不出现。
      extra: {
        load: async () => {
          const out = {}
          try { const d = await (await fetch(API + '/schedule', { cache: 'no-store' })).json(); if (d && d.ok) out.sched = d } catch (e) {}
          try { const d = await (await fetch(API + '/models', { cache: 'no-store' })).json(); if (d && d.ok) out.models = d } catch (e) {}
          try { const d = await (await fetch(API + '/shake', { cache: 'no-store' })).json(); if (d && d.ok) out.shake = d.shake } catch (e) {}
          return Object.keys(out).length ? out : null
        },
        save: async (kind, patch) => {
          const url = API + (kind === 'sched' ? '/schedule' : kind === 'shake' ? '/shake' : '/settings')
          const d = await (await fetch(url, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
          })).json()
          if (!d || !d.ok) throw new Error('没存上')
          if (kind === 'sched') return { sched: d }
          if (kind === 'shake') return { shake: d.shake }
          return {}
        },
      },
    })

    return {
      // 2026-11-08 15:17 她：「把设置栏中的桌宠删掉」——那会儿完整版自己没有页，
      // 全靠「她的一生 → 桌宠」那一页，而那一页后来没挂成页签，光标设置就断了入口。
      // 2026-11-10：完整版自己带一个「光标」页，有 graph 就挂进去，没有就注册设置节。
      apply(ctx) {
        const DESC = { id: 'pet-cursor', label: '光标', order: 60, title: 'AI 光标：样子 / 大小 / 什么时候在', render: CursorTab }
        const SPEC = { name: 'settings.section', id: 'ming-mousepet-cursor', label: () => 'AI 光标', order: 42 }
        const section = () => {
          try {
            if (ctx && ctx.slots && typeof ctx.slots.inject === 'function') {
              ctx.slots.inject('settings.section', () => ctx.slots.register(SPEC, CursorTab))
              return true
            }
          } catch (e) { /* 没有设置位就算了 */ }
          return false
        }
        if (typeof window === 'undefined') { section(); return }
        if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') {
          window.__MING_TAB_HOST.add(DESC)
          return
        }
        ;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(DESC)
        setTimeout(() => {
          if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') return
          const q = window.__MING_TABS_PENDING
          if (Array.isArray(q)) { const i = q.indexOf(DESC); if (i >= 0) q.splice(i, 1) }
          section()
        }, 1500)
      },
    }
  },
})
