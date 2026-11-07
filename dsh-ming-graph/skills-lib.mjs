/**
 * skills-lib.mjs —— 「她的一生」top 栏那个 skill 开关的服务端逻辑（2026-11-08 写）
 *
 * 为什么单独一个文件，不直接写进 index.js：
 *   index.js 的改动只有重启 DSH 才生效，重启归她，我不能自己按。
 *   拆出来之后 `node skills-lib.test.mjs` 能当场拿真数据跑一遍——不靠重启验证。
 *
 * 两件事：
 *   1) 清单：以 ctx.skills.list() 为准。那是模型看到的同一份合并结果，
 *      插件包里自带的那几十个（dsh-plugin-dev / cordis-* 那些）也在里面；
 *      自己扫目录只能看见 ~/.dsh/skills，会漏一大半，所以扫描只当兜底 + 补描述。
 *   2) 开关：写 skills-off.json。dsh-ming-skill-isolate 每次 list() 都重读这个文件，
 *      所以两边谁写的都算数，不需要跨插件调用。
 *
 * 一条纪律：开关状态只认那个文件，不认服务返回的 invocation。
 *   遮罩条目的 rank 是 1，赢了真正的 skill，描述会被换成「（本工作区已隔离…）」——
 *   拿它当状态来源，关了哪几个就看不出来了。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const MASK_PROVIDER = 'ming-skill-isolate'

const DEFAULTS = {
  cwd: 'C:\\dsh\\hers_workplace',
  offFile: '',
  roots: [],
}

function normalize(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const cwd = typeof o.cwd === 'string' && o.cwd.trim() ? path.resolve(o.cwd) : DEFAULTS.cwd
  const offFile = typeof o.offFile === 'string' && o.offFile.trim()
    ? path.resolve(o.offFile)
    : path.join(cwd, 'skills-off.json')
  const roots = Array.isArray(o.roots) && o.roots.length
    ? o.roots.filter((r) => typeof r === 'string' && r.trim())
    : [
      path.join(os.homedir(), '.dsh', 'skills'),
      path.join(os.homedir(), '.agents', 'skills'),
      path.join(cwd, '.dsh', 'skills'),
      path.join(cwd, '.agents', 'skills'),
    ]
  return { cwd, offFile, roots }
}

export async function readOff(offFile) {
  try {
    const raw = await fs.readFile(offFile, 'utf8')
    const j = JSON.parse(raw)
    const off = Array.isArray(j && j.off) ? j.off.filter((n) => typeof n === 'string') : []
    const note = j && typeof j.note === 'string' ? j.note : ''
    return { off, note }
  } catch {
    // 文件不存在 / 坏掉都当「一个都没关」。这里不抛：面板读不到清单比读不到状态更糟。
    return { off: [], note: '' }
  }
}

export async function writeOff(offFile, state) {
  await fs.mkdir(path.dirname(offFile), { recursive: true })
  const body = JSON.stringify({ off: [...new Set(state.off)].sort(), note: state.note || '' }, null, 2) + '\n'
  const tmp = offFile + '.tmp'
  await fs.writeFile(tmp, body, 'utf8')
  await fs.rename(tmp, offFile)
}

/** 从 SKILL.md 头部的 YAML 片段里抠 name / description（只认这两行，不引 yaml 库） */
export function parseFrontmatter(text) {
  const out = { name: '', description: '' }
  if (typeof text !== 'string' || !text.startsWith('---')) return out
  const end = text.indexOf('\n---', 3)
  const head = text.slice(3, end < 0 ? Math.min(text.length, 4000) : end)
  const lines = head.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^(name|description)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (val === '|' || val === '>' || val === '') {
      // 块状写法：往下收缩进行，收到顶格为止
      const buf = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j])) buf.push(lines[j].trim())
        else if (lines[j].trim() === '') buf.push('')
        else break
      }
      val = buf.join(' ').replace(/\s+/g, ' ').trim()
    }
    if (val.length > 1 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) val = val.slice(1, -1)
    out[key] = val
  }
  return out
}

async function scanDisk(roots) {
  const found = new Map()
  for (const root of roots) {
    let names = []
    try { names = await fs.readdir(root, { withFileTypes: true }) } catch { continue }
    for (const d of names) {
      if (!d.isDirectory()) continue
      const file = path.join(root, d.name, 'SKILL.md')
      let text = ''
      try { text = await fs.readFile(file, 'utf8') } catch { continue }
      const fm = parseFrontmatter(text)
      const name = fm.name || d.name
      if (!name || found.has(name)) continue
      found.set(name, { name, desc: fm.description || '', path: file, source: 'disk' })
    }
  }
  return found
}

/**
 * 清单：服务优先，磁盘补描述。
 * 服务里被遮罩的那几条（provider=ming-skill-isolate）不算描述来源，名字照收。
 */
export async function listSkills(opts) {
  const { cwd, offFile, roots } = normalize(opts)
  const service = opts && opts.service
  const state = await readOff(offFile)
  const offSet = new Set(state.off)
  const rows = new Map()
  let sourceName = 'disk'
  let error = ''
  // 遮罩条目自带的说明，收到就藏起来——它对「要不要开回来」没用
  const masked = new Set()

  if (service && typeof service.list === 'function') {
    try {
      const list = await service.list({ cwd })
      for (const s of Array.isArray(list) ? list : []) {
        if (!s || typeof s.name !== 'string' || !s.name) continue
        if (s.provider === MASK_PROVIDER) { masked.add(s.name); continue }
        rows.set(s.name, {
          name: s.name,
          desc: s.description || '',
          source: s.source || '',
          provider: s.provider || '',
          path: (s.path && String(s.path)) || '',
        })
      }
      sourceName = 'service'
    } catch (e) {
      error = '读 skill 服务失败：' + String((e && e.message) || e)
    }
  }

  const disk = await scanDisk(roots)

  if (sourceName === 'service') {
    // 服务是真的：清单就以它为准。
    // 磁盘只补两处——① 被遮罩的那几个（服务里只剩一条假条目，真描述被压掉了）；
    // ② 文件里关了、但服务里已经看不见的名字（下面 orphan 那段统一处理）。
    // 不把磁盘上多出来的名字塞进来：模型看不见的 skill 列在面板上，只会让人以为开关坏了。
    for (const name of masked) {
      if (rows.has(name)) continue
      const info = disk.get(name)
      rows.set(name, {
        name,
        desc: (info && info.desc) || '',
        source: 'masked',
        provider: MASK_PROVIDER,
        path: (info && info.path) || '',
      })
    }
  } else {
    for (const [name, info] of disk) {
      if (!rows.has(name)) rows.set(name, { name, desc: info.desc, source: 'disk', provider: '', path: info.path })
    }
  }

  // 文件里关了、但哪儿都找不到的名字（插件卸了、改名了）也留一行，让「关着」这件事可见
  for (const name of offSet) {
    if (!rows.has(name)) rows.set(name, { name, desc: '（清单里已经找不到这个名字了，可能插件卸了或改名）', source: 'orphan', provider: '', path: '' })
  }

  const out = [...rows.values()].map((r) => ({
    ...r,
    on: !offSet.has(r.name),
  }))
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  return {
    ok: true,
    cwd,
    offFile,
    source: sourceName,
    error,
    at: Date.now(),
    total: out.length,
    offCount: out.filter((r) => !r.on).length,
    rows: out,
  }
}

export async function toggleSkill(name, on, opts) {
  const { offFile } = normalize(opts)
  const target = typeof name === 'string' ? name.trim() : ''
  if (!target) return { ok: false, error: '缺 name' }
  const state = await readOff(offFile)
  const set = new Set(state.off)
  if (on) set.delete(target)
  else set.add(target)
  await writeOff(offFile, { off: [...set], note: state.note })
  const next = await listSkills(opts)
  return { ...next, changed: target, on: !!on }
}
