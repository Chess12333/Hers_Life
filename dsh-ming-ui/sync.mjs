#!/usr/bin/env node
/**
 * sync.mjs —— 把 dsh-ming-ui/src/theme.js 推到各插件的 src/theme.js
 *
 * 为什么要有这个：各插件的 build.mjs 是「读文本 → 拼进 client.js」，不是真打包，
 * 所以没法 `import '@ming/ui'`。又不能让每个插件各留一份手抄的样式——那会漂。
 * 于是：这里一份唯一源，其余全是复制品，`--check` 一跑就知道谁漂了。
 *
 * 用法：
 *   node sync.mjs           # 写一遍
 *   node sync.mjs --check   # 只比对（CI / 动完手之前跑）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'src', 'theme.js')
const PLUGINS_DIR = (process.env.USERPROFILE || '') + '/.dsh/profiles/web/node_modules'

/** 吃这层皮的插件。新面板接进来时往这里加一行。 */
const TARGETS = [
  'dsh-ming-graph',
  'dsh-ming-memory',
  'dsh-ming-interest',
  'dsh-ming-voice',
  'dsh-ming-browse',
]

const checkOnly = process.argv.includes('--check')
const src = fs.readFileSync(SRC, 'utf8')
const header = '// ⚠ 由 dsh-ming-ui/sync.mjs 生成，不要手改。改 C:\\dsh\\dsh-ming-ui\\src\\theme.js\n'
const body = header + src

let drift = 0
let wrote = 0
for (const name of TARGETS) {
  const dir = path.join(PLUGINS_DIR, name, 'src')
  if (!fs.existsSync(path.join(PLUGINS_DIR, name))) {
    console.log(`skip  ${name}（没装）`)
    continue
  }
  fs.mkdirSync(dir, { recursive: true })
  const dst = path.join(dir, 'theme.js')
  const old = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null
  if (old === body) {
    console.log(`ok    ${name}/src/theme.js`)
    continue
  }
  if (checkOnly) {
    console.log(`DRIFT ${name}/src/theme.js`)
    drift++
    continue
  }
  fs.writeFileSync(dst, body, 'utf8')
  console.log(`write ${name}/src/theme.js`)
  wrote++
}

if (checkOnly) {
  console.log(drift ? `\n${drift} 处漂了，跑 node sync.mjs 修。` : '\n全部一致。')
  process.exit(drift ? 1 : 0)
}
console.log(`\n写完 ${wrote} 处。`)
