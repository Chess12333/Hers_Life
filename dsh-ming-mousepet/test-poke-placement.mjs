import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const source = readFileSync(new URL('./lib/talker.js', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('  async function poke(evt)'), source.indexOf('  async function tick()'))
for (const size of [24, 64, 192]) {
 const calls = []; let composed
 // 2026-11-09 00:2x：poke 里引用了闭包变量 stopped，这个沙箱只给了 running，
 // 于是这份测试一跑就 ReferenceError —— 测试自己漏了一格，不是产品坏了。
 const ctx = vm.createContext({ running:false, stopped:false, llm:{stream(){}}, Date, Math, Number, Promise,
 setTimeout:()=>0, clockLine:()=>'', say:()=>{},
 engine:{cursorSize:size, async request(action,args){calls.push({action,args});return {}}},
 compose:async(rows,status,opts)=>{composed=opts;return {spoken:true,line:'test'}} })
 vm.runInContext(body+';this.poke=poke',ctx)
 await ctx.poke({x:1000,y:600})
 const target=calls.find(c=>c.action==='glide').args
 assert.ok(target.x+size < 1000 && target.y+size < 600, `size=${size}: entire sprite must be upper-left; got ${JSON.stringify(target)}`)
 assert.equal(composed.anchor.x,target.x)
 assert.equal(composed.anchor.y,target.y)
 console.log(`PASS size=${size}: (${target.x},${target.y}), bubble shares anchor`)
}
