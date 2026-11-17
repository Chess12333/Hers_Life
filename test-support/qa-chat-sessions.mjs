// test-support/qa-chat-sessions.mjs —— E-3 会话映射生成：从 DSH 会话文件名推「群/私聊 → session」
//
// 用临时目录造假会话文件跑真的 scripts/chat-sessions.mjs，验：
//   · 一个 chatId 多个历史会话 → 输出数组，带后缀的、体积大的在前
//   · 老格式（单个字符串）也认
//   · --dry 不写文件
//   · 不认非 onebot 的会话文件
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'chat-sessions.mjs')

const tmp = mkdtempSync(join(tmpdir(), 'ming-chat-sessions-'))
const sessions = join(tmp, 'sessions')
const live = join(tmp, 'live')
mkdirSync(sessions, { recursive: true })
mkdirSync(live, { recursive: true })

const mk = (name, bytes) => writeFileSync(join(sessions, name), 'x'.repeat(bytes), 'utf8')

mk('onebot-group-700000001.json', 100)              // 无后缀，小
mk('onebot-group-700000001-mw7vfd6h.json', 9000)   // 带后缀，大
mk('onebot-group-700000001-abc123.json', 300)      // 带后缀，小
mk('onebot-private-9000000001.json', 50)
mk('onebot-private-9000000001-mvgpinr5.json', 5000)
mk('session-abc-def.json', 100)                    // 不是 onebot，不该进
mk('onebot-weird-123.json', 100)                   // kind 不认识，不该进

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args, '--from=' + sessions, '--dir=' + live], { encoding: 'utf8', timeout: 30000 })

// dry
{
  const r = run(['--dry'])
  ok('--dry 退出 0', r.status === 0, r.stderr.slice(-200))
  ok('--dry 不写文件', !existsSync(join(live, 'chat-sessions.json')))
  ok('--dry 打出候选', r.stdout.includes('700000001'))
}

// 真写
{
  const r = run([])
  ok('写入退出 0', r.status === 0, r.stderr.slice(-200))
  const p = join(live, 'chat-sessions.json')
  ok('文件写出来了', existsSync(p))
  const j = JSON.parse(readFileSync(p, 'utf8'))
  ok('群键存在', Array.isArray(j['group:700000001']), JSON.stringify(j))
  ok('私聊键存在', Array.isArray(j['private:9000000001']))
  ok('不是 onebot 的会话没进', !Object.keys(j).some((k) => k.includes('session-abc')))
  ok('kind 不认识的没进', !Object.keys(j).some((k) => k.includes('weird')))
  const g = j['group:700000001']
  ok('三个都留下了', g.length === 3, JSON.stringify(g))
  ok('带后缀且最大的排第一', g[0] === 'onebot-group-700000001-mw7vfd6h', JSON.stringify(g))
  ok('无后缀的排在带后缀的后面', g.indexOf('onebot-group-700000001') > g.indexOf('onebot-group-700000001-abc123'))
  ok('私聊也是数组', j['private:9000000001'][0] === 'onebot-private-9000000001-mvgpinr5')
}

// 老格式兼容：消费端认字符串——这里只验生成的形状是数组（字符串兼容在 interest 那边）
{
  const j = JSON.parse(readFileSync(join(live, 'chat-sessions.json'), 'utf8'))
  ok('值全是数组（消费端再兼容旧字符串）', Object.values(j).every((v) => Array.isArray(v)))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
