/**
 * dsh-ming-graph —— 记忆关系图（Host 半端）
 *
 * 只读，不算命：把两侧记忆（DSH 归档 notes / QQ-Agent observations）读进来，
 * 自己算成一坨 JSON，经 webServer 路由交给浏览器那半边画。
 * 全程不经过模型。
 *
 * 设计上刻意不做的事：
 *   · 不读 evidence.jsonl（51 MB，读它只是因为报告里要引原文；图上用不着）
 *   · 不给「人和人」连边。11-03 试过按共享词连，连出来的全是噪音
 *     （web_search 401 ↔ WSL 空闲 那种）。这里只在「同一条记忆里一起出现」
 *     这种能核的关系上连边，剩下的用星图表达「有 N 条关于这个人的记忆」。
 */
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as neuronStatic from './neuron.js'
import { fileURLToPath } from 'node:url'
import { mergePeople } from './people-merge.mjs'
// 2026-11-08：top 栏那个 skill 开关的服务端逻辑（清单 + 写 skills-off.json）。
// 单独一个文件是为了能当场 `node skills-lib.test.mjs` 验——index.js 改一次要重启 DSH，重启归她。
import { listSkills, toggleSkill } from './skills-lib.mjs'

const NEURON_FILE = fileURLToPath(new URL('./neuron.js', import.meta.url))
let neuronImpl = null          // 热加载进来的 neuron.js（文件一改就换，不用重启 DSH）
let neuronImplStamp = ''
let neuronLoadError = ''

export const name = 'dsh-ming-graph'

const DEFAULTS = {
  // DSH 侧归档记忆（index.json 可能滞后，notes 目录才是全的，所以扫目录）
  dshMemoryDir: path.join(os.homedir(), '.dsh', 'memory'),
  // QQ-Agent 侧的观察库；留空 = 不读 QQ 侧
  qqObservations: '',
  // 群友档案索引（号码 → 昵称；昵称会改，认人只认号）；留空 = 不读
  peopleIndex: '',
  // 星图中心那个人；留空 = 不特指谁
  ownerId: '',
  ownerName: '我',
  syncSeconds: 120,
  maxPeople: 120,
  maxTopics: 55,
  maxEdges: 160,
  timelineDays: 30,
  // 2026-11-07：统一节点模型的两个来源
  // 记忆卡（星汐写的八章索引）；留空 = 不读，chapter 全为 null
  memoryCard: '',
  // 日记目录；留空 = 不读。只读最近 diaryDays 天
  diaryDir: '',
  diaryDays: 60,
  // 房间名：'group:<群号>' / 'private:<号码>' → 显示名
  // 留空就按号码生成「群 <号>」「私聊 <号>」
  roomLabels: {},
  // 2026-11-08：skill 开关。cwd 决定「按哪个工作区遮」——跟 dsh-ming-skill-isolate 的 root 是同一个意思；
  // offFile 留空就用 <skillsCwd>/skills-off.json，跟那边写的必须是同一个文件，否则开关写了也不生效。
  skillsCwd: process.env.MING_WORKSPACE || 'C:\\dsh\\hers_workplace',
  skillsOffFile: '',
}

// ---------- 本地配置 ----------
// 路径、号码、群名这些跟某台机器绑在一起的值不进仓库。
// 放 ~/.dsh/ming-graph.json（或用环境变量 MING_GRAPH_CONFIG 指一个文件），
// 仓库里只留通用默认。没有这个文件也能跑：只是不读 QQ 侧、不显示昵称。
export function loadLocalConfig(file) {
  const f = file || process.env.MING_GRAPH_CONFIG || path.join(os.homedir(), '.dsh', 'ming-graph.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
const LOCAL = loadLocalConfig()

// 2026-11-07 19:4x：她问「关系图里还有一堆 QQ 号，能不能自动认出来」。
// 群名本机拿不到（config.json 里只有号码），得 QQ 侧调 OneBot 的 get_group_list 写出来。
// 这里读 live/qq-groups.json（形状 { "<群号>": "<群名>", ... } 或 { groups:[{id,name}] }），
// 跟手填的 roomLabels 合并，手填优先。
function loadGroupNames() {
  const out = {}
  // 2026-11-07 22:1x：默认路径不写进仓库（这个仓是公开的）。没配 MING_WORKSPACE 就不读，返回空表。
  const ws = process.env.MING_WORKSPACE || ''
  if (!ws) return out
  const f = path.join(ws, 'live', 'qq-groups.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (Array.isArray(j.groups)) {
      for (const g of j.groups) if (g && g.id && g.name) out['group:' + String(g.id)] = String(g.name)
    } else if (j && typeof j === 'object') {
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === 'string' && /^\d{5,12}$/.test(k)) out['group:' + k] = v
        else if (v && typeof v === 'object' && v.name) out['group:' + k] = String(v.name)
      }
    }
  } catch {}
  return out
}
const GROUP_NAMES = loadGroupNames()

/**
 * 2026-11-07 22:1x：群号不进仓库（这个仓是公开的）。
 *
 * 客户端的「群」分带原来写死三个群号，现在改成从这里下发：本机配置 + live/qq-groups.json 合起来。
 * 仓库里没有号，没配就是空表——视图会把所有群并进「其他群」，布局照旧，不崩。
 */
function withRoomLabels(data, cfg) {
  if (!data || typeof data !== 'object') return data
  return { ...data, roomLabels: { ...GROUP_NAMES, ...((cfg && cfg.roomLabels) || {}) } }
}

const ROUTE = '/_dsh/dsh-ming-graph'

// ---------- 关键词 ----------
// 单字虚词：以它们开头/结尾的双字组合基本都不是主题
const HEAD_STOP = '会在也都还又就才很太更最已将要不没被把给对从到和与而并但或是这那个些类样时地得比如若则'
const TAIL_STOP = '的了着过吗呢吧啊呀嘛'
const TWO_STOP = new Set(('这类 那种 这种 有点 比较 非常 真的 其实 就是 也是 都是 不是 还有 没有 不会 不能 不要 不用 ' +
  '知道 自己 什么 怎么 因为 所以 但是 如果 而且 然后 还是 已经 可以 应该 现在 一下 一点 觉得 感觉 时候 一个 一些 ' +
  '爱用 会用 一句 比如 认为 起哄 里面 之前 之后 一边 一直 一定 一样 这种 几次 好像 似乎 应该 可能 需要 觉得 常用 话爱 会说').split(/\s+/))
const LATIN_STOP = new Set(('the and for with you are not but this that from have was were has had its our your his her they them ' +
  'what when how who why can will would could should may might must http https com www json mjs tmp exe the').split(/\s+/))

const VERB_TAIL = '爱会能想要常好做去来说话看'
const QUANT_HEAD = '条个次份组把点样'
// 以虚词开头、但本身是真词的几个例外（不然「要求」「对话」会被误杀）
const HEAD_EXCEPT = new Set(['要求', '对话', '有趣', '所有', '有些', '时间', '地方', '事件', '被动'])

function keepTerm(t) {
  if (!t) return false
  if (t.length < 2 || t.length > 6) return false
  if (TWO_STOP.has(t)) return false
  if (/^[0-9]+$/.test(t)) return false
  if (/^[A-Za-z]/.test(t)) return !LATIN_STOP.has(t.toLowerCase())
  if (!/[\u4e00-\u9fa5]/.test(t)) return false
  if ([...t].some((ch) => TAIL_STOP.includes(ch))) return false
  // 虚词开头的丢（会直接 / 会追问 / 在群里 / 对机器），两字留几个真词例外
  if (HEAD_STOP.includes(t[0]) && !HEAD_EXCEPT.has(t)) {
    if (t.length >= 3 || t.length === 2) return false
  }
  if (QUANT_HEAD.includes(t[0])) return false
  // 三字里以动词/副词收尾的（说话爱 / 常用）多半是 n-gram 碎片
  if (t.length === 3 && VERB_TAIL.includes(t[2])) return false
  return true
}

function rawTerms(text) {
  const out = new Set()
  if (!text) return out
  for (const m of text.matchAll(/[“"「『]([^”"」』]{2,16})[”"」』]/g)) out.add(m[1].trim())
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_\-.#+]{1,}/g)) out.add(m[0])
  const cjk = text.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const chunk of cjk.split(/\s+/)) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= chunk.length; i++) out.add(chunk.slice(i, i + n))
    }
  }
  return out
}

function pickTerms(docs, { minDf = 3, maxDf = 0.45, limit = 70 } = {}) {
  const df = new Map()
  const form = new Map() // 小写 → 首次出现的样子（QQ / qq 归一）
  const perDoc = []
  for (const text of docs) {
    const set = new Set([...rawTerms(text)].filter(keepTerm))
    perDoc.push(set)
    for (const t of set) {
      const key = t.toLowerCase()
      if (!form.has(key)) form.set(key, t)
      df.set(key, (df.get(key) || 0) + 1)
    }
  }
  const N = docs.length || 1
  const cap = Math.max(minDf, Math.floor(N * maxDf))
  // 长词优先：短词被更长的词包含、且频次接近，就丢（机器 / 器人 / 机器人）
  const cands = [...df.entries()].filter(([t, c]) => c >= minDf && c <= cap)
  const drop = new Set()
  for (const [a, ca] of cands) {
    if (drop.has(a)) continue
    for (const [b, cb] of cands) {
      if (b === a || b.length <= a.length || !b.includes(a)) continue
      if (cb >= ca * 0.6) { drop.add(a); break }
    }
  }
  const kept = cands.filter(([t]) => !drop.has(t)).sort((x, y) => y[1] - x[1]).slice(0, limit)
  const terms = kept.map(([key, count]) => ({ term: form.get(key) || key, key, count, idf: Math.round(Math.log(N / count) * 100) / 100 }))
  return { terms, perDoc }
}

function coOccur(perDoc, terms, maxEdges) {
  const wanted = new Map(terms.map((t) => [t.key || t.term.toLowerCase(), t]))
  const pair = new Map()
  for (const doc of perDoc) {
    const hit = [...doc].map((t) => t.toLowerCase()).filter((t) => wanted.has(t))
    for (let i = 0; i < hit.length; i++) {
      for (let j = i + 1; j < hit.length; j++) {
        // 父子关系不是关联（说话 / 说话简短）
        if (hit[i].includes(hit[j]) || hit[j].includes(hit[i])) continue
        const k = hit[i] < hit[j] ? hit[i] + '\u0000' + hit[j] : hit[j] + '\u0000' + hit[i]
        pair.set(k, (pair.get(k) || 0) + 1)
      }
    }
  }
  const rows = [...pair.entries()]
    .map(([k, n]) => {
      const [ka, kb] = k.split('\u0000')
      const a = wanted.get(ka), b = wanted.get(kb)
      return { a: a.term, b: b.term, w: n, score: n * Math.min(a.idf || 1, b.idf || 1) }
    })
    .filter((e) => e.w >= 2)
    .sort((x, y) => y.score - x.score)
    .slice(0, maxEdges)
  return rows.map(({ a, b, w: n }) => ({ a, b, w: n }))
}

// ---------- 读 ----------
// 老笔记没有 frontmatter.created，但文件名是 20261020-123127-xxx
function dateFromId(s) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(s || ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : ''
}

function parseFront(text) {  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (!k) continue
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    }
    out[k] = v
  }
  return out
}

async function readDsh(cfg) {
  const notesDir = path.join(cfg.dshMemoryDir, 'notes')
  const files = (await fs.readdir(notesDir)).filter((f) => f.endsWith('.md'))
  const notes = []
  const chunk = 40
  for (let i = 0; i < files.length; i += chunk) {
    const batch = await Promise.all(files.slice(i, i + chunk).map(async (f) => {
      try {
        const txt = await fs.readFile(path.join(notesDir, f), 'utf8')
        const fm = parseFront(txt)
        const tags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        return {
          id: String(fm.id || f.replace(/\.md$/, '')),
          title: String(fm.title || f.replace(/\.md$/, '')),
          tags,
          created: fm.created || fm.last_confirmed || dateFromId(fm.id || f),
          status: fm.status || 'active',
          source: fm.source || '',
        }
      } catch { return null }
    }))
    for (const n of batch) if (n) notes.push(n)
  }
  return notes
}

async function readQQ(cfg) {
  if (!cfg.qqObservations) return []
  let raw
  try { raw = await fs.readFile(cfg.qqObservations, 'utf8') } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o && o.t === 'obs') out.push(o)
    } catch { /* 坏行跳过 */ }
  }
  return out
}

async function readPeople(cfg) {
  try {
    const j = JSON.parse(await fs.readFile(cfg.peopleIndex, 'utf8'))
    const map = new Map()
    for (const [id, arr] of Object.entries(j.byId || {})) {
      if (arr && arr[0] && arr[0].name) map.set(id, arr[0].name)
    }
    return map
  } catch { return new Map() }
}

// ---------- 算 ----------
const dayOf = (ms) => {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 时间戳或 ISO 串都能吃
function dayOfValue(v) {
  if (typeof v === 'number') return dayOf(v)
  const s = String(v || '')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  if (/^\d{10,}$/.test(s)) return dayOf(Number(s))
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : dayOf(t)
}

function build(cfg, { dsh, qq, names }) {
  const now = Date.now()

  // ---- QQ：人 + 房间 ----
  const people = new Map()
  const rooms = new Map()
  for (const o of qq) {
    const sid = String(o.subjectId ?? '')
    if (!sid || sid === 'undefined' || sid === 'null') continue
    if (o.status && o.status !== 'active') continue
    const room = String(o.chatKey || (o.scope === 'global' ? 'global' : '?'))
    const p = people.get(sid) || { id: sid, name: names.get(sid) || '', count: 0, rooms: new Map(), types: {}, lastAt: 0, claims: [] }
    p.count++
    p.rooms.set(room, (p.rooms.get(room) || 0) + 1)
    p.types[o.type || '?'] = (p.types[o.type || '?'] || 0) + 1
    const at = Number(o.at || o.createdAt || 0)
    if (at > p.lastAt) p.lastAt = at
    if (o.claim && p.claims.length < 4) p.claims.push(String(o.claim).slice(0, 160))
    people.set(sid, p)

    const r = rooms.get(room) || { key: room, count: 0, people: new Set() }
    r.count++
    r.people.add(sid)
    rooms.set(room, r)
  }

  const peopleList = [...people.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, cfg.maxPeople)
    .map((p) => ({
      id: p.id,
      name: p.name || p.id,
      isOwner: p.id === String(cfg.ownerId),
      count: p.count,
      rooms: [...p.rooms.entries()].map(([key, count]) => ({ key, label: (cfg.roomLabels[key] || GROUP_NAMES[key] || key), count })).sort((a, b) => b.count - a.count),
      types: p.types,
      lastAt: p.lastAt,
      claims: p.claims,
    }))

  const roomList = [...rooms.values()]
    .map((r) => ({
      key: r.key,
      label: (cfg.roomLabels[r.key] || GROUP_NAMES[r.key] || (r.key.startsWith('group:') ? '群 ' + r.key.slice(6) : r.key === 'global' ? '全局' : r.key.replace(/^private:/, ''))),
      kind: r.key.startsWith('group:') ? 'group' : r.key === 'global' ? 'global' : 'private',
      count: r.count,
      people: r.people.size,
    }))
    .sort((a, b) => b.count - a.count)

  // ---- 主题（QQ claim 与 DSH title/tags 分开算，别串味） ----
  const qqDocs = qq.filter((o) => o.claim && (!o.status || o.status === 'active')).map((o) => String(o.claim))
  const qqTopics = pickTerms(qqDocs, { minDf: 3, limit: cfg.maxTopics })
  const dshDocs = dsh.filter((n) => n.status === 'active').map((n) => `${n.title} ${(n.tags || []).join(' ')}`)
  const dshTopics = pickTerms(dshDocs, { minDf: 2, maxDf: 0.5, limit: 30 })

  const topics = [
    ...qqTopics.terms.map((t) => ({ ...t, source: 'qq', label: t.term })),
    ...dshTopics.terms.map((t) => ({ ...t, source: 'dsh', label: t.term })),
  ]

  const qqEdges = coOccur(qqTopics.perDoc, qqTopics.terms, cfg.maxEdges).map((e) => ({ ...e, source: 'qq' }))
  const dshEdges = coOccur(dshTopics.perDoc, dshTopics.terms, Math.floor(cfg.maxEdges / 2)).map((e) => ({ ...e, source: 'dsh' }))

  // ---- DSH 的 tag 频次（结构化，比词频干净） ----
  const tagCount = new Map()
  for (const n of dsh) {
    if (n.status !== 'active') continue
    for (const t of n.tags || []) {
      if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) continue
      const key = t.toLowerCase()
      const cur = tagCount.get(key) || { tag: t, count: 0 }
      cur.count++
      tagCount.set(key, cur)
    }
  }
  const tags = [...tagCount.values()].sort((a, b) => b.count - a.count).slice(0, 40)

  // ---- 时间线 ----
  const tl = new Map()
  const bump = (day, k) => { if (!day) return; const r = tl.get(day) || { date: day, qq: 0, dsh: 0 }; r[k]++; tl.set(day, r) }
  for (const o of qq) bump(dayOfValue(Number(o.at || o.createdAt || 0)), 'qq')
  for (const n of dsh) bump(dayOfValue(n.created), 'dsh')
  const timeline = [...tl.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-cfg.timelineDays)

  // ---- 星图：溟 与每个人 ----
  const center = { id: 'ming', name: '溟', count: peopleList.filter((p) => !p.isOwner).reduce((s, p) => s + p.count, 0) }
  const spokes = peopleList.filter((p) => !p.isOwner).map((p) => ({ a: 'ming', b: p.id, w: p.count }))

  return {
    generatedAt: now,
    sources: {
      qq: { count: qq.length, active: qq.filter((o) => !o.status || o.status === 'active').length },
      dsh: { count: dsh.length, active: dsh.filter((n) => n.status === 'active').length },
    },
    center,
    people: peopleList,
    rooms: roomList,
    topics,
    edges: [...qqEdges, ...dshEdges],
    tags,
    timeline,
    spokes,
  }
}

export const __internals = { build, readDsh, readQQ, readPeople, DEFAULTS }

// ---------- 服务 ----------
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...LOCAL, ...(config || {}) }
  // 2026-11-08：skill 清单来自宿主自己的 skills 服务——跟模型看到的是同一份合并结果，
  // 插件包里自带的那几十个也在里面（自己扫 ~/.dsh/skills 只能看见一半）。
  // 服务没挂上就是 null，listSkills 会自动退回磁盘扫描，不影响开关本身。
  let skillsService = null
  try {
    ctx.inject(['skills'], (c) => { skillsService = c.skills })
  } catch { /* 没这个服务也能跑，只是清单短一点 */ }
  let cache = null
  let cacheKey = ''
  let building = null
  let lastError = ''
  // 「记忆神经元」那套（每条记忆一个点、每条边带 why）单独一份缓存，跟上面那张关系图互不影响
  let nCache = null
  let nKey = ''
  let nBuilding = null

  const stamp = async (file) => {
    try { const s = await fs.stat(file); return `${s.mtimeMs}:${s.size}` } catch { return 'x' }
  }

  async function keyNow() {
    const parts = [await stamp(path.join(cfg.dshMemoryDir, 'notes'))]
    if (cfg.qqObservations) parts.push(await stamp(cfg.qqObservations))
    if (cfg.peopleIndex) parts.push(await stamp(cfg.peopleIndex))
    return parts.join('|')
  }

  async function snapshot() {
    const key = await keyNow()
    if (cache && key === cacheKey) return cache
    if (building) return building
    building = (async () => {
      try {
        const [dsh, qq, names] = await Promise.all([readDsh(cfg), readQQ(cfg), readPeople(cfg)])
        cache = build(cfg, { dsh, qq, names })
        cacheKey = key
        lastError = ''
      } catch (err) {
        lastError = String((err && err.message) || err)
        if (!cache) cache = { generatedAt: 0, error: lastError, sources: {}, people: [], rooms: [], topics: [], edges: [], tags: [], timeline: [], spokes: [], center: { id: 'ming', name: '溟', count: 0 } }
      } finally {
        building = null
      }
      return cache
    })()
    return building
  }

  async function neuronKeyNow() {
    // neuron.js 自己也进缓存键：改了源码，下一次刷新就会加载新模块（不用重启 DSH）
    // 召回声账本也得进键：不进的话，热度只在 notes 变动时才重算，平时看着像冻住了
    return [await stamp(cfg.qqObservations), await stamp(path.join(cfg.dshMemoryDir, 'notes')),
      await stamp(path.join(cfg.dshMemoryDir, 'recall-log.jsonl')),
      await stamp(NEURON_FILE)].join('|')
  }

  async function loadNeuronImpl(stampKey) {
    if (neuronImpl && neuronImplStamp === stampKey) return neuronImpl
    try {
      const u = new URL('./neuron.js', import.meta.url)
      u.searchParams.set('v', encodeURIComponent(stampKey).slice(0, 80))
      const m = await import(u.href)
      if (m && typeof m.buildNeuron === 'function') {
        neuronImpl = m
        neuronImplStamp = stampKey
        neuronLoadError = ''
        return m
      }
      neuronLoadError = 'neuron.js 没有导出 buildNeuron'
    } catch (err) {
      neuronLoadError = String((err && err.message) || err)
    }
    return neuronStatic
  }

  async function neuronSnapshot() {
    const key = await neuronKeyNow()
    if (nCache && key === nKey) return nCache
    if (nBuilding) return nBuilding
    nBuilding = (async () => {
      try {
        const impl = await loadNeuronImpl(key)
        const [dsh, qq, names] = await Promise.all([impl.readDshNotes(cfg.dshMemoryDir), impl.readQqObservations(cfg.qqObservations), readPeople(cfg)])
        nCache = mergePeople(impl.buildNeuron({ dsh, qq, cfg, names }))
        if (neuronLoadError) nCache.neuronLoadError = neuronLoadError
        // 自查用：每次算完把当前图落一份（覆盖写）。出了「图上还是旧样子」这种事，
        // 别再靠猜——读这份就知道面板拿到的是什么。
        try {
          const dump = path.join(os.tmpdir(), 'ming-graph-now.json')
          fs.writeFile(dump, JSON.stringify(nCache)).catch(() => {})
          nCache.dumpedTo = dump
        } catch {}
        nKey = key
      } catch (err) {
        if (!nCache) nCache = { generatedAt: 0, error: String((err && err.message) || err), stats: {}, nodes: [], edges: [] }
      } finally {
        nBuilding = null
      }
      return nCache
    })()
    return nBuilding
  }

  // ---------- 统一节点模型（2026-11-07） ----------
  // 两个视图（神经元 / 星图）共用一份节点。这里只做「把三样东西拼起来」：
  // buildNeuron 的结果 + 记忆卡（八章索引，可能不存在）+ 日记（时间星带）。
  // 记忆卡不在就 chapter=null，不编——她说的「疑似真相源」落在这一行上。
  async function readDiaries(dir, days) {
    if (!dir) return []
    const out = []
    const since = Date.now() - Math.max(1, days || 60) * 86400000
    let list = []
    try { list = await fs.readdir(dir) } catch { return [] }
    for (const f of list) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
      if (!m) continue
      const at = Date.parse(m[1] + 'T00:00:00+08:00')
      if (!(at >= since)) continue
      let body = ''
      try { body = await fs.readFile(path.join(dir, f), 'utf8') } catch { continue }
      out.push({ date: m[1], title: m[1], at, body: body.slice(0, 4000) })
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1))
    return out
  }

  let uCache = null
  let uKey = ''
  async function unifiedSnapshot() {
    const base = await neuronSnapshot()
    const key = nKey + '|' + cfg.memoryCard + '|' + cfg.diaryDir + '|' + (base.generatedAt || 0)
    if (uCache && key === uKey) return uCache
    let card = ''
    if (cfg.memoryCard) { try { card = await fs.readFile(cfg.memoryCard, 'utf8') } catch {} }
    const diaries = await readDiaries(cfg.diaryDir, cfg.diaryDays)
    const impl = await loadNeuronImpl(nKey)
    const build = (impl && impl.buildUnified) || neuronStatic.buildUnified
    if (typeof build !== 'function') {
      return { ...base, stats: { ...(base.stats || {}), unifiedError: 'buildUnified 不可用（neuron.js 没导出）' } }
    }
    uCache = build(base, { card, diaries })
    uCache.generatedAt = base.generatedAt || 0
    uCache.neuronLoadError = base.neuronLoadError || ''
    uKey = key
    return uCache
  }

  const respond = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            if (webCtx.connection && typeof webCtx.connection.requestRejection === 'function') {
              const rejection = webCtx.connection.requestRejection(req)
              if (rejection !== undefined) { respond(res, rejection || 403, { error: 'rejected' }); return }
            }
            const url = new URL(req.url || '/', 'http://localhost')
            if (!url.pathname.startsWith(ROUTE)) { respond(res, 404, { error: 'not found' }); return }
            const method = url.pathname.slice(ROUTE.length).replace(/^\//, '')
            if (method === '' || method === 'snapshot') {
              const snap = await snapshot()
              respond(res, 200, snap)
              return
            }
            if (method === 'refresh') {
              cacheKey = ''
              const snap = await snapshot()
              respond(res, 200, snap)
              return
            }
            if (method === 'neurons' || method === 'neurons/refresh') {
              if (method === 'neurons/refresh') { nKey = ''; nCache = null; neuronImpl = null; neuronImplStamp = '' }
              respond(res, 200, withRoomLabels(await neuronSnapshot(), cfg))
              return
            }
            if (method === 'neurons/unified' || method === 'neurons/unified/refresh') {
              if (method.endsWith('/refresh')) { nKey = ''; nCache = null; uCache = null; uKey = ''; neuronImpl = null; neuronImplStamp = '' }
              respond(res, 200, withRoomLabels(await unifiedSnapshot(), cfg))
              return
            }
            if (method === 'skills' || method === 'skills/refresh') {
              respond(res, 200, await listSkills({
                cwd: cfg.skillsCwd,
                offFile: cfg.skillsOffFile,
                service: skillsService,
              }))
              return
            }
            if (method === 'skills/toggle') {
              if (req.method !== 'POST') { respond(res, 405, { ok: false, error: 'toggle 要 POST' }); return }
              const name = url.searchParams.get('name') || ''
              const onRaw = String(url.searchParams.get('on') || '').toLowerCase()
              const on = onRaw === '1' || onRaw === 'true' || onRaw === 'on'
              respond(res, 200, await toggleSkill(name, on, {
                cwd: cfg.skillsCwd,
                offFile: cfg.skillsOffFile,
                service: skillsService,
              }))
              return
            }
            respond(res, 404, { error: 'unknown method ' + method })
          } catch (err) {
            respond(res, 500, { error: String((err && err.message) || err) })
          }
        },
      })
      return dispose
    })
  })

  // 定时重扫：本地文件变了就重算，没变直接命中缓存
  ctx.effect(() => {
    const every = Math.max(15, Number(cfg.syncSeconds) || 120) * 1000
    const timer = setInterval(() => { snapshot().catch(() => {}) }, every)
    snapshot().catch(() => {})
    return () => clearInterval(timer)
  })
}
