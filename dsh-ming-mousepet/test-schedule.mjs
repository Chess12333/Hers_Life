import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { judgeNudge, schedGapMs, dayKey } from './lib/pet.js'
const now = new Date(2026, 10, 8, 23, 0)
let failed = 0
async function test(name, fn) { try { await fn(); console.log('PASS', name) } catch(e) { failed++; console.log('FAIL', name, e.message) } }
await test('unlimited means unlimited', () => assert.equal(judgeNudge({now, status:{}, state:{quietHours:false,dailyMax:-1,spokenToday:{day:dayKey(now),count:7}}}).speak,true))
await test('zero cap still prevents speech', () => assert.equal(judgeNudge({now,status:{},state:{quietHours:false,dailyMax:0}}).speak,false))
await test('fixed one minute respects configured gap', () => assert.equal(judgeNudge({now,status:{},state:{quietHours:false,dailyMax:-1,gapMode:'fixed',minGapMinutes:1,lastSpokeAt:now.getTime()-60000}}).speak,true))
await test('state writer produces valid JSON', async () => {
 const { createPetStateStore } = await import('./lib/pet.js')
 const { mkdtemp } = await import('node:fs/promises')
 const { tmpdir } = await import('node:os')
 const { join } = await import('node:path')
 const file = join(await mkdtemp(join(tmpdir(),'pet-json-')), 'state.json')
 await createPetStateStore(file).save({gapMode:'fixed',minGapMinutes:1})
 assert.equal(JSON.parse(await readFile(file,'utf8')).gapMode,'fixed')
})
await test('all modes calculate expected intervals', () => {
 assert.equal(schedGapMs({gapMode:'fixed',minGapMinutes:1}),60000)
 assert.equal(schedGapMs({gapMode:'off'}),0)
 assert.equal(schedGapMs({gapMode:'random',minGapMinutes:1},()=>0),30000)
 assert.equal(schedGapMs({gapMode:'heartbeat',hbMin:1,hbCenter:1,hbMax:1}),60000)
})
process.exitCode=failed?1:0
