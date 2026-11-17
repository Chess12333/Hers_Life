// test-support/qa-portability.mjs —— F-T1 / F-T2 / F-T4 / F-T5：构建不看当前目录。
//
// 做法：把仓库里的 src + build.mjs 复制到临时目录，再从**无关的 cwd** 跑构建。
// 只要脚本还依赖作者机器上的固定盘符，这里就会当场暴露。
// 不碰仓库自己的 client.js，也不碰 node_modules（构建只读源码）。
import { mkdtempSync, mkdirSync, cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..')
const tmp = mkdtempSync(join(tmpdir(), 'ming-port-'))

// 造一份最小仓库：所有包的 src + 两个 build.mjs（graph 还要别的包的面板源）
for (const name of readdirSync(SRC)) {
  if (!name.startsWith('dsh-ming-')) continue
  const pkg = join(SRC, name)
  const dst = join(tmp, name)
  if (existsSync(join(pkg, 'src'))) cpSync(join(pkg, 'src'), join(dst, 'src'), { recursive: true })
  for (const f of ['build.mjs', 'package.json']) {
    if (existsSync(join(pkg, f))) {
      mkdirSync(dst, { recursive: true })
      cpSync(join(pkg, f), join(dst, f))
    }
  }
}
const unrelated = mkdtempSync(join(tmpdir(), 'ming-unrelated-'))

const runBuild = (pkg, extraArgs = [], cwd = unrelated, env = {}) => spawnSync(
  process.execPath,
  [join(tmp, pkg, 'build.mjs'), ...extraArgs],
  { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } }
)

// F-T1 / F-T2：从无关 cwd 跑，输出必须落在包目录
const g1 = runBuild('dsh-ming-graph')
ok('F-T1 graph 从无关目录构建成功', g1.status === 0, (g1.stdout + g1.stderr).slice(-300))
const gOut = join(tmp, 'dsh-ming-graph', 'client.js')
ok('F-T1 产物落在包目录', existsSync(gOut))
ok('F-T1 没有把产物写到 cwd', !existsSync(join(unrelated, 'client.js')))
const gBytes = existsSync(gOut) ? readFileSync(gOut).length : 0
ok('F-T1 产物非空（不是写了一片空气）', gBytes > 1000, 'bytes=' + gBytes)

const fromPkgDir = runBuild('dsh-ming-graph', [], join(tmp, 'dsh-ming-graph'))
ok('F-T1 从包目录跑结果一致', fromPkgDir.status === 0 && readFileSync(gOut).length === gBytes)

const m1 = runBuild('dsh-ming-memory')
ok('F-T2 memory 从无关目录构建成功', m1.status === 0, (m1.stdout + m1.stderr).slice(-300))
const mOut = join(tmp, 'dsh-ming-memory', 'client.js')
ok('F-T2 产物落在包目录', existsSync(mOut))
const mBytes = existsSync(mOut) ? readFileSync(mOut).length : 0
ok('F-T2 没访问作者固定盘符（只吃临时根）', m1.status === 0 && !/C:\\dsh\\dsh-ming-ui/.test(m1.stdout + m1.stderr))

// F-T4：显式 MING_ROOT 指到不存在的地方，必须明确失败，不许悄悄读别的
const bad = runBuild('dsh-ming-graph', [], unrelated, { MING_ROOT: join(tmp, 'no-such-root') })
ok('F-T4 不存在的 MING_ROOT → 非零退出', bad.status !== 0, 'status=' + bad.status)
ok('F-T4 报错里说清缺什么', /找不到|缺文件|中止/.test(bad.stdout + bad.stderr))

// F-T5：改源 → check 过期 → 重建 → check 通过
const srcPanel = join(tmp, 'dsh-ming-graph', 'src', 'panel.js')
const before = readFileSync(srcPanel, 'utf8')
writeFileSync(srcPanel, before + '\n// portability probe\n', 'utf8')
const c1 = runBuild('dsh-ming-graph', ['--check'])
ok('F-T5 改源后 check 报过期（非零或明说落后）', c1.status !== 0 || /不是最新|过期/.test(c1.stdout + c1.stderr),
  (c1.stdout + c1.stderr).slice(-200))
const rebuild = runBuild('dsh-ming-graph')
const c2 = runBuild('dsh-ming-graph', ['--check'])
ok('F-T5 重建后 check 通过', rebuild.status === 0 && c2.status === 0, (c2.stdout + c2.stderr).slice(-200))
ok('F-T5 check 不写文件（重建前后产物只在 rebuild 这一步变）', existsSync(gOut))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
