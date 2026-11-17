// test-support/workspace.mjs —— 合成数据工作区（交接书 L-2）
//
// 为什么单独抽出来：qa-* 里有几项断言的是「宿主读工作区」的行为（人设三份、日记、live/status.json）。
// 直接指向真目录会读她的真实记忆、并且往真文件里写；每个脚本各抄一份 fixture 又会慢慢长歪——
// 抄的人只记得自己那一条断言需要的文件。
//
// 这里只做一件事：造一个最小的、可预测的工作区，跑完能删干净。语义（三份人设 / 三篇日记 / live 三个文件）
// 与 scripts/check.mjs 原来那份一致，参数化只加了「换几篇日记」「换前缀」，默认值与原来逐字相同。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PERSONA_FILES = ['人设.md', '名字.md', '约定.md']
export const DEFAULT_DIARIES = ['2026-11-15', '2026-11-16', '2026-11-17']

/** 造一个合成工作区，返回绝对路径。调用方负责 cleanupWorkspace。 */
export function makeWorkspace(opts = {}) {
  const diaries = Array.isArray(opts.diaries) && opts.diaries.length ? opts.diaries : DEFAULT_DIARIES
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), opts.prefix || 'hers-check-ws-'))
  for (const d of ['persona', 'diary', 'live']) fs.mkdirSync(path.join(ws, d), { recursive: true })
  fs.writeFileSync(path.join(ws, 'live', 'holidays.json'), JSON.stringify({ off: [], work: [] }))
  // 「时间感」那块要一份 status.json 才长出来；feed 给空数组（它只负责跨会话摘要）
  fs.writeFileSync(path.join(ws, 'live', 'status.json'), JSON.stringify({
    updated: new Date().toISOString(), doing: '检查用：合成状态', note: '',
    done: [{ what: '检查用：一件事', at: new Date().toISOString() }],
  }, null, 2))
  fs.writeFileSync(path.join(ws, 'live', 'feed.json'), JSON.stringify({ updated: new Date().toISOString(), sessions: [] }, null, 2))
  for (const n of PERSONA_FILES) {
    fs.writeFileSync(path.join(ws, 'persona', n), '# ' + n + '\n\n检查用的合成人设。\n')
  }
  for (const d of diaries) {
    fs.writeFileSync(path.join(ws, 'diary', d + '.md'), '# ' + d + '\n\n检查用的合成日记，' + d + '。\n')
  }
  return ws
}

/** 给子进程用的环境：源码根与数据工作区分开写清楚（F-3 的口径）。 */
export function workspaceEnv(base, ws) {
  return { ...base, MING_ROOT: ws, MING_WORKSPACE: ws }
}

/** 删干净；失败不抛（临时目录留着不影响判定，抛了会把 PASS 变成崩溃）。 */
export function cleanupWorkspace(ws) {
  if (!ws) return
  try { fs.rmSync(ws, { recursive: true, force: true }) } catch {}
}
