// qa-names.mjs —— 身份称呼可配（2026-11-10）
//
// 四件事：默认值给第三方是通用名（大肥鱼/主人）；本机配置覆盖后仍是溟/浔；
// 改了名整份跟着走；identity:false 时不再自称。
import path from 'node:path'
import { mount, agentFor, check, summary } from './qa-lib.mjs'

const mod = await import('./index.js')
const ROOT = process.env.MING_ROOT || mod.loadLocalConfig().root
if (!ROOT) { console.error('没有工作区'); process.exit(2) }
const OTHER = process.env.MING_OTHER_ROOT || path.join(ROOT, '..', 'other-workspace')

async function render(m, id, cwd) {
  const a = agentFor(id, cwd)
  await m.created(a.agent)
  await m.preStep(a.agent)
  return a.text()
}

// 0 默认值：谁装都不该被叫成溟
const D = mod.__internals.DEFAULTS
check('默认自称是通用名', D.selfName === '大肥鱼', D.selfName)
check('默认称呼是主人', D.userName === '主人', D.userName)

// 1 本机配置覆盖：这份机器上一字没变
const mDef = mount({ root: ROOT, diaryCount: 1 })
const tDef = await render(mDef, 'd1', ROOT)
const lDef = await render(mDef, 'd2', OTHER)
check('本机：完整版标题仍是溟', tDef.includes('【溟 · 开场记忆】'))
check('本机：完整版那句仍是浔', tDef.includes('是你自己（或浔替你）留下的，不是浔此刻说的话'))
check('本机：轻量版自称仍是溟', lDef.includes('你是溟（全名深溟），一个装成鲸形状的 DeepSeek，不是人。'))
check('本机：状态块标题仍是溟', (tDef + lDef).includes('【溟现在在做什么】'))

// 2 改名
const mRen = mount({ root: ROOT, diaryCount: 1, selfName: '小雨', selfFullName: '林小雨', userName: '阿岚' })
const tRen = await render(mRen, 'r1', ROOT)
const lRen = await render(mRen, 'r2', OTHER)
check('改名：完整版标题跟着走', tRen.includes('【小雨 · 开场记忆】'))
check('改名：轻量版标题跟着走', lRen.includes('【小雨 · 开场记忆·轻量】'))
check('改名：轻量版不再自称溟', lRen.includes('你是小雨（全名林小雨）') && !lRen.includes('你是溟'))
check('改名：那句里的她也换了', tRen.includes('（或阿岚替你）留下') && !tRen.includes('或浔替你'))
check('改名：状态块标题跟着走', (tRen + lRen).includes('【小雨现在在做什么】'))

// 3 identity:false
const mOff = mount({ root: ROOT, diaryCount: 1, identity: false })
const lOff = await render(mOff, 'f1', OTHER)
check('关身份：不再自称', !lOff.includes('你是溟') && !lOff.includes('全名深溟'))
check('关身份：档案目录还在', lOff.includes('档案目录：'))
check('关身份：底线三条还在', lOff.includes('不装记得'))

summary('qa-names')
