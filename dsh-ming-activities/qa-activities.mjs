import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createActivityStore } from './store.js'
import { apply } from './index.js'

const activity = { title: '一起读一本书', url: 'https://example.com/book', progress: '第五章', next: '第六章', status: 'active' }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ming-activities-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, file: join(root, 'live/shared-activities.json'), store: createActivityStore(root) }
}
test('reading new workspace is empty and does not create any file', async t => {
  const { root, store } = await fixture(t)
  assert.deepEqual(await store.read(), { version: 1, revision: 0, activities: [] })
  assert.deepEqual(await readdir(root), [])
  await assert.rejects(createActivityStore('').read(), e => e.status === 503)
})
test('manual create, restart, edit, pause, complete, abandon and delete', async t => {
  const { root, store } = await fixture(t)
  let data = await store.mutate({ action: 'create', revision: 0, activity })
  const id = data.activities[0].id, created = data.activities[0].created
  assert.deepEqual(await createActivityStore(root).read(), data)
  for (const status of ['paused', 'completed', 'abandoned']) {
    data = await store.mutate({ action: 'update', id, revision: data.revision, activity: { ...activity, status } })
    assert.equal(data.activities[0].status, status)
    assert.equal(data.activities[0].created, created)
  }
  data = await store.mutate({ action: 'delete', id, revision: data.revision })
  assert.equal(data.activities.length, 0)
  assert.deepEqual(await createActivityStore(root).read(), data)
})
test('stale or concurrent changes cannot overwrite each other', async t => {
  const { store } = await fixture(t)
  const out = await Promise.allSettled([1, 2].map(() => store.mutate({ action: 'create', revision: 0, activity })))
  assert.equal(out.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(out.find(r => r.status === 'rejected').reason.status, 409)
  assert.equal((await store.read()).activities.length, 1)
})
test('bad inputs and active URL schemes cannot change saved data', async t => {
  const { store, file } = await fixture(t)
  const data = await store.mutate({ action: 'create', revision: 0, activity })
  const before = await readFile(file, 'utf8')
  for (const patch of [{ title: ' ' }, { title: 'a'.repeat(161) }, { url: 'javascript:alert(1)' }, { url: 'file:///C:/test' }, { progress: null }, { status: 'surprise' }])
    await assert.rejects(store.mutate({ action: 'update', revision: data.revision, id: data.activities[0].id, activity: { ...activity, ...patch } }), e => e.status === 400)
  assert.equal(await readFile(file, 'utf8'), before)
  await assert.rejects(store.mutate({ action: 'delete', revision: data.revision, id: 'missing' }), e => e.status === 404)
})
test('corrupt and future-version files are preserved rather than reset', async t => {
  const { root, file, store } = await fixture(t)
  await mkdir(join(root, 'live'))
  for (const raw of ['{bad json', '{"version":2,"revision":1,"activities":[]}']) {
    await writeFile(file, raw)
    await assert.rejects(store.read(), e => e.status === 503)
    await assert.rejects(store.mutate({ action: 'create', revision: 0, activity }), e => e.status === 503)
    assert.equal(await readFile(file, 'utf8'), raw)
  }
})
test('host route validates methods, body type and size without host/model dependencies', async t => {
  const { root } = await fixture(t)
  let route
  // No tools, models, events or timers exist in this host; only an optional web service.
  apply({ inject(_deps, fn) { fn({ effect: fn => fn(), webServer: { register(r) { route = r } } }) } }, { root })
  const request = async (method, text = '', type = 'application/json') => {
    const req = Readable.from([Buffer.from(text)]); req.method = method; req.headers = { 'content-type': type }
    let body; const res = { setHeader() {}, end(text) { body = JSON.parse(text) } }
    await route.handler(req, res)
    return { status: res.statusCode, body }
  }
  assert.equal((await request('GET')).status, 200)
  assert.equal((await request('PUT')).status, 405)
  assert.equal((await request('POST', '{}', 'text/plain')).status, 415)
  assert.equal((await request('POST', '{bad')).status, 400)
  assert.equal((await request('POST', 'a'.repeat(65537))).status, 413)
  const saved = await request('POST', JSON.stringify({ action: 'create', revision: 0, activity }))
  assert.equal(saved.status, 200)
  assert.equal(saved.body.activities[0].progress, '第五章')
  assert.equal((await request('POST', JSON.stringify({ action: 'create', revision: 0, activity }))).status, 409)
})
