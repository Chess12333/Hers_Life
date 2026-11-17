#!/usr/bin/env node
// test-support/qa-test-support.mjs —— L-2 自测：合成工作区真的长成说的那样，且删得掉。
import fs from 'node:fs'
import path from 'node:path'
import {
  makeWorkspace, workspaceEnv, cleanupWorkspace, PERSONA_FILES, DEFAULT_DIARIES,
} from './workspace.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const ws = makeWorkspace()
ok('目录建好', fs.existsSync(ws) && fs.statSync(ws).isDirectory())
ok('persona 三份', PERSONA_FILES.every((n) => fs.existsSync(path.join(ws, 'persona', n))), PERSONA_FILES.join(','))
ok('diary 三篇', DEFAULT_DIARIES.every((d) => fs.existsSync(path.join(ws, 'diary', d + '.md'))))
ok('live 三文件', ['holidays.json', 'status.json', 'feed.json'].every((n) => fs.existsSync(path.join(ws, 'live', n))))

const st = JSON.parse(fs.readFileSync(path.join(ws, 'live', 'status.json'), 'utf8'))
ok('status.json 可解析且有 doing', typeof st.doing === 'string' && st.doing.length > 0)
ok('status.done 是对象数组', Array.isArray(st.done) && st.done.every((x) => x && typeof x === 'object' && typeof x.what === 'string'))

const env = workspaceEnv({ MING_ROOT: '/should-be-overridden' }, ws)
ok('workspaceEnv 覆盖根', env.MING_ROOT === ws && env.MING_WORKSPACE === ws)

const ws2 = makeWorkspace({ diaries: ['2020-01-01'], prefix: 'hers-check-alt-' })
ok('可换日记与前缀', fs.existsSync(path.join(ws2, 'diary', '2020-01-01.md')) && path.basename(ws2).startsWith('hers-check-alt-'))
cleanupWorkspace(ws2)
ok('cleanup 删得掉', !fs.existsSync(ws2))
ok('cleanup 传空不抛', (() => { cleanupWorkspace(null); cleanupWorkspace(undefined); return true })())

cleanupWorkspace(ws)
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
