// 接线自检：graph 的 Host 半端能不能真的加载到 memory 的数据层。
// 2026-11-08 起 graph 靠 `../dsh-ming-memory/lib/…` 这两个相对路径读数据；
// 两个仓一旦不再并排（改名、搬家、只 clone 了 graph），DSH 那边的三个视图会整片起不来，
// 而界面上只会看到空白——所以让它在命令行里先响。
// 用法：node wiring-check.mjs   → 0 好 / 1 坏（health.mjs 会跑它）
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.join(HERE, '..', 'dsh-ming-memory', 'lib')

const fail = (why) => {
  console.error('✗ ' + why)
  process.exit(1)
}

let model, neuron
try {
  model = await import(new URL('../dsh-ming-memory/lib/model.mjs', import.meta.url).href)
} catch (err) {
  fail(`读不到 ${path.join(LIB, 'model.mjs')}：${err.message}`)
}
try {
  neuron = await import(new URL('../dsh-ming-memory/lib/neuron.mjs', import.meta.url).href)
} catch (err) {
  fail(`读不到 ${path.join(LIB, 'neuron.mjs')}：${err.message}`)
}

const needModel = ['readDsh', 'readQQ', 'readPeople', 'readDiaries', 'build', 'MEMORY_DEFAULTS']
const needNeuron = ['readDshNotes', 'readQqObservations', 'buildNeuron', 'buildUnified']
const missModel = needModel.filter((k) => !(k in model))
const missNeuron = needNeuron.filter((k) => !(k in neuron))
if (missModel.length) fail('model.mjs 少导出：' + missModel.join(' '))
if (missNeuron.length) fail('neuron.mjs 少导出：' + missNeuron.join(' '))

// graph 自己也得能加载（它这会儿是静态 import 上面那两个文件）
try {
  const graph = await import(new URL('./index.js', import.meta.url).href)
  if (typeof graph.apply !== 'function') fail('graph/index.js 没导出 apply')
} catch (err) {
  fail('graph/index.js 加载失败：' + err.message)
}

console.log(`✓ 接线正常：memory/lib 两个文件都在，${needModel.length}+${needNeuron.length} 个导出齐全，graph 能加载`)
