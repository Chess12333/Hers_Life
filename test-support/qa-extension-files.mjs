// test-support/qa-extension-files.mjs —— 扩展交付完整性（核查 R03）
//
// 一个「干净检出」里，manifest 引用的每个文件都必须真的在仓库里。
// 2026-11-17 的病：manifest 写着 options_page: options.html，本地有，
// 但根 .gitignore 的 *.html 把它挡住了，谁 clone 下来都少这一页。
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const EXT = join(ROOT, 'dsh-ming-mousepet', 'extension')

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'))
const tracked = new Set(
  execFileSync('git', ['ls-files', 'dsh-ming-mousepet/extension'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split('/').pop()),
)

const refs = []
if (manifest.options_page) refs.push(manifest.options_page)
if (manifest.background?.service_worker) refs.push(manifest.background.service_worker)
for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) refs.push(js)
for (const cs of manifest.content_scripts || []) for (const css of cs.css || []) refs.push(css)

ok('manifest 至少引用了一个文件', refs.length > 0, String(refs.length))
for (const ref of refs) {
  ok('仓库里有 ' + ref, tracked.has(ref))
}
ok('声明了设置页时，设置页脚本与页面同批交付',
  !manifest.options_page || (tracked.has(manifest.options_page) && tracked.has('options.js')))

// 设置页要能真的存配置：options.js 用到的元素 id 在 html 里都得有
if (manifest.options_page && tracked.has(manifest.options_page)) {
  const html = readFileSync(join(EXT, manifest.options_page), 'utf8')
  const js = readFileSync(join(EXT, 'options.js'), 'utf8')
  const ids = [...js.matchAll(/\$\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1])
  ok('options.js 引用了元素', ids.length > 0, String(ids.length))
  for (const id of new Set(ids)) ok('设置页里有 #' + id, html.includes('id="' + id + '"'))
  ok('设置页加载了 options.js', /<script[^>]+src=["']options\.js["']/.test(html))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
