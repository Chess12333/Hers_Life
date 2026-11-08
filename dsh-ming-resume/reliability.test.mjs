import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import path from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
const source = (await readFile(new URL('./index.js', import.meta.url),'utf8')).replace(/^import .*$/mg,'').replace(/export /g,'')
function setup({ failRead = false } = {}) {
 const handlers = {}; const keys = []; let playing = true; let syncCalls = 0
 const execute = (args) => { if(args.includes('dumpsys audio')) { if(failRead) throw Error('offline'); return playing ? 'state:started USAGE_MEDIA' : '' }; const key=Number(args.at(-1)); keys.push(key); playing = key===85 ? !playing : key===126; return '' }
 const box = { path, randomUUID:()=> 'injected', readFile:async()=>'{"doing":"fake task"}',appendFile:async()=>{},setTimeout:(fn)=>{queueMicrotask(fn)},execFileSync:(_p,args)=>{syncCalls++;return execute(args)},execFile:(_p,args,_opts,cb)=>queueMicrotask(()=>{try { cb(null,execute(args)) } catch(e){cb(e)}}),ctx:{on:(name,fn)=>handlers[name]=fn,inject:()=>{}} }
 vm.runInNewContext(source+'\napply(ctx, {});',box)
 const step = (agent,turn,messages=[])=> handlers['agent/pre-step']({agent,turn,messages},async()=>({kind:'enter',messages:[]}))
 return {keys,step, stop:(agent,turn)=>handlers['agent/turn-stopping']({agent,turn}),syncCalls:()=>syncCalls}
}
const steer = [{id:'one',source:{kind:'plugin:dsh-onebot'}}]
test('ADB uses async subprocess only',async()=>{const h=setup();await h.step({id:'a'}, 0,steer);assert.equal(h.syncCalls(),0)})
test('unrelated agent and older turn cannot resume owner media',async()=>{const h=setup();const a={id:'a'},t=0;await h.step(a,t,steer);assert.deepEqual(h.keys,[85]);await h.stop({id:'b'},0);await h.stop(a,1);assert.deepEqual(h.keys,[85]);await h.stop({id:'a'},t);assert.deepEqual(h.keys,[85,85])})
test('failed state read does not send keys or claim idle',async()=>{const h=setup({failRead:true});const r=await h.step({id:'a'}, 0,steer);assert.deepEqual(h.keys,[]);assert.match(r.messages[0].content[0].text,/未知/ )})
