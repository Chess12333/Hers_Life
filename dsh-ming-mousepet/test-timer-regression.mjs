import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const src = await readFile(new URL('./lib/talker.js', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('  let timer = null'), src.indexOf('  scheduleNext().catch'))
let state = { gapMode: 'fixed', minGapMinutes: 1 }, timers = new Map(), id = 0, ticks = 0
const ctx = vm.createContext({
 Date, stopped:false, generation:0, midTimer:null,
 loadPetState:async()=>({...state}), updatePetState:async fn=>(state=fn(state)),
 schedGapMs:s=>s.gapMode==='off'?0:s.minGapMinutes*60000,
 setTimeout:(fn,ms)=>{const t={id:++id,unref(){}};timers.set(t,{fn,ms});return t},
 clearTimeout:t=>timers.delete(t), tick:async()=>{ticks++}, say:()=>{}
})
vm.runInContext(body+';globalThis.reschedule=scheduleNext;',ctx)
await ctx.reschedule()
assert.equal(timers.size,1);assert.ok([...timers.values()][0].ms<=60000)
const old=[...timers.values()][0]
state.minGapMinutes=2;await ctx.reschedule()
assert.equal(timers.size,1);assert.ok([...timers.values()][0].ms>119000)
old.fn();await Promise.resolve();assert.equal(ticks,0)
state.gapMode='off';await ctx.reschedule();assert.equal(timers.size,0);assert.equal(state.nextAt,0)
ctx.stopped=true;await ctx.reschedule();assert.equal(timers.size,0)
console.log('PASS fixed timer, immediate reschedule, stale callback, off, stopped')
