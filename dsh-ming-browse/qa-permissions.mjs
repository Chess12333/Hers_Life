#!/usr/bin/env node
// dsh-ming-browse/qa-permissions.mjs —— H-3 执行前检查的自测
//
// 默认值在 2026-11-17 11:13 由她拍板改成 browse_only（之前是 legacy）。
// 所以这里验的是：**缺省 = 只浏览**、显式 legacy 才放行、只对自主轮次生效。
import { check, classify, normalizePolicy, MODE, KIND } from './lib/permissions.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}
const AUTO = { roundAgentId: 'a1', autonomousAgentId: 'a1' }

// --- 分类 ---
ok('bilibili_search → read', classify('bilibili_search') === KIND.READ)
ok('android_tap → android_action', classify('android_tap') === KIND.ANDROID_ACTION)
ok('android_shutdown → desktop', classify('android_shutdown') === KIND.DESKTOP)
ok('ops_bash → shell', classify('ops_bash') === KIND.SHELL)
ok('qq_send → send', classify('qq_send') === KIND.SEND)
ok('qzone_post → publish', classify('qzone_post') === KIND.PUBLISH)
ok('认不出的工具 → unknown', classify('some_plugin_tool') === KIND.UNKNOWN)

// --- 归一化：默认必须落在 browse_only ---
ok('未配置时归一化成 editable（2026-11-17 17:40 她删了只浏览默认）', normalizePolicy(undefined).mode === MODE.EDITABLE)
ok('空对象 → editable', normalizePolicy({}).mode === MODE.EDITABLE)
ok('乱写的 mode → editable（只浏览必须显式写）', normalizePolicy({ mode: 'readonly' }).mode === MODE.EDITABLE)
ok('显式 legacy 才保留 legacy', normalizePolicy({ mode: 'legacy' }).mode === MODE.LEGACY)
ok('显式 browse_only 照旧', normalizePolicy({ mode: 'browse_only' }).mode === MODE.BROWSE_ONLY)
ok('allow 只留认识的类别', JSON.stringify(normalizePolicy({ allow: ['shell', 'nonsense', 3] }).allow) === JSON.stringify(['shell']))

// --- 1) 缺省（browse_only）在自主轮次：只放 read ---
ok('browse_only：读接口放行',
  check({ mode: 'browse_only' }, { tool: 'bilibili_search', ...AUTO }).ok === true)
ok('browse_only：点按被拒',
  check({ mode: 'browse_only' }, { tool: 'android_tap', ...AUTO }).ok === false)
ok('browse_only：shell 被拒',
  check({ mode: 'browse_only' }, { tool: 'ops_bash', ...AUTO }).ok === false)
ok('browse_only：发消息被拒',
  check({ mode: 'browse_only' }, { tool: 'qq_send', ...AUTO }).ok === false)
ok('browse_only：发布被拒',
  check({ mode: 'browse_only' }, { tool: 'qzone_post', ...AUTO }).ok === false)
ok('browse_only：未分类被拒且有原因',
  (() => { const r = check({ mode: 'browse_only' }, { tool: 'some_plugin_tool', ...AUTO }); return r.ok === false && /没有分类/.test(r.reason) })())

// --- 2) 显式 legacy（她自己选的保留）不拦 ---
for (const t of ['bilibili_search', 'android_tap', 'ops_bash', 'qq_send', 'some_plugin_tool']) {
  ok('显式 legacy 放行 ' + t, check({ mode: 'legacy' }, { tool: t, ...AUTO }).ok === true)
}
ok('显式 legacy 给 skipped 原因',
  check({ mode: 'legacy' }, { tool: 'ops_bash', ...AUTO }).skipped === 'legacy-mode')

// --- 3) 只对自主轮次生效：她正常叫我干活时手是自由的 ---
ok('非自主轮次不拦（缺省也不拦）',
  check({ mode: 'browse_only' }, { tool: 'ops_bash', roundAgentId: 'hello', autonomousAgentId: 'a1' }).ok === true)
ok('非自主轮次给 skipped 原因',
  check({ mode: 'browse_only' }, { tool: 'ops_bash', roundAgentId: 'hello', autonomousAgentId: 'a1' }).skipped === 'not-autonomous-round')
ok('空 ctx 当非自主轮次（不拦）', check({ mode: 'browse_only' }, {}).ok === true)

// --- 4) 显式保留某类授权 ---
ok('allow 里写了 shell 就放行', check({ allow: ['shell'] }, { tool: 'ops_bash', ...AUTO }).ok === true)
ok('allow 不影响别的类别', check({ mode: 'browse_only', allow: ['shell'] }, { tool: 'android_tap', ...AUTO }).ok === false)

// --- 5) 模型自报不算授权 ---
ok('ctx 里自报 trusted 没用',
  check({ mode: 'browse_only' }, { tool: 'ops_bash', roundAgentId: 'hello', autonomousAgentId: 'a1', trusted: true, selfReported: true }).ok === true)

// --- 6) 主体豁免：阑珊可编辑（2026-11-17 11:3x 她补的） ---
ok('默认 subjects 是空表（零配置可迁）', JSON.stringify(normalizePolicy(undefined).subjects) === '{}')
ok('数组写法 → 该主体 editable', normalizePolicy({ subjects: ['linglan'] }).subjects.linglan === MODE.EDITABLE)
ok('对象写法只认 editable',
  (() => { const s = normalizePolicy({ subjects: { linglan: 'editable', other: 'browse_only', bad: 'yes' } }).subjects;
    return s.linglan === MODE.EDITABLE && s.other === undefined && s.bad === undefined })())
ok('subjects 写成字符串 → 忽略（不当名单）', JSON.stringify(normalizePolicy({ subjects: 'linglan' }).subjects) === '{}')
ok('显式写 browse_only 才收紧', normalizePolicy({ mode: 'browse_only' }).mode === MODE.BROWSE_ONLY)

const SUBJ = { mode: 'browse_only', subjects: ['linglan'] }
const subjCtx = (tool) => ({ tool, subject: 'linglan', ...AUTO })
ok('名单内主体：shell 放行', check(SUBJ, subjCtx('ops_bash')).ok === true)
ok('名单内主体：放行带 skipped 原因', check(SUBJ, subjCtx('ops_bash')).skipped === 'subject-editable')
ok('名单内主体：发布类放行', check(SUBJ, subjCtx('qzone_post')).ok === true)
ok('名单内主体：未分类工具也放行', check(SUBJ, subjCtx('some_plugin_tool')).ok === true)
ok('名单内主体：花钱类仍拒', check(SUBJ, subjCtx('pay_checkout')).ok === false)
ok('名单内主体：花钱类给的原因对', /花钱/.test(check(SUBJ, subjCtx('pay_checkout')).reason))
ok('名单外主体：照旧只读', check(SUBJ, { tool: 'ops_bash', subject: 'someone', ...AUTO }).ok === false)
ok('名单外主体：读接口照旧放行', check(SUBJ, { tool: 'bilibili_search', subject: 'someone', ...AUTO }).ok === true)
ok('agent id 也能对上名单', check({ subjects: ['a1'] }, { tool: 'ops_bash', ...AUTO }).ok === true)
ok('模型自报的身份不算（只看 ctx.subject）',
  check(SUBJ, { tool: 'ops_bash', subjectId: 'linglan', selfReported: 'linglan', ...AUTO }).ok === false)
ok('browse_only + 空名单 → 仍只读', check({ mode: 'browse_only' }, subjCtx('ops_bash')).ok === false)

// --- 7) 名单写 QQ 号也能命中（2026-11-17 11:5x 她定的：自己人放行，陌生人只读） ---
// 会话 id 形如 onebot-private-9000000001-mvgpinr5，名单里写号，不该要求背整串。
const OWN = { mode: 'browse_only', subjects: ['9000000001', '9000000002', 'ming-browse'] }
const ownCtx = (sessionId, tool = 'ops_bash') => ({ tool, subject: sessionId, ...AUTO })
ok('名单写 QQ 号：会话 id 里那段对上 → 放行', check(OWN, ownCtx('onebot-private-9000000001-mvgpinr5')).ok === true)
ok('名单写 QQ 号：另一个自己人也放行', check(OWN, ownCtx('onebot-private-9000000002-abc123')).ok === true)
ok('名单写会话名：self 模式的 ming-browse 对上', check(OWN, ownCtx('ming-browse')).ok === true)
ok('不在名单里的号 → 仍只读', check(OWN, ownCtx('onebot-private-999999999-x')).ok === false)
ok('不做子串猜：3737 不该命中 9000000001', check({ mode: 'browse_only', subjects: ['3737'] }, ownCtx('onebot-private-9000000001-x')).ok === false)
ok('自己人也拒花钱类', check(OWN, ownCtx('onebot-private-9000000001-x', 'pay_checkout')).ok === false)
ok('号在 id 中间也认（不要求是固定位置）', check(OWN, ownCtx('session-9000000001-0000-1111')).ok === true)

// --- 7) 容器放行：自由活动不能被自己的闸拦死（2026-11-17 14:37 她定的） ---
ok('run_code 一律放行（容器）', check({ mode: 'browse_only' }, { tool: 'run_code', ...AUTO }).ok === true)
ok('run_code 给 skipped=container', check({ mode: 'browse_only' }, { tool: 'run_code', ...AUTO }).skipped === 'container')
ok('ops_load_sdk 也放行', check({ mode: 'browse_only' }, { tool: 'ops_load_sdk', ...AUTO }).ok === true)
ok('容器放行 ≠ 内层放行：ops_bash 仍拒', check({ mode: 'browse_only' }, { tool: 'ops_bash', ...AUTO }).ok === false)
ok('容器放行不影响别处：qq_send 仍拒', check({ mode: 'browse_only' }, { tool: 'qq_send', ...AUTO }).ok === false)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
