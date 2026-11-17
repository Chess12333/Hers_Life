import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('memory inspector reads actual files without changing stored memories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ming-inspector-'))
  const prior = process.env.DSH_HOME
  process.env.DSH_HOME = root
  t.after(async () => { if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior; await rm(root, { recursive: true, force: true }) })
  const notes = join(root, 'memory/notes')
  await mkdir(notes, { recursive: true })
  const originals = {
    old: '---\ntitle: Old fact\nstatus: superseded\nsource: agent_inference\nsuperseded_by: new\n---\nThe old body',
    new: '---\ntitle: New fact\nstatus: active\nsource: direct_observation\nmerged_from: old, extra\nlast_confirmed: 2026-11-17\n---\n<script>unsafe()</script>',
    legacy: 'Legacy plain Markdown body',
    deleted: '---\ndeleted: true\n---\nHidden body',
  }
  for (const [id, text] of Object.entries(originals)) await writeFile(join(notes, id + '.md'), text)
  const routes = new Map(), tools = {}
  const { apply } = await import('./lib/index.js')
  apply({ tools: { register(d) { tools[d.name] = d } }, systemPrompt: { section() {} },
    inject(deps, fn) { fn({ effect: fn => fn(), webServer: { register(r) { routes.set(r.path, r); return () => {} } } }) } })
  await tools.memory_core.execute({ action: 'append', section: 'test', text: 'barrier' })
  const indexBefore = await readFile(join(root, 'memory/index.json'), 'utf8')
  const route = routes.get('/dsh-core-memory/inspector')
  assert.ok(route, 'actual plugin registers the optional host route')
  const request = async (query = '', method = 'GET') => {
    let body
    const res = { statusCode: 0, setHeader() {}, end(value) { body = JSON.parse(value) } }
    await route.handler({ method, url: route.path + query }, res)
    return { code: res.statusCode, ...body }
  }
  await t.test('listing includes legacy notes and skips tombstones', async () => {
    const r = await request()
    assert.equal(r.code, 200)
    assert.equal(r.notes.length, 3)
    assert.ok(r.notes.every(n => !('body' in n)))
    assert.equal(r.notes.find(n => n.id === 'legacy').sourceLabel, '来源未知')
  })
  await t.test('details preserve source, retirement, relations and unrendered original text', async () => {
    const old = (await request('?id=old')).note
    assert.equal(old.status, 'superseded')
    assert.equal(old.supersededBy, 'new')
    assert.equal(old.source, 'agent_inference')
    const newer = (await request('?id=new')).note
    assert.deepEqual(newer.mergedFrom, ['old', 'extra'])
    assert.equal(newer.body, '<script>unsafe()</script>')
    assert.equal(newer.file, 'memory/notes/new.md')
  })
  await t.test('no writes, deleted access or path traversal', async () => {
    assert.equal((await request('', 'POST')).code, 405)
    for (const id of ['deleted', '../MEMORY', '..\\MEMORY', '/etc/passwd'])
      assert.equal((await request('?id=' + encodeURIComponent(id))).code, 404)
    for (const [id, text] of Object.entries(originals)) assert.equal(await readFile(join(notes, id + '.md'), 'utf8'), text)
    assert.equal(await readFile(join(root, 'memory/index.json'), 'utf8'), indexBefore)
  })
})
