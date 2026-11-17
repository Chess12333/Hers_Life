#!/usr/bin/env node
// scripts/chat-sessions.mjs —— 生成「群/私聊 → DSH 会话」映射（交接书 E.1 / E.3）
//
// 缺口：dsh-ming-interest 的 sessionForChat 要读一张 { "group:<id>": "<session>" } 的表，
// 但公开仓库里**没有任何东西生成它**——所以兴趣唤醒永远找不到会话，只能跳过。
//
// 数据源：DSH 自己的会话文件。文件名就是会话 id：
//   ~/.dsh/storages/session_projcache/sessions/onebot-group-<群号>-<后缀>.json
//   ~/.dsh/storages/session_projcache/sessions/onebot-private-<QQ号>-<后缀>.json
// 同一个群/人可能有多个历史会话，取 mtime 最新的那个。
//
// 用法：
//   node scripts/chat-sessions.mjs            # 写 live/chat-sessions.json
//   node scripts/chat-sessions.mjs --dry      # 只看不写
//   node scripts/chat-sessions.mjs --dir=...  # 换输出目录

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const flag = (k, d = '') => {
  const a = argv.find((x) => x.startsWith('--' + k + '='))
  if (a) return a.slice(k.length + 3)
  const i = argv.indexOf('--' + k)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return d
}
const DRY = argv.includes('--dry')

const WS = process.env.MING_WORKSPACE || 'C:/dsh/hers_workplace'
const LIVE = flag('dir') || path.join(WS, 'live')
const OUT = path.join(LIVE, 'chat-sessions.json')

// DSH 的会话在 storages 下；只认 onebot- 开头的那一类（别的插件建的会话不掺进来）。
const SESSION_DIRS = flag('from')
  ? flag('from').split(',').map((x) => x.trim()).filter(Boolean)
  : [
      path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions'),
      path.join(os.homedir(), '.dsh', 'storages', 'session_projcache_archive_manager_v2', 'sessions'),
    ]

const RE = /^onebot-(group|private)-([^-]+)(?:-[a-z0-9]+)?\.json$/i

const best = new Map() // "group:123" -> { sessionId, mtime, file }

for (const dir of SESSION_DIRS) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { continue }
  for (const name of names) {
    const m = RE.exec(name)
    if (!m) continue
    const kind = m[1].toLowerCase()
    const id = m[2]
    const key = kind + ':' + id
    let st
    try { st = fs.statSync(path.join(dir, name)) } catch { continue }
    // 同一个群/人可能有一堆历史会话：全留下，按「带后缀优先、体积大的优先」排。
    // 消费端会按顺序拿 agents.get 试，第一个能拿到的就用——比赌一个准。
    const list = best.get(key) || []
    list.push({
      sessionId: name.replace(/\.json$/i, ''),
      mtime: st.mtimeMs,
      size: st.size,
      suffixed: /-[a-z0-9]+\.json$/i.test(name),
      file: path.join(dir, name),
    })
    best.set(key, list)
  }
}

const out = {}
for (const [key, list] of [...best.entries()].sort((a, b) => {
  const am = Math.max(...a[1].map((x) => x.mtime))
  const bm = Math.max(...b[1].map((x) => x.mtime))
  return bm - am
})) {
  list.sort((x, y) => (Number(y.suffixed) - Number(x.suffixed)) || (y.size - x.size) || (y.mtime - x.mtime))
  out[key] = list.map((x) => x.sessionId)
}

const preview = Object.entries(out).map(([k, v]) => ({ key: k, sessionIds: v }))

if (DRY) {
  console.log('会写 ' + preview.length + ' 条（--dry，没写文件）：')
  for (const p of preview) console.log('  ' + p.key.padEnd(14) + ' → ' + p.sessionIds.join('  |  '))
  process.exit(0)
}

fs.mkdirSync(LIVE, { recursive: true })
const tmp = OUT + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8')
fs.renameSync(tmp, OUT)
console.log('写入 ' + OUT + '：' + preview.length + ' 条')
for (const p of preview.slice(0, 10)) console.log('  ' + p.key.padEnd(14) + ' → ' + p.sessionIds.join('  |  '))
if (preview.length > 10) console.log('  …还有 ' + (preview.length - 10) + ' 条')
