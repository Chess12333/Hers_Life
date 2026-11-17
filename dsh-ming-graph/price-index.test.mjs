/**
 * price-index.test.mjs —— 「索引费用」的纯函数验收（2026-11-10）
 *
 * 单测的是**面板真会走的那份** price-index.mjs，不是抄一份。
 * 验四件：抽价抽得出来 / 抽不出来时不瞎编 / 相似对得上 / 落盘形状对。
 *
 *   node price-index.test.mjs
 */
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { extractPrices, similarity, normName, stripDate, nearest, indexOne, indexModels, REFERENCE } from './price-index.mjs'

let bad = 0
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++ }

// ---------- 1) 抽价 ----------
console.log('\n[1] extractPrices')
const en = 'GPT-6 Astra costs $10.00 per million input tokens and $50.00 per million output tokens, with cached input at $1.00 per million.'
const enP = extractPrices(en)
ok(enP.length > 0, '英文摘要抽到 ' + enP.length + ' 组')
if (enP[0]) {
  ok(enP[0].currency === 'USD', '认出是美元：' + enP[0].currency)
  ok(enP[0].raw.input === 10 && enP[0].raw.output === 50, '输入 10 / 输出 50，实际 ' + enP[0].raw.input + '/' + enP[0].raw.output)
}

const zh = 'GLM-5.3-Flash 的 API 定价为输入 0.8 元/百万 Token、输出 2.8 元/百万 Token（常规价）。缓存命中 0.23 元/百万 Token。'
const zhP = extractPrices(zh)
ok(zhP.length > 0, '中文段落抽到 ' + zhP.length + ' 组')
if (zhP[0]) {
  ok(zhP[0].currency === 'CNY', '认出是人民币')
  ok(zhP[0].raw.input === 0.8 && zhP[0].raw.output === 2.8, '输入 0.8 / 输出 2.8，实际 ' + zhP[0].raw.input + '/' + zhP[0].raw.output)
  ok(zhP[0].price[0] === 0.23, '缓存命中 0.23 也带上了')
}

const hy = '混元 Hy4 Preview（腾讯混元）API 最新价格：输入 ¥6.00、输出 ¥18.00 每百万 tokens，上下文 262K。'
const hyP = extractPrices(hy)
ok(hyP.length > 0 && hyP[0].raw.input === 6 && hyP[0].raw.output === 18, '混元那句也对：' + (hyP[0] ? hyP[0].raw.input + '/' + hyP[0].raw.output : '无'))

// 抽不出来就该是空的，不许猜
const junk = '这个故事讲了一个人在城市里生活，他有两只猫，一共花了 30 块钱买了猫粮，走了 3 公里回家。'
ok(extractPrices(junk).length === 0, '没有价目结构的文本不产出候选（不瞎编）')

// ---------- 2) 名字与相似度 ----------
console.log('\n[2] 相似度')
ok(normName('OpenAI:GPT-6.Astra') === 'openai-gpt-6-astra' || normName('openai:gpt-6.astra') === 'gpt-6-astra', 'normName：' + normName('openai:gpt-6.astra'))
ok(stripDate('gpt-6-astra-20250926') === 'gpt-6-astra', 'stripDate 去掉日期尾巴：' + stripDate('gpt-6-astra-20250926'))

const s1 = similarity('gpt-6o', 'gpt-6-astra')
const s2 = similarity('gpt-6o', 'glm-5.3-flash')
const s3 = similarity('glm-5.3-highspeed', 'glm-5.3-flash')
const s4 = similarity('hy4-preview', 'hy4')
console.log('    gpt-6o~gpt-6-astra=' + s1 + '  gpt-6o~glm-5.3-flash=' + s2 + '  glm高速~glm-flash=' + s3 + '  hy4-preview~hy4=' + s4)
ok(s1 > 0.5, 'gpt-6o 跟 gpt-6-astra 够像（>0.5）')
ok(s2 < s1, 'gpt-6o 跟 glm 不该比跟 gpt 更像')
ok(s3 > 0.5 && s4 > 0.5, '家族内的高/低配版本都认得出来')
ok(similarity('abc', 'abc') === 1, '同一个名字 = 1')

const near = nearest('gpt-6o', { ...REFERENCE, 'glm-5.3': REFERENCE['glm-5.3'] })
ok(near.length > 0 && near[0].model === 'gpt-6-astra', 'nearest(gpt-6o) 第一名是 gpt-6-astra，实际 ' + (near[0] && near[0].model))

// ---------- 3) 单个索引（离线：只走参考目录 + 相似）----------
console.log('\n[3] indexOne（offline）')
const r1 = await indexOne('gpt-6-astra', { offline: true })
ok(r1.kind === 'reference' && r1.price[1] === 10, '内置目录里有精确价：' + r1.kind + ' ' + JSON.stringify(r1.price))

const r2 = await indexOne('gpt-6o', { offline: true })
ok(r2.kind === 'similar' && r2.from === 'gpt-6-astra', '找不到 gpt-6o 就借 gpt-6-astra：' + r2.kind + ' from=' + r2.from + ' score=' + r2.score)

const r3 = await indexOne('zzz-nothing-here', { offline: true })
ok(r3.kind === 'none', '完全不像的就给 none，不硬凑：' + r3.kind)

// ---------- 4) 落盘形状 ----------
console.log('\n[4] indexModels 落盘')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'price-index-'))
const autoFile = path.join(tmp, 'cost-prices.auto.json')
const out = await indexModels({ models: ['gpt-6-astra', 'gpt-6o'], autoFile, offline: true, write: true })
ok(out.ok === true, '跑完 ok')
const doc = JSON.parse(fs.readFileSync(autoFile, 'utf8'))
ok(!!doc.models['gpt-6-astra'] && !!doc.models['gpt-6o'], '两个模型都写进去了')
ok(doc.models['gpt-6o'].from === 'gpt-6-astra', 'gpt-6o 的 from 记成 gpt-6-astra（面板要拿它标「公式：」）')
ok(Array.isArray(doc.models['gpt-6-astra'].peak) && doc.models['gpt-6-astra'].peak.length === 3, 'peak 是三元组')
// 美元要折成人民币进表
const p = doc.models['gpt-6-astra']
ok(p.currency === 'USD' && p.peak[1] > 50, '美元价折成人民币（peak[1]=' + p.peak[1] + '），原始价留在 price=' + JSON.stringify(p.price))
console.log('    auto 文件：' + autoFile)

console.log(bad ? `\n✗ ${bad} 项没过` : '\n✓ 全部通过')
process.exit(bad ? 1 : 0)
