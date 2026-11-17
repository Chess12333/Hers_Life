#!/usr/bin/env node
// scripts/check-privacy.mjs —— 推送之前先跑一遍，别靠记性。
//
// 2026-11-17 立。起因：v1.2.0 推到公开仓库之后才发现里面挂着
// 真实 QQ 号、群号、B站 uid —— 是我跳过了这一步，不是没工具。
//
// 两层检查：
//   1) 万用模式（不需要配置）：QQ 号 / 群号 / 本地用户名路径 / 凭证
//   2) 已知值（本地清单，不进仓库）：live/privacy-terms.local.txt，一行一个
//
// 用法：
//   node scripts/check-privacy.mjs          # 查工作树
//   node scripts/check-privacy.mjs --staged # 只查已 add 的
//   node scripts/check-privacy.mjs --all    # 连历史一起查（慢）
// 退出码 1 = 有问题，别推。

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const STAGED = argv.includes('--staged')
const ALL = argv.includes('--all')

const PATTERNS = [
  { id: 'qq-like', re: /\b[1-9]\d{4,10}\b/g, why: '像 QQ 号的数字串（可能误报，看上下文）', soft: true },
  { id: 'win-user', re: /C:\\\\?Users\\\\?([A-Za-z0-9_.-]+)/g, why: '本地用户目录（暴露用户名）', soft: false },
  { id: 'onebot-id', re: /onebot-(?:private|group)-(\d{5,})/g, why: 'onebot 会话 id 里的真实号', soft: false },
  { id: 'token', re: /\b(?:sk-[A-Za-z0-9]{16,}|gh[pou]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g, why: '像 token 的串（只认明确前缀）', soft: false },
  { id: 'cookie', re: /SESSDATA|bili_jct|DedeUserID/i, why: 'B站 凭证字段名', soft: false },
  { id: 'email', re: /\b[\w.+-]+@(?!local\b)[\w-]+\.[\w.]{2,}/g, why: '邮箱', soft: true },
]

// 本地清单：一行一个已知敏感值（真号、真群号、真 uid）
const LOCAL_TERMS = path.join(process.cwd(), 'live', 'privacy-terms.local.txt')
let knownTerms = []
try {
  knownTerms = fs
    .readFileSync(LOCAL_TERMS, 'utf8')
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith('#'))
} catch {
  /* 没这份清单就只跑万用模式 */
}

const IGNORE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.bundle', '.f32', '.sqlite', '.db'])
// 允许出现的示例号（占位符和明显的假号）
const ALLOW = [/<[a-z-]+>/i, /^90000000\d\d$/, /^70000000\d$/, /^80000000\d$/, /^13588$/, /^0+$/, /^10001$/]

function allowed(v) {
  return ALLOW.some((re) => re.test(v))
}

function files() {
  if (ALL) {
    return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
  }
  if (STAGED) {
    return execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' }).split('\n').filter(Boolean)
  }
  return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
}

const hits = []
for (const f of files()) {
  if (IGNORE_EXT.has(path.extname(f).toLowerCase())) continue
  let text = ''
  try {
    text = fs.readFileSync(f, 'utf8')
  } catch {
    continue
  }
  if (text.includes('\u0000')) continue // 二进制
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line.length > 4000) return // 压缩过的行，跳过
    for (const p of PATTERNS) {
      p.re.lastIndex = 0
      let m
      let guard = 0
      while ((m = p.re.exec(line)) && guard++ < 20) {
        const v = m[1] || m[0]
        if (allowed(v)) continue
        // 万用 QQ 号模式噪音大：只在明确像号的地方报（会话 id、名单、注释里带 QQ 字样）
        if (p.id === 'qq-like' && !/qq|QQ|群号|uid|onebot|subjects|私聊/i.test(line)) continue
        hits.push({ file: f, line: i + 1, id: p.id, why: p.why, value: v.slice(0, 40), snippet: line.trim().slice(0, 120) })
      }
    }
    for (const t of knownTerms) {
      if (t && line.includes(t)) {
        hits.push({ file: f, line: i + 1, id: 'known-term', why: '本地清单里的已知敏感值', value: '<已隐藏>', snippet: line.trim().slice(0, 120) })
      }
    }
  })
}

if (!hits.length) {
  console.log('干净：没有发现疑似隐私内容。' + (knownTerms.length ? `（本地清单 ${knownTerms.length} 条已比对）` : '（没找到 live/privacy-terms.local.txt，只跑了万用模式）'))
  process.exit(0)
}

console.log(`发现 ${hits.length} 处疑似隐私：\n`)
for (const h of hits) {
  console.log(`${h.file}:${h.line}  [${h.id}] ${h.why}`)
  console.log(`    ${h.snippet}`)
}
console.log('\n推送前把这些换成占位符。真的只是误报就把它加进 ALLOW 或本地清单。')
process.exit(1)
