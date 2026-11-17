// Import the complete plugin in a clean ESM environment; only host packages are stubs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('complete ESM entry and social tools load without require or real credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ming-bili-load-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(new URL('.', import.meta.url), join(root, 'plugin'), { recursive: true })
  const stubs = {
    'dsh-tools': 'export const defineTool = x => x;',
    'dsh-attachment': 'export const AttachmentId = x => x;',
    'dsh-llm': 'export const createUserMessage = x => x;',
  }
  for (const [name, code] of Object.entries(stubs)) {
    const dir = join(root, 'node_modules', '@deepseek-ai', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
    await writeFile(join(dir, 'index.js'), code)
  }
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const errors = []
  globalThis.fetch = () => { throw new Error('network must not run while loading') }
  console.error = (...args) => errors.push(args.join(' '))
  t.after(() => { globalThis.fetch = originalFetch; console.error = originalError })
  const { apply } = await import(pathToFileURL(join(root, 'plugin/index.js')))
  const names = []
  const ctx = { tools: { register: d => names.push(d.name) }, systemPrompt: { section() {} },
    inject(_deps, fn) { fn(this) }, attachments: {} }
  apply(ctx, { credentialFile: join(root, 'absent-credentials.json') })
  for (const name of ['bili_login', 'bilibili_search', 'bilibili_video', 'bilibili_frames'])
    assert.ok(names.includes(name), name + ' should register')
  assert.ok(names.some(n => /comment/.test(n)), 'social tools should register')
  assert.deepEqual(errors, [], 'no swallowed registration errors')
})
