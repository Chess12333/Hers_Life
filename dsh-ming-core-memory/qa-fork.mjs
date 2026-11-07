// fork 自测：在临时 DSH_HOME 里跑一遍注册、注入文本、写入与审计
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'ming-mem-'))
process.env.DSH_HOME = home

const { apply } = await import('./lib/index.js')

const tools = []
const sections = []
const ctx = {
  tools: { register: (d) => tools.push(d) },
  systemPrompt: { section: (s) => sections.push(s) },
  inject: () => {},
  effect: () => {},
}

apply(ctx)
await new Promise((r) => setTimeout(r, 200))

console.log('tools:', tools.map((t) => t.name).join(', '))
console.log('section:', sections.map((s) => s.name + '@' + s.order).join(', '))

const text = sections[0].text()
console.log('--- 注入文本（前 700 字）---')
console.log(text.slice(0, 700))

const w = tools.find((t) => t.name === 'memory_write')
const c = tools.find((t) => t.name === 'memory_core')

console.log('--- memory_write ---')
console.log(await w.execute({ title: '测试环境事实', content: '这台机器的 DSH 安装在 C:/Users/x/AppData/Roaming/DSH。', tags: ['env'] }))

console.log('--- memory_core append ---')
console.log(await c.execute({ action: 'append', section: '环境', text: '- 测试：Node 版本 22' }))

const audit = join(home, 'memory', 'audit.jsonl')
console.log('audit exists:', existsSync(audit))
if (existsSync(audit)) console.log(readFileSync(audit, 'utf8').trim())

const core = readFileSync(join(home, 'memory', 'MEMORY.md'), 'utf8')
console.log('--- MEMORY.md ---')
console.log(core)

console.log('--- 模板里是否还有「用户画像」分节:', core.includes('用户画像'))
console.log('--- 注入文本是否还含「立即用 memory_write」:', text.includes('立即用 memory_write'))
console.log('--- 注入文本是否含新政策:', text.includes('只装「机器、环境、项目、工具、做法」'))
