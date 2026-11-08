import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'
const source=await readFile(new URL('./index.js',import.meta.url),'utf8')
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)))
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
test('wake reserves before awaiting prompt and releases after success',async()=>{
 const gate=deferred();let calls=0, prompts=0
 const code=slice('  const wake = async','  /**\n   * 把')
 const sandbox={Date,randomUUID:()=>'',cfg:{targetMode:'qq',workspacePath:'fake'},path:{join:(...a)=>a.join('/')},writeFile:async()=>{},rm:async()=>{},justRotated:false,pickTarget:()=>({id:'fake',followup:()=>calls++}),running:new Set(),guarded:null,promptFor:()=>{prompts++;return gate.promise},lastWake:0,wakesToday:0,lastActivity:0,roundId:null,roundStartedAt:0,roundSeenAt:0,log:()=>{},existsSync:()=>false,unlimitedFile:'fake',sharePendingFor:null}
 const wake=vm.runInNewContext('let wakePending=false;\n'+code+'\nwake',sandbox)
 const first=wake();const second=wake();assert.equal(prompts,1);gate.resolve('fake');await Promise.all([first,second]);assert.equal(calls,1);await wake();assert.equal(calls,2)
})
test('prompt rejection permits retry; dispatch throw blocks retry',async()=>{
 let prompts=0,calls=0;const files=new Set()
 const sandbox={Date,randomUUID:()=>'',cfg:{targetMode:'qq',workspacePath:'fake'},path:{join:(...a)=>a.join('/')},writeFile:async p=>files.add(p),rm:async p=>files.delete(p),justRotated:false,pickTarget:()=>({id:'fake',followup:()=>{calls++;throw Error('ambiguous')}}),running:new Set(),guarded:null,promptFor:async()=>{if(++prompts===1)throw Error('prompt');return 'ok'},lastWake:0,wakesToday:0,lastActivity:0,roundId:null,roundStartedAt:0,roundSeenAt:0,log:()=>{},existsSync:p=>files.has(p),unlimitedFile:'fake',sharePendingFor:null}
 const wake=vm.runInNewContext('let wakePending=false;'+slice('  const wake = async','  /**\n   * 把')+';wake',sandbox)
 const first=await wake();assert.equal(first.ok,false);assert.equal(calls,0);assert.equal(files.size,0)
 const second=await wake();assert.equal(second.status,'unknown');assert.equal(calls,1);assert.equal(files.size,1)
 await wake();assert.equal(calls,1)
})
test('tick is single flight and releases after error',async()=>{
 const gate=deferred();let reads=0
 const code=slice('  const tick = async','  // 每分钟看一次')
 const tick=vm.runInNewContext('let tickPending=false;\n'+code+'\ntick',{Date,loadHolidays:()=>{},dayKey:()=>'',wakeDay:'',wakesToday:0,readUnlimited:()=>{reads++;return gate.promise},log:()=>{}})
 const first=tick();const second=tick();const count=reads;gate.resolve(null);await Promise.all([first,second]);assert.equal(count,1);await tick();assert.equal(reads,2)
})
