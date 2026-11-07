/**
 * skills-lib.test.mjs —— 拿真数据验一遍 skill 开关的服务端逻辑（2026-11-08）
 *
 * 为什么这么验：index.js 的改动要重启 DSH 才生效，重启归她。
 * 这一层是纯函数，能当场跑，就别靠"重启完看看"。
 *
 *   node skills-lib.test.mjs
 *
 * 只读真磁盘、只写临时文件，不碰 skills-off.json 本身。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listSkills, toggleSkill, parseFrontmatter } from './skills-lib.mjs'

const cwd = 'C:\\dsh\\hers_workplace'
const offFile = path.join(os.tmpdir(), 'ming-skills-off.test.json')
try { fs.unlinkSync(offFile) } catch {}

let bad = 0
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++ }

// 1) 磁盘兜底：服务拿不到时也得有清单
const r1 = await listSkills({ cwd, offFile })
console.log('\n[1] 无服务（磁盘兜底）：' + r1.total + ' 个 → ' + r1.rows.slice(0, 4).map((x) => x.name).join(', '))
ok(r1.total >= 10, '磁盘扫出至少 10 个 skill（实际 ' + r1.total + '）')
ok(r1.rows.every((x) => x.name && typeof x.desc === 'string'), '每行都有 name 和 desc')
ok(r1.rows.every((x) => x.on === true), '一个都没关时全为 on')

// 2) 真 frontmatter
const one = r1.rows.find((x) => x.path)
const fm = one ? parseFrontmatter(fs.readFileSync(one.path, 'utf8')) : {}
console.log('\n[2] frontmatter：' + (one ? one.name + ' → ' + JSON.stringify(fm).slice(0, 120) : '(没有带路径的行)'))
ok(!!one && fm.name === one.name, '解析出的 name 与列出来的 name 一致')
ok(!!fm.description, 'description 抠得出来')

// 3) 服务优先 + 遮罩条目不当描述来源
const fake = {
  async list() {
    return [
      { name: 'humanizer', description: '服务给的描述', source: 'user-dsh', provider: 'filesystem' },
      { name: 'dsh-plugin-dev', description: '插件开发', source: 'bundled', provider: 'pkg' },
      { name: 'awake', description: '（本工作区已隔离——溟关掉的，模型不可见）', source: 'custom', provider: 'ming-skill-isolate' },
    ]
  },
}
const r2 = await listSkills({ cwd, offFile, service: fake })
const h = r2.rows.find((x) => x.name === 'humanizer')
console.log('\n[3] 有服务：source=' + r2.source + '，humanizer 描述=' + JSON.stringify((h || {}).desc))
ok(r2.source === 'service', 'source 标成 service')
ok(h && h.desc === '服务给的描述', '服务给的描述优先')
ok(r2.rows.some((x) => x.name === 'dsh-plugin-dev'), '包里自带的 skill（磁盘上没有）也从服务里出来了')
ok(!r2.rows.some((x) => x.name === 'awake' && /隔离/.test(x.desc)), '遮罩条目的说明没有当成描述')

// 4) 开关：写文件 → 立刻回读生效 → 再开回来
const t1 = await toggleSkill('dsh-plugin-dev', false, { cwd, offFile, service: fake })
const off1 = JSON.parse(fs.readFileSync(offFile, 'utf8')).off
const row1 = t1.rows.find((x) => x.name === 'dsh-plugin-dev')
console.log('\n[4] 关掉 dsh-plugin-dev：文件=' + JSON.stringify(off1) + '，面板里 on=' + (row1 && row1.on))
ok(off1.indexOf('dsh-plugin-dev') >= 0, 'skills-off.json 里写进去了')
ok(row1 && row1.on === false, '回读时 on=false')
const t2 = await toggleSkill('dsh-plugin-dev', true, { cwd, offFile, service: fake })
const off2 = JSON.parse(fs.readFileSync(offFile, 'utf8')).off
console.log('    再开回来：文件=' + JSON.stringify(off2) + '，offCount=' + t2.offCount)
ok(off2.length === 0, '开回来之后文件里空了')
ok(t2.offCount === 0, 'offCount 归零')

// 5) 孤儿名字：关了但清单里没有，也要留一行
fs.writeFileSync(offFile, JSON.stringify({ off: ['this-skill-does-not-exist'], note: 'test' }))
const r3 = await listSkills({ cwd, offFile })
const orphan = r3.rows.find((x) => x.name === 'this-skill-does-not-exist')
console.log('\n[5] 孤儿名字：' + (orphan ? orphan.desc : '(没留下)'))
ok(!!orphan && orphan.on === false, '文件里有、清单里没有的名字也留在面板上（关着）')

try { fs.unlinkSync(offFile) } catch {}
console.log('\n' + (bad ? bad + ' 项没过' : '全部通过'))
process.exit(bad ? 1 : 0)
