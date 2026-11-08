import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source = fs.readFileSync(new URL('./index.js', import.meta.url),'utf8')
function harness(fetch) {
 const timers=new Set(); const box={fetch,AbortController,Error,Promise,setTimeout(fn){timers.add(fn);return fn},clearTimeout(fn){timers.delete(fn)}}
 const start=source.indexOf('async function requestBody('); assert.notEqual(start,-1,'bounded request helper exists')
 vm.runInNewContext(source.slice(start,source.indexOf('\nasync function api(',start))+'\nglobalThis.request=requestBody',box)
 return {request:box.request,timers,fire(){for(const fn of [...timers])fn()}}
}
test('deadline bounds headers and aborts network once',async()=>{let signal,calls=0;const h=harness((_url,init)=>{calls++;signal=init.signal;return new Promise(()=>{})});const p=h.request('fake',{});h.fire();await assert.rejects(p,/deadline/);assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(h.timers.size,0)})
test('deadline also bounds body read',async()=>{const h=harness(async()=>({text:()=>new Promise(()=>{})}));const p=h.request('fake',{});await Promise.resolve();h.fire();await assert.rejects(p,/deadline/);assert.equal(h.timers.size,0)})
test('caller cancellation before dispatch and during body never retries',async()=>{let calls=0;const h=harness(async()=>{calls++;return{text:()=>new Promise(()=>{})}});const c=new AbortController();c.abort(new Error('cancelled'));await assert.rejects(h.request('fake',{signal:c.signal}),/cancelled/);assert.equal(calls,0);const d=new AbortController();const p=h.request('fake',{signal:d.signal});await Promise.resolve();d.abort(new Error('cancelled'));await assert.rejects(p,/cancelled/);assert.equal(calls,1);assert.equal(h.timers.size,0)})
test('successful body clears deadline and retains response headers',async()=>{const res={headers:{},text:async()=>'{"code":0}'};const h=harness(async()=>res);const got=await h.request('fake',{});assert.equal(got.res,res);assert.equal(got.text,'{"code":0}');assert.equal(h.timers.size,0)})
