import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import path from 'node:path'
let seq = 0
const flush = async () => { for (let i=0;i<40;i++) await Promise.resolve() }
async function harness(resume) {
  let arm = { dueAt: 1, armedAt: 1, sessionId: 'fake', reason: 'test' }, tick, tool
  const files = new Map()
  const source = (await readFile(new URL('./index.js', import.meta.url), 'utf8')).replace(/^import .*$/mg,'').replace(/export /g,'')
  const sandbox = { path, Date, JSON, Promise, console, randomUUID: ()=>'id-'+(++seq),
    readFile: async p => p.endsWith('wake-arm.json') ? JSON.stringify(arm) : files.get(p),
    writeFile: async (p,s)=> { if(p.endsWith('wake-arm.json')) arm=JSON.parse(s); else files.set(p,s) },
    rename: async (from,to)=> { arm=JSON.parse(files.get(from)); files.delete(from) },
    unlink: async p=>files.delete(p), mkdir: async()=>{}, appendFile: async()=>{} }
  vm.runInNewContext(source+'\nthis.apply = apply',sandbox)
  const ctx={inject(_s,f){f(this)},effect(f){return f()},tools:{register(t){tool=t}},timer:{interval(f){tick=f;return ()=>{}}},agents:{resume}}
  sandbox.apply(ctx,{root:'FAKE'})
  return {tick:()=>tick(), read:()=>arm, tool:()=>tool, set:r=>{arm=r}}
}
test('failed resume is explicitly unknown, not fired; no blind retry',async()=>{
 let calls=0;const h=await harness(async()=>{calls++;throw Error('ambiguous')})
 await h.tick();await flush(); assert.equal(h.read().firedAt,undefined);assert.equal(h.read().status,'unknown')
 await h.tick();await flush();assert.equal(calls,1)
})
test('overlapping timer callbacks dispatch once',async()=>{
 let calls=0,done;const h=await harness(()=>{calls++;return new Promise(r=>done=r)})
 h.tick();h.tick();await flush();assert.equal(calls,1);done({});await flush();assert.ok(h.read().firedAt)
})
test('new arm survives completion of old in-flight resume',async()=>{
 let done;const h=await harness(()=>new Promise(r=>done=r));h.tick();await flush()
 await h.tool().execute({minutes:1,reason:'new',sessionId:'new-fake'})
 const id=h.read().armId;assert.ok(id);done({});await flush();assert.equal(h.read().armId,id);assert.equal(h.read().firedAt,undefined)
})
test('attempting record after crash is held unknown without dispatch',async()=>{
 let calls=0;const h=await harness(async()=>{calls++});h.set({armId:'crash',dueAt:1,sessionId:'fake',status:'attempting'})
 await h.tick();await flush();assert.equal(calls,0);assert.equal(h.read().status,'unknown')
})
