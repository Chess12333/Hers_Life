// 2026-11-09 17:1x：四个动作必须挂在 pet 上，不是 pet_input。
//
// 现场：宿主上 `pet {action:"sessions"}` 回「未知 action。可用：status / look / …」，
// 而 `pet_input {action:"sessions"}` 居然真的列出了会话——分支写进了鼠标键盘那只工具，
// schema 和文档却在 pet 上。这份测试把「哪个工具吃哪个 action」钉住，重启前也能验。
//
// 判据只认分派，不认结果内容：sessions 在没接会话服务时该说「列不出来」，
// 不该说「未知 action」；反过来 pet_input 必须继续拒收这四个。
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const tools = new Map()
const ctx = {
  logger: { info() {}, warn() {} },
  tools: {
    register(tool) {
      tools.set(tool.name, tool)
      return () => {}
    },
  },
}

const dispose = await apply(ctx)
test.after(() => {
  try { dispose() } catch { /* 收尾失败不该盖住断言结果 */ }
})

test('两只工具都在，名字没变', () => {
  assert.ok(tools.get('pet'), '缺 pet')
  assert.ok(tools.get('pet_input'), '缺 pet_input')
})

test('pet 吃 sessions（没接会话服务时也只是列不出来）', async () => {
  const r = await tools.get('pet').execute({ action: 'sessions' })
  const text = String(r.text || '')
  assert.ok(!/未知 action/.test(text), `pet 又拒收 sessions 了：${text}`)
  assert.match(text, /列不出来|没有可见的会话|会话（新→旧）/)
})

test('pet 吃 ask：没给内容就说要说什么，而不是未知 action', async () => {
  const r = await tools.get('pet').execute({ action: 'ask' })
  const text = String(r.text || '')
  assert.ok(!/未知 action/.test(text), `pet 又拒收 ask 了：${text}`)
  assert.match(text, /要说点什么|没成/)
})

test('pet_input 不再吃这四个动作', async () => {
  for (const action of ['sessions', 'ask', 'pick', 'card']) {
    const r = await tools.get('pet_input').execute({ action })
    assert.match(String(r.text || ''), /未知 action/, `pet_input 还吃 ${action}`)
  }
})

test('pet_input 自己的动作还在', async () => {
  const r = await tools.get('pet_input').execute({ action: 'windows' })
  assert.ok(!/未知 action/.test(String(r.text || '')), 'pet_input 的 windows 丢了')
})
