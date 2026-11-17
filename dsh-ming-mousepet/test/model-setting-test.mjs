// 桌宠模型选择的隔离测试（2026-11-08）。
// 不启宿主、不碰网络：只把 index.js 里那两个纯函数抽出来跑。
//   1) normalizeSettings 认 talkProvider / talkModel，脏类型丢掉；
//   2) 合并语义跟光标设置一致：没传的字段沿用 fallback。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'index.js'), 'utf8')

function slice(from, to) {
  const a = src.indexOf(from)
  const b = src.indexOf(to)
  if (a < 0 || b < 0 || b <= a) throw new Error(`抽不到代码段：${from}`)
  return src.slice(a, b)
}

const ctx = {
  STYLE_IDS: ['pointer', 'link', 'text'],
  SKIN_NAME_RE: /^[A-Za-z0-9_-]{1,40}$/,
  console,
}
vm.createContext(ctx)
vm.runInContext(slice('function normalizeSettings', 'async function loadSavedSettings'), ctx)

const norm = ctx.normalizeSettings
const cases = []
const check = (name, fn) => {
  try { fn(); cases.push(['PASS', name]) } catch (error) { cases.push(['FAIL', `${name} — ${error.message}`]) }
}
const eq = (a, b, what) => {
  const x = JSON.stringify(a)
  const y = JSON.stringify(b)
  if (x !== y) throw new Error(`${what}: ${x} !== ${y}`)
}

check('没传就留空（退回 patch.yml）', () => {
  const s = norm({ cursorSize: 64 }, {})
  eq(s.talkProvider, '', 'talkProvider')
  eq(s.talkModel, '', 'talkModel')
})

check('写进去就留住', () => {
  const s = norm({ talkProvider: 'wb-proxy', talkModel: 'hy4-preview' }, {})
  eq(s.talkProvider, 'wb-proxy', 'talkProvider')
  eq(s.talkModel, 'hy4-preview', 'talkModel')
})

check('前后空白修掉', () => {
  const s = norm({ talkProvider: '  wb-proxy  ', talkModel: ' hy4-preview ' }, {})
  eq(s.talkProvider, 'wb-proxy', 'talkProvider')
  eq(s.talkModel, 'hy4-preview', 'talkModel')
})

check('脏类型丢掉，不写坏设置文件', () => {
  const s = norm({ talkProvider: 123, talkModel: { a: 1 } }, {})
  eq(s.talkProvider, '', 'talkProvider')
  eq(s.talkModel, '', 'talkModel')
})

check('只改光标时模型不被抹掉', () => {
  const base = norm({ talkProvider: 'wb-proxy', talkModel: 'hy4-preview' }, {})
  const s = norm({ cursorSize: 96 }, base)
  eq(s.talkModel, 'hy4-preview', 'talkModel 应沿用')
  eq(s.cursorSize, 96, 'cursorSize')
})

check('恢复默认 = 传空串，能落成空', () => {
  const base = norm({ talkProvider: 'wb-proxy', talkModel: 'hy4-preview' }, {})
  const s = norm({ talkProvider: '', talkModel: '' }, base)
  eq(s.talkModel, '', 'talkModel')
})

check('超长的截断，不留一整段垃圾', () => {
  const s = norm({ talkModel: 'x'.repeat(300) }, {})
  if (s.talkModel.length !== 120) throw new Error(`长度 ${s.talkModel.length}`)
})

for (const [k, name] of cases) console.log(`${k} ${name}`)
const failed = cases.filter(([k]) => k === 'FAIL').length
console.log(`\n${cases.length - failed}/${cases.length} 通过`)
process.exit(failed ? 1 : 0)
