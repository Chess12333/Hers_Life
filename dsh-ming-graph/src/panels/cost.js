// ===== 2026-11-08：top 栏两个新入口 =====
// 她说的：「再在她的一生的 top 栏中做一个 skill 开关的 top 选项，然后还有费用计费」。
// 两个都做成浮层，不占一格 tab——它们不是「看什么」，是「现在花多少、模型能看见什么」。

function fmtMoney(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  if (v >= 100) return '¥' + v.toFixed(0)
  if (v >= 10) return '¥' + v.toFixed(1)
  return '¥' + v.toFixed(3)
}

// 浮层壳：半透明遮罩负责「点外面关掉」，不拦事件到按钮上
function MgPop(props) {
  return [
    h('div', { key: 'veil', className: 'mg-veil', onClick: props.onClose }),
    h('div', { key: 'pop', className: 'mg-pop' },
      h('div', { className: 'mg-pop-h' },
        h('b', null, props.title),
        props.sub ? h('span', { className: 'mg-pop-sub' }, props.sub) : null,
        h('span', { className: 'mg-gap' }),
        h('button', { className: 'mg-x', onClick: props.onClose, title: '关掉' }, '×'),
      ),
      props.children,
    ),
  ]
}

function SkillsBody(props) {
  const d = props.data
  if (!d) return h('div', { className: 'mg-pop-empty' }, '读清单中…')
  if (d.ok === false) return h('div', { className: 'mg-pop-empty' }, '读不到 skill 清单：' + (d.error || '未知原因'))
  const rows = d.rows || []
  const q = (props.q || '').trim().toLowerCase()
  const shown = q
    ? rows.filter((r) => (r.name || '').toLowerCase().indexOf(q) >= 0 || (r.desc || '').toLowerCase().indexOf(q) >= 0)
    : rows
  return h('div', null,
    h('div', { className: 'mg-pop-line' },
      h('input', {
        className: 'mg-input', placeholder: '过滤名字 / 描述', value: props.q || '',
        onChange: (e) => props.onQ(e.target.value),
      }),
      h('button', { className: 'mg-btn', onClick: props.onReload, title: '重新问一遍宿主' }, '重读'),
      h('span', { className: 'mg-pop-sub' }, '开 ' + (d.total - (d.offCount || 0)) + ' / 共 ' + d.total),
    ),
    shown.length
      ? shown.map((r) => h('div', { key: r.name, className: 'mg-skill' + (r.on ? '' : ' off') },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { className: 'mg-skill-n' },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name),
            r.provider === 'ming-skill-isolate' ? h('i', { className: 'mg-tag', title: '只剩遮罩条目，原文件没找到' }, '遮罩') : null,
            r.source === 'bundled' ? h('i', { className: 'mg-tag' }, '自带') : null,
          ),
          h('div', { className: 'mg-skill-d', title: r.desc || '' }, r.desc || '（没有描述）'),
        ),
        h('button', {
          className: 'mg-sw' + (r.on ? ' on' : ''),
          disabled: props.busy === r.name,
          title: r.on ? '关掉：从模型视野里遮掉（不删文件）' : '开回来',
          onClick: () => props.onToggle(r.name, !r.on),
        }, props.busy === r.name ? '…' : (r.on ? '开' : '关')),
      ))
      : h('div', { className: 'mg-pop-empty' }, '没有匹配的'),
    h('div', { className: 'mg-pop-foot' },
      d.source === 'disk'
        ? '⚠ 宿主 skills 服务没接上，这份是从 ~/.dsh/skills 扫出来的——可能比模型真正看到的多。'
        : '清单来自宿主 skills 服务（跟模型看到的是同一份）。',
      ' 开关写 ' + (d.offFile || 'skills-off.json') + '，只对 ' + (d.cwd || '这个工作区') + ' 生效。',
      '改完立刻算数，但当前这一轮的目录已经组装完——下一次请求才刷新。'),
  )
}

// 2026-11-08 16:1x：费用页改成读我们自己的接口 /_dsh/dsh-ming-graph/cost
// 原来读 dsh-bottom-info-bar 的 getUsageSummary，它返回不出数（账本有 token 没价）。
// 现在口径由 cost-lib.mjs 定，页面只负责显示，并把口径原样印在下面。
function MgCostPage(props) {
  const busy = !!props.indexing
  const info = props.indexInfo
  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 19V5M4 19h16' }),
          h('path', { d: 'M8 16v-5M12.5 16V8M17 16v-3' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '费用'),
        h('div', { className: 'ming-ph-d' }, '用量是账本里的实数；金额按价目折算，不是实际扣款'),
      ),
      h('div', { className: 'ming-ph-a' },
        // 2026-11-10：她加的——没定价的模型，点一下去网上找价；找不到就借最相似的，标出公式
        h('button', {
          className: 'mg-btn',
          disabled: busy,
          title: '给账本里「未定价」的模型去网上搜一次价；找不到就借最相似的那个，并在名字后面标出用的是谁的公式',
          onClick: props.onIndex,
        }, busy ? '索引中…' : '索引费用'),
        h('button', { className: 'mg-btn', onClick: props.onReload }, '重读'),
      ),
    ),
    info ? h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '刚才那次索引'),
        h('span', { className: 'ming-sec-n' }, info.ok === false ? '失败' : (info.message || ((info.summary && info.summary.total) || 0) + ' 个模型')),
      ),
      h('div', { className: 'ming-sec-b' },
        info.ok === false
          ? h('div', { className: 'mg-pop-empty' }, '索引失败：' + (info.error || '未知原因'))
          : h('div', null,
            h('div', { className: 'ming-note' },
              '查到原价 ' + ((info.summary && (info.summary.exact + info.summary.search)) || 0) +
              ' 个 · 借相近模型 ' + ((info.summary && info.summary.similar) || 0) +
              ' 个 · 没找到 ' + ((info.summary && info.summary.none) || 0) + ' 个'),
            (info.results || []).map((r) => h('div', { key: r.model, className: 'ming-note', style: { marginTop: 4 } },
              r.model + ' → ',
              r.from && r.from !== r.model ? ('公式：' + r.from) : (r.price ? '查到了自己的价' : '没找到'),
              r.source ? '　⟵ ' + r.source : '',
              r.note ? '　' + r.note : '')),
          ),
      ),
    ) : null,
    h('div', { className: 'ming-wrap ming-scroll' }, h(CostBody, props)),
  )
}

function SumTokens(x) {
  return (x.input || 0) + (x.cacheRead || 0) + (x.output || 0)
}

function fmtTokens(n) {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}

function CostBody(props) {
  const d = props.data
  if (props.err) {
    return h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'mg-pop-empty' }, '读不到账本：' + props.err),
      ),
    )
  }
  if (!d) return h('div', { className: 'ming-empty' }, '读账本中…')
  if (d.ok === false) {
    return h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'mg-pop-empty' }, '读不到账本：' + (d.error || '未知原因')),
        h('div', { className: 'ming-note' }, '账本在 ~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite，由那个插件写；它没装或没跑起来时这里就是空的。'),
      ),
    )
  }

  const p = d.periods || {}
  const cell = (label, x) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n' }, fmtMoney(x ? x.cost : 0)),
    h('span', { className: 'ming-kpi-l' }, label + ' · ' + fmtTokens(x ? SumTokens(x) : 0) + ' tokens'))

  const rows = (p.all && p.all.models) || []
  return [
    h('div', { key: 'sum', className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '花了多少'),
        h('span', { className: 'ming-sec-n' }, '人民币 · 折算'),
      ),
      h('div', { className: 'ming-kpis' },
        cell('今日（北京）', p.today),
        cell('本月', p.month),
        cell('近 30 天', p.d30),
        cell('全部', p.all),
      ),
    ),

    h('div', { key: 'models', className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '按模型'),
        h('span', { className: 'ming-sec-n' }, rows.length + ' 个'),
      ),
      h('div', { className: 'ming-sec-b flush' },
        h('div', { className: 'ming-list' },
          rows.map((m) => h('div', { key: m.model, className: 'ming-li' },
            // 2026-11-10：这条价是拿谁的公式算的——找不到它的价就借最相似的，名字后面直接写出来
            h('span', {
              className: 'ming-li-t',
              style: { flex: '1 1 auto', minWidth: 0, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              title: m.source ? ('价从这儿来：' + m.source) : '',
            },
              m.model,
              m.from && m.from !== m.model
                ? h('span', { className: 'ming-note', style: { marginLeft: 6, opacity: 0.85, whiteSpace: 'nowrap' } }, '（公式：' + m.from + '）')
                : null),
            m.priced ? null : h('span', { className: 'ming-pill', style: { flex: '0 0 auto' }, 'data-tone': 'warn', title: '价目表里没有这个写法，金额按 0 计；点「索引费用」去网上找一个' }, '未定价'),
            h('span', { className: 'ming-note', style: { flex: '0 0 auto', width: 64, textAlign: 'right', whiteSpace: 'nowrap' } }, m.records + ' 次'),
            h('span', { className: 'ming-note', style: { flex: '0 0 auto', width: 120, textAlign: 'right', whiteSpace: 'nowrap' } }, fmtTokens(SumTokens(m)) + ' tok'),
            h('span', { className: 'ming-li-t', style: { flex: '0 0 auto', width: 84, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }, fmtMoney(m.cost)),
          )),
        ),
      ),
    ),

    h('div', { key: 'basis', className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'ming-note' }, d.basis || ''),
        h('div', { className: 'ming-note' },
          '价目：内置' +
          (d.pricesLayers && d.pricesLayers.auto ? ' + 索引出来的（cost-prices.auto.json）' : '') +
          (d.pricesLayers && d.pricesLayers.manual ? ' + 人工（cost-prices.json，优先级最高）' : ''),
          '　账本：' + (d.ledger || '') + '　读于 ' + String(d.at || '').replace('T', ' ').slice(0, 16)),
      ),
    ),
  ]
}

// ---------------------------------------------------------------------------
