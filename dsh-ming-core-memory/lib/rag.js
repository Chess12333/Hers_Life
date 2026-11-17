// rag.js —— 本地语义检索（向量），给 rag_recall 工具用。（2026-11-15 建）
//
// 为什么放在这个插件里：memory_search 查的是「我下过的结论」（BM25 关键词），
// 而「她说过什么」「那段我怎么写的」在原话里，只有向量搜得到。
// 两套索引都是 工作区 的脚本建的（scripts\doc-emb / chat-embed / qq-embed），
// 这里只读，不写、不建索引。
//
// 三层，各管一段：
//   doc = 我写过的字（日记/见闻/learned/reading/writing/day/people/live）
//   web = DSH 网页会话（chat-corpus）
//   qq  = QQ 群与私聊（qq-corpus，含旧壳 QQ-Agent）
//
// 嵌入服务 127.0.0.1:18091（bge-base-zh-v1.5-q8_0），不在时返回 unavailable 由调用方说明，
// **不要假装成功**。

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LIVE = process.env.MING_WORKSPACE ? join(process.env.MING_WORKSPACE, 'live') : ''
const ENDPOINT = process.env.EMB_ENDPOINT || 'http://127.0.0.1:18091/v1/embeddings'
const MODEL = process.env.EMB_MODEL || 'bge-base-zh-v1.5-q8_0'
const DIM = 768
const PREFIX = '为这个句子生成表示以用于检索相关文章：'

const LAYERS = {
  doc: { emb: 'doc-emb.f32', ids: 'doc-emb-ids.json', corpus: null, manifest: 'doc-emb.manifest.json' },
  web: { emb: 'chat-emb.f32', ids: 'chat-emb-ids.json', corpus: 'chat-corpus.jsonl', manifest: 'chat-emb.manifest.json' },
  qq: { emb: 'qq-emb.f32', ids: 'qq-emb-ids.json', corpus: 'qq-corpus.jsonl', manifest: 'qq-emb.manifest.json' },
}

const cache = new Map() // layer -> { sig, vecs, ids, rows }

/**
 * 2026-11-17（J-2）：索引清单。
 *
 * 每层可以有一份 `<layer>-manifest.json`，写明模型、维度、分块和代际。
 * 没有就当旧格式照读，只在 issues 里记一条 info——旧索引不该因为没清单就变成不可用。
 * 有清单则至少核三件：schema/layer 对不对、维度跟查询端一不一样、条数对不对。
 * **维度相同不代表模型相同**，所以模型名不同也拒（不同向量空间的点积不能混排）。
 */
function readManifest(name) {
  const p = join(LIVE, LAYERS[name].manifest)
  let raw
  try {
    raw = readFileSync(p, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw Object.assign(new Error('清单读不出来：' + e.message), { code: 'EMANIFEST' })
  }
  let m
  try {
    m = JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('清单不是合法 JSON'), { code: 'EMANIFEST' })
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    throw Object.assign(new Error('清单必须是对象'), { code: 'EMANIFEST' })
  }
  if (m.schemaVersion !== 1) {
    throw Object.assign(new Error('清单版本不支持：' + String(m.schemaVersion)), { code: 'EMANIFEST' })
  }
  if (m.layer !== name) {
    throw Object.assign(new Error('清单 layer=' + String(m.layer) + '，与 ' + name + ' 不符'), { code: 'EMANIFEST' })
  }
  return m
}

/** 清单与查询端是否兼容；不兼容返回 issues（带 severity），不抛。 */
function verifyManifest(name, m, rowCount) {
  const issues = []
  const e = m.embedding && typeof m.embedding === 'object' ? m.embedding : {}
  const dim = Number(e.dimensions)
  if (!Number.isFinite(dim) || dim <= 0) {
    issues.push({ layer: name, code: 'manifest-dim-unknown', severity: 'error' })
  } else if (dim !== DIM) {
    // 不拿查询端的 768 去读一份 512 维的向量：字节数对不上，读出来也是乱的。
    issues.push({ layer: name, code: 'manifest-dim-mismatch', severity: 'error', indexDim: dim, queryDim: DIM })
  }
  if (typeof e.model === 'string' && e.model && e.model !== MODEL) {
    issues.push({ layer: name, code: 'manifest-model-mismatch', severity: 'error', indexModel: e.model, queryModel: MODEL })
  }
  if (Number(m.rowCount) !== rowCount) {
    issues.push({ layer: name, code: 'manifest-rowcount-mismatch', severity: 'error', rowCount: Number(m.rowCount), actual: rowCount })
  }
  // 文件名只许是同一目录里的裸名字：不接受绝对路径、目录穿越。
  const files = m.files && typeof m.files === 'object' ? m.files : {}
  for (const [k, v] of Object.entries(files)) {
    const nm = v && typeof v === 'object' ? String(v.name || '') : ''
    if (nm && (/[\\/]/.test(nm) || nm.includes('..'))) {
      issues.push({ layer: name, code: 'manifest-path-unsafe', severity: 'error', file: k, name: nm })
    }
  }
  return issues
}


function sigOf(files) {
  return files
    .map((f) => {
      try {
        const s = statSync(f)
        return f + ':' + s.size + ':' + Math.round(s.mtimeMs)
      } catch {
        return f + ':missing'
      }
    })
    .join('|')
}

function loadLayer(name) {
  if (!LIVE) throw new Error('未配置 MING_WORKSPACE')
  const spec = LAYERS[name]
  const embPath = join(LIVE, spec.emb)
  const idsPath = join(LIVE, spec.ids)
  const corpusPath = spec.corpus ? join(LIVE, spec.corpus) : null
  const manifestPath = join(LIVE, spec.manifest)
  const files = [embPath, idsPath, ...(corpusPath ? [corpusPath] : []), manifestPath]
  const sig = sigOf(files)
  const hit = cache.get(name)
  if (hit && hit.sig === sig) return hit

  const manifest = readManifest(name) // 没有清单返回 null（旧格式）

  const buf = readFileSync(embPath)
  if (buf.byteLength % (4 * DIM) !== 0) throw new Error('向量文件不完整或维度不符')
  const flat = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const n = flat.length / DIM
  const vecs = flat.subarray(0, n * DIM)
  const ids = JSON.parse(readFileSync(idsPath, 'utf8'))
  if (!Array.isArray(ids) || ids.length !== n || !flat.every(Number.isFinite))
    throw new Error('索引条数或向量内容不匹配')
  if (!corpusPath && ids.some(it => !it || typeof it !== 'object' || typeof it.text !== 'string'))
    throw new Error('文档索引缺少正文')

  let rows = null
  if (corpusPath) {
    rows = new Map()
    for (const line of readFileSync(corpusPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        rows.set(r.id, r)
      } catch { /* 坏行跳过 */ }
    }
    if (ids.some(id => !rows.has(id) || typeof rows.get(id).text !== 'string'))
      throw new Error('语料缺少对应原文')
  }

  // 清单校验放在解析之后：条数要拿真实的 n 去对。
  let issues = []
  if (manifest) {
    const bad = verifyManifest(name, manifest, n)
    if (bad.length) {
      throw Object.assign(new Error('索引清单与查询端不兼容：' + bad.map(x => x.code).join(',')), {
        code: 'EINCOMPAT',
        issues: bad,
      })
    }
  } else {
    // 旧格式照读，但如实记一笔：没有清单就没法证明模型和维度是同一代。
    issues = [{ layer: name, code: 'manifest-missing', severity: 'info' }]
  }

  const entry = { sig, vecs, ids, rows, n, issues, generation: manifest ? String(manifest.generation || '') : '' }
  cache.set(name, entry)
  return entry
}

async function queryVector(text) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: [PREFIX + text], model: MODEL }),
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error('嵌入端 HTTP ' + r.status)
  const j = await r.json()
  const v = j && j.data && j.data[0] && j.data[0].embedding
  if (!Array.isArray(v) || v.length !== DIM || !v.every(Number.isFinite)) throw new Error('嵌入端返回无效向量')
  const out = new Float32Array(DIM)
  let norm = 0
  for (let i = 0; i < DIM; i++) { out[i] = v[i]; norm += v[i] * v[i] }
  if (!Number.isFinite(norm) || norm === 0) throw new Error('嵌入端返回空向量')
  norm = Math.sqrt(norm)
  for (let i = 0; i < DIM; i++) out[i] /= norm
  return out
}

/** 从一行元信息里取日期（YYYY-MM-DD），取不到返回 '' */
function dateOf(name, row) {
  if (row && row.t0) {
    const d = new Date(Number(row.t0))
    if (!Number.isNaN(d.getTime())) {
      const p = (x) => String(x).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
  }
  const m = String(name || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[0] : ''
}

function snippetOf(layer, entry, index, row) {
  if (entry.rows === null) {
    // doc：ids 里本身就带 text
    const it = entry.ids[index] || {}
    return { text: String(it.text || ''), file: it.file || '', title: it.title || '', src: it.src || '' }
  }
  const r = row || entry.rows.get(entry.ids[index])
  if (!r) return null
  const text = String(r.text || '')
  return {
    text,
    file: '',
    title: r.chatKey || '',
    // 2026-11-17（J-1）：web 和 qq 两层共用这段，原来一律写 'qq'——
    // 于是 web 命中被标成 QQ 原话。按层名写。
    src: layer,
    chatKey: r.chatKey,
    t0: r.t0,
    t1: r.t1,
    n: r.n,
  }
}

/**
 * 按意思搜。
 * @returns {{hits: Array, layers: string[], status: string, issues: Array, service: string}}
 */
export async function ragSearch(query, { layer = 'all', k = 5, since = '', until = '' } = {}) {
  const want = layer === 'all' ? ['doc', 'web', 'qq'] : [layer].filter((x) => LAYERS[x])
  if (!want.length) throw new Error('layer 只认 doc / web / qq / all')

  const entries = new Map()
  const issues = []
  for (const name of want) {
    try {
      const entry = loadLayer(name)
      entries.set(name, entry)
      // info 级的（比如没有清单）跟着返回，但不把状态打成 partial。
      for (const it of entry.issues || []) issues.push(it)
    } catch (e) {
      if (e && e.code === 'EINCOMPAT' && Array.isArray(e.issues)) issues.push(...e.issues)
      else issues.push({ layer: name, status: !LIVE ? 'unconfigured' : e.code === 'ENOENT' ? 'missing' : 'invalid' })
    }
  }
  const used = [...entries.keys()]
  if (!used.length) return { hits: [], layers: used, issues, status: 'unavailable', service: 'not_checked' }
  let q
  try { q = await queryVector(query) }
  catch { return { hits: [], layers: used, issues, status: 'unavailable', service: 'unavailable' } }
  const out = []
  for (const [name, entry] of entries) {
    const { vecs, n } = entry
    for (let i = 0; i < n; i++) {
      const off = i * DIM
      let dot = 0
      for (let d = 0; d < DIM; d++) dot += vecs[off + d] * q[d]
      const index = i
      const row = entry.rows ? entry.rows.get(entry.ids[index]) : null
      const snip = snippetOf(name, entry, index, row)
      if (!snip || !snip.text) continue
      if (since || until) {
        const dt = dateOf(snip.file || snip.title, row)
        if (since && dt && dt < since) continue
        if (until && dt && dt > until) continue
      }
      out.push({ layer: name, score: dot, ...snip })
    }
  }
  out.sort((a, b) => b.score - a.score)
  // 2026-11-17（J-2）：只有 error 级 issue 才算「部分可查」；info（旧格式没清单）不动状态。
  const blocking = issues.some((i) => (i.severity || 'error') !== 'info')
  return { hits: out.slice(0, k), layers: used, issues, status: blocking ? 'partial' : 'ready', service: 'ready' }
}
