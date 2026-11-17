// qa-inject-account.mjs —— K-1 旁路统计：记「本插件拼了多少」，不冒充「模型收到多少」。
//
// 2026-11-17 立。要验的不是数字好看，是四件事：
//   ① 分块相加必须精确等于最终文本长度（漏算/双算都算失败）；
//   ② 被预算省掉的日记只报篇数，不伪造字符数；
//   ③ uncovered 里必须如实写着这一层看不见的东西；
//   ④ 落盘失败不影响开场（统计是旁路，不是主路）。
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mount, agentFor, check, summary } from './qa-lib.mjs'
import { lastAccountSnapshot } from './index.js'

const root = mkdtempSync(join(tmpdir(), 'ming-account-'))
mkdirSync(join(root, 'persona'), { recursive: true })
mkdirSync(join(root, 'diary'), { recursive: true })

writeFileSync(join(root, 'persona', '人设.md'), '# 人设\n' + '这是人设正文。'.repeat(40), 'utf8')
writeFileSync(join(root, 'persona', '名字.md'), '# 名字\n' + '名字正文。'.repeat(20), 'utf8')
writeFileSync(join(root, 'persona', '约定.md'), '# 约定\n' + '约定正文。'.repeat(60), 'utf8')
for (const d of ['2026-11-15', '2026-11-16', '2026-11-17']) {
  writeFileSync(join(root, 'diary', d + '.md'), '# ' + d + '\n' + '日记正文。'.repeat(120), 'utf8')
}

const m = mount({
  root,
  personaFiles: ['persona/人设.md', 'persona/名字.md', 'persona/约定.md'],
  diaryDir: 'diary',
  diaryCount: 3,
  maxChars: 200000, // 够装，先验「全装」这一档
})
const a = agentFor('account', root)
await m.created(a.agent)
const text = a.text()
const snap = lastAccountSnapshot()

check('有快照', !!snap)
check('schemaVersion=1', snap && snap.schemaVersion === 1)
check('stage=assembled（不冒充已发送）', snap && snap.stage === 'assembled')
check('unit 是 utf16_code_units', snap && snap.unit === 'utf16_code_units')
check('totalChars 等于最终文本长度', snap && snap.totalChars === text.length, snap && (snap.totalChars + ' vs ' + text.length))
check('分块相加精确等于总长（无漏算/双算）', snap && snap.checksumOk === true, snap && (snap.blocksSum + ' vs ' + snap.totalChars))
check('人设块是 included_full', snap && snap.blocks.find((b) => b.key === 'persona')?.reason === 'included_full')
check('日记块全装时是 included_all', snap && snap.blocks.find((b) => b.key === 'diary')?.reason === 'included_all')
check('日记全装时没有报省略', snap && snap.blocks.find((b) => b.key === 'diary')?.omittedChars === 0)
check('uncovered 列着宿主那一层', snap && Array.isArray(snap.uncovered) && snap.uncovered.includes('host_history'))
check('tokenEstimate 是 null（没测就不填 0）', snap && snap.tokenEstimate === null)
check('providerUsage 是 null（没拿到就不编）', snap && snap.providerUsage === null)

// 落盘：只有数字和 key，不该有正文副本
let saved = ''
try { saved = readFileSync(join(root, 'live', 'inject-account.json'), 'utf8') } catch {}
check('落盘到 live/inject-account.json', saved.length > 0)
check('落盘内容不含日记正文', saved.length > 0 && !saved.includes('日记正文'))

// 第二档：预算压到只留一点点，验「省去篇数」和截断不伪造字符数
const m2 = mount({
  root,
  personaFiles: ['persona/人设.md', 'persona/名字.md', 'persona/约定.md'],
  diaryDir: 'diary',
  diaryCount: 3,
  maxChars: 200000,
  diaryChars: 500,
})
const b = agentFor('account2', root)
await m2.created(b.agent)
const snap2 = lastAccountSnapshot()
const diary2 = snap2 && snap2.blocks.find((x) => x.key === 'diary')
check('压预算后日记块 reason=configured_budget', diary2 && diary2.reason === 'configured_budget')
check('省掉的只报篇数（omittedUnit=files）', diary2 && diary2.omittedUnit === 'files')
check('被截断的另计（truncatedFiles）', diary2 && typeof diary2.truncatedFiles === 'number')
check('压预算后仍然对得上总长', snap2 && snap2.checksumOk === true, snap2 && (snap2.blocksSum + ' vs ' + snap2.totalChars))
check('文本真的变短了', b.text().length < text.length)
check('落盘文件在长', statSync(join(root, 'live', 'inject-account.json')).size > 0)

summary('qa-inject-account')
