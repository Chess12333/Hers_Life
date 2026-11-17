// dsh-ming-browse/lib/permissions.mjs —— H-3 执行前检查（纯函数，不认识宿主）
//
// 交接书 H.5 的三条要求，这个文件只落前两条的实现：
//   ① 执行前按**类别**检查，不是按按钮文字；
//   ② 授权由**可信上下文**携带——「这轮是不是自主轮次」由调用方从宿主拿，
//      绝不从模型参数、session 名字或提示词里读；
//   ③ 默认值由她拍板：2026-11-17 11:13 她说「permissionPolicy 默认值用 browse_only」，
//      所以缺省（含乱写的值）一律归一化成 BROWSE_ONLY；LEGACY 只有**显式写**才生效，
//      那是她自己选择保留原来的手（fail-closed，不是 fail-open）。
//   ④ 主体豁免（2026-11-17 11:3x 她补的「阑珊可以是可编辑」）：默认仍是 browse_only，
//      只给 subjects 名单里的主体开 EDITABLE（可写 / 可执行），其它自主轮次照旧只读；
//      名单空着 = 与加这条之前一模一样。花钱类（PAY）在任何模式下都不放。
//
// 它不做的事：不读配置文件、不碰 exec/ctx 对象、不判断该不该发消息。
// 那些留给调用方，因为它知道宿主给了什么，而这个地方必须能单独跑测试。

export const MODE = { LEGACY: 'legacy', BROWSE_ONLY: 'browse_only', EDITABLE: 'editable' }

export const KIND = {
  READ: 'read',
  ANDROID_ACTION: 'android_action',
  SHELL: 'shell',
  BROWSER: 'browser',
  DESKTOP: 'desktop',
  SEND: 'send',
  PUBLISH: 'publish',
  PAY: 'pay',
  UNKNOWN: 'unknown',
}

// 工具名 → 类别。只收这台机器上真装了的；写进来的每一条都要能被一次真调用对上，
// 对不上就删掉——多一条没人验证的分类，等于给「只读」这个说法掺水。
const RULES = [
  [/^(bilibili_|bili_)/i, KIND.READ],
  [/^(web_search|web_fetch|page_text)$/i, KIND.READ],
  [/^(android_get|android_list|android_devices|android_screenshot)/i, KIND.READ],
  [/^(android_tap|android_interact)/i, KIND.ANDROID_ACTION],
  [/^(android_shutdown|android_boot|android_build_run)/i, KIND.DESKTOP],
  [/^(ops_bash|bash|shell|exec_command)/i, KIND.SHELL],
  [/^(pet_input|cv_act|coach_click|coach_key|coach_drive|coach_execute)$/i, KIND.DESKTOP],
  [/^(qq_send|qq_send_voice|astrbot_send|send_message|ming_delegate)$/i, KIND.SEND],
  [/^(qzone_post|bilibili_comment_post|bilibili_like|bilibili_coin|bilibili_follow)/i, KIND.PUBLISH],
  [/^(pay|purchase|checkout)/i, KIND.PAY],
]

/** 工具名归类；认不出就 UNKNOWN（不猜）。 */
export function classify(tool) {
  const name = String(tool || '')
  for (const [re, kind] of RULES) if (re.test(name)) return kind
  return KIND.UNKNOWN
}

/**
 * 配置归一化。
 *   mode     —— 只有显式写 legacy 才是 legacy；缺省 / 认不出（包括误写的 editable）都是 browse_only。
 *   allow    —— 整轮放行的类别（连花钱类一起放，所以要显式写）。
 *   subjects —— 主体豁免名单 { '<主体标识>': 'editable' }：默认 browse_only 不动，只给名单里的主体
 *               开可写 / 可执行（2026-11-17 11:3x 她说的「阑珊可以是可编辑」）。
 *               名单为空 = 和加这条之前完全一样（零配置可迁）。
 */
export function normalizePolicy(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  // 缺省 / 认不出的值都走 browse_only（2026-11-17 她拍板）；legacy 必须显式写。
  const mode = p.mode === MODE.LEGACY ? MODE.LEGACY : MODE.BROWSE_ONLY
  const allow = Array.isArray(p.allow)
    ? p.allow.filter((x) => typeof x === 'string' && Object.values(KIND).includes(x))
    : []
  const subjects = {}
  const put = (id, value) => {
    const key = typeof id === 'string' ? id.trim() : ''
    // 只认 editable 这一个值；写别的（含拼错的）一律忽略——忽略等于按默认收紧。
    if (key && value === MODE.EDITABLE) subjects[key] = MODE.EDITABLE
  }
  if (Array.isArray(p.subjects)) for (const id of p.subjects) put(id, MODE.EDITABLE)
  else if (p.subjects && typeof p.subjects === 'object') {
    for (const [id, value] of Object.entries(p.subjects)) put(id, value)
  }
  return { mode, allow, subjects }
}

/**
 * 执行前判定。
 * ctx: { tool, roundAgentId, autonomousAgentId }
 *   roundAgentId      —— 宿主说这一轮是哪个 agent 发起的（不是模型说的）
 *   autonomousAgentId —— browse 自己那轮闲逛的 agent id（guarded）
 * 返回 { ok, reason?, skipped? }
 */
export function check(policy, ctx) {
  const p = normalizePolicy(policy)
  const c = ctx && typeof ctx === 'object' ? ctx : {}
  // 只对自主轮次生效：她正常叫我干活时，手该是自由的（与 pre-execute 原有的 guarded 判据一致）。
  if (!c.roundAgentId || !c.autonomousAgentId || c.roundAgentId !== c.autonomousAgentId) {
    return { ok: true, reason: '', skipped: 'not-autonomous-round' }
  }

  // 2026-11-17 14:37 她定的：**这道闸不许拦自由活动本身**（原话「再有这种问题就直接开吧，
  // 自由活动是怎么都不能被拦截的」）。宿主容器只是入口、不是动作，一律放行：
  //   run_code     —— 我唯一能直接调的工具，所有工具都从它里面调；它一被拒，整轮连读文件都进不去
  //   ops_load_sdk —— 只把接口装进 SDK，不碰任何数据
  // 代价写在明处：若宿主的内层调用不过 pre-execute，这一条就等于放开整轮。那时兜底的不是这个文件，
  // 而是 index.js 里的 checkTap / tapTextDeny（花钱按钮、关手机、社交平台写操作）。宁可放开，也不许空转。
  const CONTAINER = new Set(['run_code', 'ops_load_sdk'])
  if (CONTAINER.has(String(c.tool || ''))) return { ok: true, reason: '', skipped: 'container' }
  if (p.mode === MODE.LEGACY) return { ok: true, reason: '', skipped: 'legacy-mode' }

  // 主体豁免：标识只从宿主给的可信上下文取（subject = 会话 id，roundAgentId = 宿主给的 agent id），
  // 不看模型自报。名单里的主体可写 / 可执行，但花钱类永远不在此列。
  const keys = [c.subject, c.roundAgentId]
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => String(x).trim())
  // 2026-11-17 11:5x 她定的边界：browse_only 只管**没有 DSH 远端调用权的**主体；
  // 她、溟、阑珊都是自己人，放行。名单里写 QQ 号也行——会话 id 长这样：
  //   onebot-private-9000000001-mvgpinr5 / ming-browse / session-<uuid>
  // 判据：整串相等，或按 - _ : . 切开后某一段相等。不做子串猜（"3737" 不该命中 "37371"）。
  const named = (key) => {
    if (p.subjects[key] === MODE.EDITABLE) return true
    const parts = String(key).split(/[-_:.]/)
    return Object.keys(p.subjects).some((id) => parts.includes(id))
  }
  if (keys.some(named)) {
    if (classify(c.tool) === KIND.PAY) return { ok: false, reason: '可编辑模式也不含花钱类动作' }
    return { ok: true, reason: '', skipped: 'subject-editable' }
  }

  const kind = classify(c.tool)
  if (kind === KIND.READ) return { ok: true, reason: '' }
  if (p.allow.includes(kind)) return { ok: true, reason: '' }
  if (kind === KIND.UNKNOWN) {
    return { ok: false, reason: '只浏览模式：' + String(c.tool || '(空工具名)') + ' 没有分类，不放行' }
  }
  return { ok: false, reason: '只浏览模式：' + kind + ' 类动作这一轮不做' }
}
