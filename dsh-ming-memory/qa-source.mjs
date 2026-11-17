// 真人渠道消息仍共享；本套插件的自动消息与轮换浏览会话不冒充真人对话。
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { tempRoot, emptyDir, mount, sessionFor, agentFor, sleep, readFeed } from './qa-lib.mjs'

const root = tempRoot('ming-source-')
await mkdir(path.join(root, 'live'))
await mkdir(path.join(root, 'diary'))
await writeFile(path.join(root, 'diary', '2026-11-17.md'), '# 日记\nSHARED_DIARY_STAYS\n')
await writeFile(path.join(root, 'live', 'status.json'), JSON.stringify({ doing: 'SHARED_STATUS_STAYS' }))
await writeFile(path.join(root, 'live', 'feed.json'), JSON.stringify({
  'ming-browse-2': { at: Date.now(), scope: 'dm', surface: 'web', items: [{ r: '浔', t: 'OLD_AUTOMATED_FEED' }] },
}))
const cfg = { root, qq: { dir: emptyDir() } }
const m = mount(cfg)
const viewer = agentFor('web-reader', root)
await m.created(viewer.agent)
assert.ok(!viewer.text().includes('OLD_AUTOMATED_FEED'))

const chat = sessionFor('web-human', root)
// 2026-11-17：补 schedule（宿主 dsh-schedule 的定时提醒，source.kind='schedule'）。
// 它的 text 是任务 prompt，不是人打的话；漏了它，提醒会被当成她说的记进共享流。
for (const kind of ['plugin', 'plugin:ming-browse', 'plugin:ming-interest', 'plugin:ming-resume', 'plugin:ming-wake', 'schedule']) {
  m.user(chat, 'AUTOMATED_' + kind, kind)
}
m.user(chat, 'WEB_HUMAN', 'user')
m.user(sessionFor('onebot-private-10001', root), '<user_message qq="10001">QQ_HUMAN</user_message>', 'plugin:dsh-onebot')
m.user(sessionFor('astrbot-private-10001', root), 'ASTRBOT_HUMAN', 'plugin:astrbot-bridge')
m.user(sessionFor('custom-channel', root), 'OTHER_BRIDGE_HUMAN', 'plugin:custom-bridge')
for (const sid of ['ming-browse', 'ming-browse-2', 'ming-browse-20']) {
  m.user(sessionFor(sid, root), 'AUTONOMOUS_INPUT', 'user')
  m.assistant(sessionFor(sid, root), 'AUTONOMOUS_ANSWER')
}
m.user(sessionFor('ming-browse-notes', root), 'SIMILAR_NAME_IS_HUMAN', 'user')
m.assistant(chat, 'HUMAN_CHAT_REPLY')
await sleep(1300)
const feed = readFeed(root)
const text = JSON.stringify(feed)
for (const expected of ['WEB_HUMAN', 'QQ_HUMAN', 'ASTRBOT_HUMAN', 'OTHER_BRIDGE_HUMAN', 'SIMILAR_NAME_IS_HUMAN', 'HUMAN_CHAT_REPLY']) {
  assert.ok(text.includes(expected), expected)
}
assert.ok(!text.includes('AUTOMATED_'))
assert.ok(!text.includes('AUTONOMOUS_'))
for (const sid of ['ming-browse', 'ming-browse-2', 'ming-browse-20']) assert.equal(feed[sid], undefined)

await m.preStep(viewer.agent)
assert.ok(viewer.text().includes('QQ_HUMAN'))
assert.ok(viewer.text().includes('ASTRBOT_HUMAN'))
const bridge = await readFile(path.join(root, 'live', 'web-for-qq.md'), 'utf8')
assert.ok(!bridge.includes('OLD_AUTOMATED_FEED'))
assert.ok(!bridge.includes('AUTONOMOUS_'))

// A 保持原样：群会话仍取得原有的全局日记、状态；不在此次补丁增加隔离。
const group = agentFor('onebot-group-999', root)
await m.created(group.agent)
assert.ok(group.text().includes('SHARED_DIARY_STAYS'))
assert.ok(group.text().includes('SHARED_STATUS_STAYS'))
console.log('PASS 来源归属、轮换浏览、旧 feed、QQ 转发及原有群日记/状态共享')
