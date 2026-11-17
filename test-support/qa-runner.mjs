// test-support/qa-runner.mjs —— runner 自己的验收（交接书 L-T2 / L-T3 / L-T4）。
//
// 测的是「check.mjs 会不会骗人」，不是某个插件功能：
//   L-T2 故意失败 → 退出码非零，且报出那一项；
//   L-T3 缺条件 → 显示 SKIP 和原因，汇总里不计入通过；
//   L-T4 拼错的套件/项 → 明确报错，不静默当成功。
//
// 子进程一律用参数数组启动，不过 shell：路径里有中文和空格也不会被拆开。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check.mjs'), ...args], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, MING_ROOT: ROOT },
})

const list = run(['--list'])
ok('--list 退出码 0', list.status === 0, 'status=' + list.status)
ok('--list 打出显式清单（不是扫目录）', /offline/.test(list.stdout) && /windows-live/.test(list.stdout))
ok('--list 不读真实数据', !/日记正文|persona\/人设\.md 的内容/.test(list.stdout))

const bad = run(['--suite=fixture'])
ok('L-T2 故意失败 → 退出码非零', bad.status !== 0, 'status=' + bad.status)
ok('L-T2 失败项被点名', /fixture\/always-fail/.test(bad.stdout + bad.stderr))
ok('L-T2 汇总写了 FAIL 数', /FAIL 1/.test(bad.stdout), (bad.stdout.match(/合计[^\n]*/) || [''])[0])

const skip = run(['--suite=host'])
ok('L-T3 缺条件 → SKIP 并给原因', /SKIP/.test(skip.stdout) && /MING_RUN_MANUAL/.test(skip.stdout), (skip.stdout.match(/SKIP[^\n]*/) || [''])[0])
ok('L-T3 SKIP 不计入通过', /PASS 0 \/ FAIL 0 \/ SKIP 1/.test(skip.stdout), (skip.stdout.match(/合计[^\n]*/) || [''])[0])
ok('L-T3 全是 SKIP 时退出码仍是 0（不是 FAIL）', skip.status === 0, 'status=' + skip.status)

const typo = run(['--suite=nosuchsuite'])
ok('L-T4 不存在的套件 → 非零退出', typo.status !== 0, 'status=' + typo.status)
ok('L-T4 明确说没有匹配', /没有匹配/.test(typo.stdout + typo.stderr))

const one = run(['--suite=offline', '--only=test-support/workspace'])
ok('--only 只跑一项', (one.stdout.match(/^PASS /gm) || []).length === 1, one.stdout.slice(0, 200))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
