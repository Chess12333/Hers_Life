import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const STATUSES = ['active', 'paused', 'completed', 'abandoned']
export function fault(status, message) { return Object.assign(new Error(message), { status }) }

function fields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fault(400, '活动内容必须是对象。')
  const result = {}
  for (const [key, label, limit] of [['title', '标题', 160], ['url', '链接', 2048], ['progress', '当前进度', 1000], ['next', '下次接着做', 1000]]) {
    if (typeof input[key] !== 'string' || input[key].length > limit) throw fault(400, label + '应是文本，最多 ' + limit + ' 字符。')
    result[key] = input[key].trim()
  }
  if (!result.title) throw fault(400, '请填写活动标题。')
  if (result.url) {
    try { if (!['https:', 'http:'].includes(new URL(result.url).protocol)) throw new Error() }
    catch { throw fault(400, '链接应以 https:// 或 http:// 开头，也可以留空。') }
  }
  if (!STATUSES.includes(input.status)) throw fault(400, '活动状态不正确。')
  return { ...result, status: input.status }
}

export function createActivityStore(root) {
  const file = root ? join(root, 'live', 'shared-activities.json') : null
  let tail = Promise.resolve()
  const read = async () => {
    if (!file) throw fault(503, '还没有配置活动目录：请设置 MING_WORKSPACE 或本插件的 root，然后重启 DSH。')
    let raw
    try { raw = await readFile(file, 'utf8') }
    catch (e) { if (e.code === 'ENOENT') return { version: 1, revision: 0, activities: [] }; throw fault(503, '暂时无法读取活动文件，请检查目录访问权限。') }
    try {
      const data = JSON.parse(raw)
      if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.activities)) throw new Error()
      const ids = new Set()
      for (const activity of data.activities) {
        fields(activity)
        if (typeof activity.id !== 'string' || !activity.id || ids.has(activity.id) ||
          typeof activity.created !== 'string' || typeof activity.updated !== 'string' ||
          !Number.isFinite(Date.parse(activity.created)) || !Number.isFinite(Date.parse(activity.updated))) throw new Error()
        ids.add(activity.id)
      }
      return data
    } catch { throw fault(503, '活动文件损坏或版本不受支持，已保留原文件。请先备份检查，不要覆盖成空列表。') }
  }
  const mutate = request => {
    const run = tail.then(async () => {
      const data = await read()
      if (!request || typeof request !== 'object' || !Number.isSafeInteger(request.revision)) throw fault(400, '缺少列表版本，请刷新后重试。')
      if (request.revision !== data.revision) throw fault(409, '活动已在别处更新。草稿仍保留，请刷新列表、核对内容后重试。')
      const now = new Date().toISOString()
      if (request.action === 'create') {
        data.activities.push({ ...fields(request.activity), id: randomUUID(), created: now, updated: now })
      } else if (request.action === 'update' || request.action === 'delete') {
        const index = data.activities.findIndex(a => a.id === request.id)
        if (index < 0) throw fault(404, '这张活动卡已不存在，请刷新列表。')
        if (request.action === 'delete') data.activities.splice(index, 1)
        else data.activities[index] = { ...data.activities[index], ...fields(request.activity), updated: now }
      } else throw fault(400, '不支持这个操作。')
      data.revision++
      await mkdir(dirname(file), { recursive: true })
      const temp = file + '.tmp-' + randomUUID()
      try {
        await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
        await rename(temp, file)
      } catch {
        await unlink(temp).catch(() => {})
        throw fault(503, '保存失败，请检查目录空间或权限。尚未确认保存成功，刷新列表后核对。')
      }
      return data
    })
    tail = run.catch(() => {})
    return run
  }
  return { read, mutate }
}
