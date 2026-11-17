import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pet from './lib/pet.js'

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'mousepet-state-test-'))
  const file = join(dir, 'state.json')
  return { dir, file, store: pet.createPetStateStore(file) }
}
test('serialized updates preserve settings and counters; disk is valid JSON', async () => {
  const { store, file } = await fixture()
  await Promise.all(Array.from({length: 30}, (_, i) => store.update(async state => {
    await Promise.resolve()
    return { ...state, count: (state.count || 0) + 1, ...(i === 7 ? {dailyMax: -1, minGapMinutes: 1} : {}) }
  })))
  const state = await store.load()
  assert.equal(state.count, 30)
  assert.equal(state.dailyMax, -1)
  assert.equal(state.minGapMinutes, 1)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).count, 30)
})
test('failed updater does not poison queue or overwrite previous state', async () => {
  const {store} = await fixture()
  await store.save({count: 8})
  await assert.rejects(store.update(() => {throw new Error('injected')}), /injected/)
  await assert.rejects(store.update(() => null), /object/)
  assert.equal((await store.update(s => ({...s, count:s.count+1}))).count, 9)
})
test('read and write failures reject, not defaults or fake success', async () => {
  const {store, file, dir} = await fixture()
  await writeFile(file, '{broken')
  await assert.rejects(store.load(), SyntaxError)
  await assert.rejects(store.update(s => ({...s, count:1})), SyntaxError)
  assert.equal(await readFile(file, 'utf8'), '{broken')
  const blocked = join(dir, 'directory.json')
  await mkdir(blocked)
  await assert.rejects(pet.createPetStateStore(blocked).save({count:1}))
  assert.equal((await readdir(dir)).some(n => n.endsWith('.tmp')), false)
})
test('legacy literal newline and aliases migrate without losing state', async () => {
  const {store, file} = await fixture()
  await writeFile(file, JSON.stringify({schedMode:'fixed', everyMin:1, dailyCap:-1, count:7}) + '\\n')
  const state = await store.load()
  assert.equal(state.gapMode, 'fixed')
  assert.equal(state.minGapMinutes, 1)
  assert.equal(state.dailyMax, -1)
  await store.update(s => ({...s, nextAt:123}))
  assert.equal(JSON.parse(await readFile(file,'utf8')).count,7)
})
test('normalization allowlists fields, accepts aliases and canonical precedence', () => {
  assert.deepEqual(pet.normalizeSchedulePatch({schedMode:'fixed',everyMin:1,dailyCap:-1,nextAt:8}), {gapMode:'fixed',minGapMinutes:1,dailyMax:-1})
  assert.deepEqual(pet.normalizeSchedulePatch({gapMode:'off',schedMode:'fixed',minGapMinutes:2,everyMin:1,dailyMax:0,dailyCap:-1,quietHours:false}), {gapMode:'off',minGapMinutes:2,dailyMax:0,quietHours:false})
})
