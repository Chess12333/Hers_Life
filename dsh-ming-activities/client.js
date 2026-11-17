window.__ModuleLoader__.load({
  id: 'dsh-ming-activities',
  factory(require) {
    const React = require('react'), h = React.createElement
    const labels = { active: '进行中', paused: '暂停', completed: '已完成', abandoned: '不再继续' }
    const empty = () => ({ title: '', url: '', progress: '', next: '', status: 'active' })
    function Activities() {
      const [data, setData] = React.useState(null)
      const [draft, setDraft] = React.useState(empty)
      const [editing, setEditing] = React.useState('')
      const [pendingDelete, setPendingDelete] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [refresh, setRefresh] = React.useState(0)
      const endpoint = '/dsh-ming-activities/activities'
      const request = async options => {
        const r = await fetch(endpoint, options)
        const result = await r.json()
        if (!r.ok || result.error) throw new Error(result.error || '活动暂时不可用')
        return result
      }
      React.useEffect(() => {
        const controller = new AbortController()
        setBusy(true); setError('')
        request({ signal: controller.signal }).then(setData)
          .catch(e => { if (!controller.signal.aborted) setError(e.message) })
          .finally(() => { if (!controller.signal.aborted) setBusy(false) })
        return () => controller.abort()
      }, [refresh])
      const reset = () => { setEditing(''); setDraft(empty()) }
      const save = async (action, id = '') => {
        setBusy(true); setError(''); setNotice('')
        try {
          const next = await request({ method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ revision: data.revision, action, id, activity: draft }) })
          setData(next); setPendingDelete('')
          if (action !== 'delete' || id === editing) reset()
          setNotice(action === 'delete' ? '活动卡已删除。' : '活动已保存。')
        } catch (e) { setError(e.message) }
        finally { setBusy(false) }
      }
      const button = (text, fn, extra = {}) => h('button', { type: 'button', className: 'activity-button', disabled: busy, onClick: fn, ...extra }, text)
      const input = (key, label, limit, multiline = false) => h('label', { className: 'activity-field', key },
        h('span', null, label), h(multiline ? 'textarea' : 'input', {
          name: key, 'aria-label': label, value: draft[key], maxLength: limit, required: key === 'title', rows: multiline ? 3 : undefined,
          type: !multiline ? key === 'url' ? 'url' : 'text' : undefined,
          onChange: e => setDraft({ ...draft, [key]: e.target.value }),
          placeholder: { title: '例如：一起读的书', url: 'https://…（可留空）', progress: '例如：读到第 5 章', next: '例如：下次从第 6 章开始' }[key],
        }))
      const cards = (data?.activities || []).filter(a => (filter === 'all' || a.status === filter) &&
        (a.title + ' ' + a.progress + ' ' + a.next).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => b.updated.localeCompare(a.updated))
      return h('section', { className: 'activities-page', 'aria-label': '共同活动' },
        h('header', null, h('h2', null, '共同活动'), h('p', { className: 'activity-muted' }, '记下上次到哪里，下次想接着做什么。由你手动保存，什么时候继续由你决定。')),
        error ? h('p', { className: 'activity-error', role: 'alert' }, error) : null,
        notice ? h('p', { className: 'activity-notice', role: 'status' }, notice) : null,
        !data && busy ? h('p', { role: 'status' }, '正在读取活动…') : null,
        h('form', { className: 'activity-panel', onSubmit: e => { e.preventDefault(); if (!busy && data) save(editing ? 'update' : 'create', editing) } },
          h('h3', null, editing ? '编辑活动' : '记下一项活动'),
          h('fieldset', { disabled: busy || !data }, input('title', '活动标题', 160), input('url', '来源链接', 2048),
            input('progress', '当前进度', 1000, true), input('next', '下次接着做', 1000, true),
            h('label', { className: 'activity-field' }, h('span', null, '活动状态'), h('select', { 'aria-label': '活动状态', value: draft.status, onChange: e => setDraft({ ...draft, status: e.target.value }) },
              Object.entries(labels).map(([key, text]) => h('option', { value: key, key }, text)))),
            h('div', { className: 'activity-actions' }, h('button', { type: 'submit', className: 'activity-button primary', disabled: busy || !data }, busy ? '处理中…' : editing ? '保存修改' : '保存活动'), editing ? button('取消编辑', reset) : null))),
        h('div', { className: 'activity-toolbar' },
          h('input', { 'aria-label': '搜索活动', placeholder: '搜索活动或进度', value: query, onChange: e => setQuery(e.target.value) }),
          h('select', { 'aria-label': '筛选活动状态', value: filter, onChange: e => setFilter(e.target.value) }, h('option', { value: 'all' }, '全部状态'), Object.entries(labels).map(([key, text]) => h('option', { value: key, key }, text))),
          button('刷新列表', () => { setRefresh(n => n + 1); setNotice('') })),
        data && !cards.length ? h('p', { className: 'activity-muted' }, data.activities.length ? '没有符合筛选的活动。' : '还没有活动，先记下一件想一起做的事吧。') : null,
        ...cards.map(a => h('article', { className: 'activity-panel', key: a.id, 'aria-label': a.title },
          h('div', { className: 'activity-card-head' }, h('h3', null, a.title), h('span', { className: 'activity-badge' }, labels[a.status])),
          a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, '打开来源链接') : null,
          h('p', { className: 'activity-content' }, h('strong', null, '当前进度：'), a.progress || '还没有填写'),
          h('p', { className: 'activity-content' }, h('strong', null, '下次接着做：'), a.next || '还没有填写'),
          h('p', { className: 'activity-muted' }, '更新于 ' + new Date(a.updated).toLocaleString()),
          h('div', { className: 'activity-actions' },
            button('编辑', () => { setEditing(a.id); setDraft({ ...a }); setError(''); setNotice(''); setPendingDelete('') }, { 'aria-label': '编辑 ' + a.title }),
            button('复制接续说明', async () => {
              try { await navigator.clipboard.writeText('共同活动：' + a.title + '\n状态：' + labels[a.status] + '\n链接：' + a.url + '\n当前进度：' + a.progress + '\n下次接着做：' + a.next); setNotice('已复制，可按需要贴进聊天。不会自动发送。'); setError('') }
              catch { setError('浏览器未允许复制，请直接选中卡片文字复制。') }
            }), button('删除', () => setPendingDelete(a.id), { 'aria-label': '删除 ' + a.title })),
          pendingDelete === a.id ? h('div', { className: 'activity-confirm', role: 'group', 'aria-label': '确认删除活动' },
            h('p', null, '删除这张活动卡？只删除此处记录，不会删除链接里的作品或聊天。'),
            button('确认删除', () => save('delete', a.id)), button('保留', () => setPendingDelete(''))) : null)),
        h('p', { className: 'activity-muted' }, '记录保存在当前配置的工作区。不会自动读聊天、调用模型或安排提醒；停用插件后文件仍保留。'))
    }
    return { inject: ['slots'], apply(ctx) {
      const slots = ctx.get('slots'); if (!slots) return
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = `.activities-page{max-width:760px;display:grid;gap:18px;padding:2px 2px 28px;color:var(--dsw-alias-label-primary,inherit);line-height:1.6}.activities-page *{box-sizing:border-box}.activities-page h2,.activities-page h3{margin:0;overflow-wrap:anywhere}.activities-page p{margin:8px 0}.activity-panel{border:1px solid var(--dsw-alias-border-l1,#8884);border-radius:12px;padding:18px;background:var(--dsw-alias-bg-layer-1,transparent);display:grid;gap:10px}.activity-panel fieldset{margin:0;padding:0;border:0;display:grid;gap:14px;min-width:0}.activity-field{display:grid;gap:5px;font-size:13px;font-weight:500}.activities-page input,.activities-page textarea,.activities-page select{font:inherit;border:1px solid var(--dsw-alias-border-l1,#8886);border-radius:8px;padding:9px 11px;background:var(--dsw-alias-bg-base,transparent);color:inherit;min-width:0;max-width:100%}.activities-page textarea{width:100%;resize:vertical}.activity-actions,.activity-toolbar,.activity-card-head{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.activity-toolbar input{flex:1 1 180px}.activity-card-head{justify-content:space-between;align-items:flex-start}.activity-card-head h3{flex:1 1 180px}.activity-button{font:inherit;font-size:13px;border:1px solid var(--dsw-alias-border-l1,#8886);border-radius:8px;padding:7px 13px;background:transparent;color:inherit;cursor:pointer}.activity-button.primary{background:var(--dsw-alias-brand-primary,#426bca);border-color:transparent;color:white}.activity-button:disabled{opacity:.5;cursor:default}.activity-button:focus-visible,.activities-page input:focus-visible,.activities-page textarea:focus-visible,.activities-page select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#426bca);outline-offset:2px}.activity-muted{font-size:12px;color:var(--dsw-alias-label-secondary,#687687)}.activity-error{color:var(--dsw-alias-state-error-primary,#bd3434);overflow-wrap:anywhere}.activity-notice{color:var(--dsw-alias-state-success-primary,#28845b)}.activity-badge{background:var(--dsw-alias-bg-layer-2,#8881);border:1px solid var(--dsw-alias-border-l1,#8883);border-radius:20px;padding:2px 10px;font-size:12px;white-space:nowrap}.activity-content{white-space:pre-wrap;overflow-wrap:anywhere}.activity-confirm{border-top:1px solid var(--dsw-alias-border-l1,#8884);padding-top:10px}.activity-confirm button{margin-right:8px}.activities-page a{color:var(--dsw-alias-brand-primary,#426bca)}@media(max-width:440px){.activity-panel{padding:14px}}`
        document.head.appendChild(style); return () => style.remove()
      }, 'ming-activities: styles')
      ctx.effect(() => slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'shared-activities', order: 19, label: '共同活动' }, Activities
      )), 'ming-activities: settings')
    } }
  },
})
