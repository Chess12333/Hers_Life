/**
 * browser-launch.mjs —— 「打开我的浏览器」那一步的全部逻辑。
 *
 * 2026-11-09 00:0x 她定的用法：面板上只要一个按钮。她要自己去干的那几件
 * （联合投稿、投视频）必须弹系统的选文件框，嵌在网页面里点不到，所以按钮
 * 打开的是**真窗口**：edge-ming 这个独立 profile，带 9222 调试口，
 * 登录态、插件、cookie 都在，跟 my-browser.mjs 打开的是同一个。
 *
 * 两种情形分开处理：
 *   · 9222 已经活着 → 不另起进程，把已有标签激活（没有合适的就新开一个）。
 *     另起一个 msedge 进程会在同一个窗口里刷标签，看着像「点了没反应」。
 *   · 没活 → 起一个，等调试口起来再返回。
 *
 * 单独跑：node browser-launch.mjs [url]      ← 自测用，打印结果 JSON
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export const DEFAULTS = {
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  profile: 'C:\\dsh\\edge-ming',
  port: 9222,
  // 她的场景是投稿，所以默认落在创作中心首页；具体哪个页面她在窗口里自己点。
  url: 'https://member.bilibili.com/platform/home',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function httpJson(url, init) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 1500)
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, init || {}))
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** 调试口活着就返回它的版本信息，否则 null。 */
export async function probe(port = DEFAULTS.port) {
  return httpJson(`http://127.0.0.1:${port}/json/version`)
}

function pickTarget(list, wantUrl) {
  const pages = (list || []).filter((t) => t && t.type === 'page' && t.webSocketDebuggerUrl)
  if (!pages.length) return null
  try {
    const host = new URL(wantUrl).host
    const hit = pages.find((t) => String(t.url || '').includes(host))
    if (hit) return hit
  } catch { /* wantUrl 不是合法 URL 就按第一个来 */ }
  return pages[0]
}

/**
 * 打开/唤起我的浏览器。返回 { ok, action, url, title?, error? }。
 * action: 'activated'（原窗口提到了前台）| 'new-tab'（新开了标签）| 'launched'（新起了进程）
 */
export async function openMyBrowser(opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts)
  const wantUrl = String(o.url || DEFAULTS.url)

  const alive = await probe(o.port)
  if (alive) {
    const list = await httpJson(`http://127.0.0.1:${o.port}/json/list`)
    const t = pickTarget(list, wantUrl)
    if (t) {
      // /json/activate/<id> 是 HTTP 接口，不用开 WS：把那个标签切到前台。
      await httpJson(`http://127.0.0.1:${o.port}/json/activate/${t.id}`)
      return { ok: true, action: 'activated', url: t.url || '', title: t.title || '', port: o.port }
    }
    const created = await httpJson(`http://127.0.0.1:${o.port}/json/new?${encodeURIComponent(wantUrl)}`, { method: 'PUT' })
    if (created && created.id) {
      return { ok: true, action: 'new-tab', url: created.url || wantUrl, title: created.title || '', port: o.port }
    }
    return { ok: false, error: '调试口活着，但列不出标签页，也没能新开一个' }
  }

  if (!existsSync(o.edge)) {
    return { ok: false, error: '找不到 msedge.exe：' + o.edge }
  }

  const args = [
    `--user-data-dir=${o.profile}`,
    `--remote-debugging-port=${o.port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session=false',
    wantUrl,
  ]
  // 起壳环境里带着 ELECTRON_RUN_AS_NODE 之类的注入变量，别让浏览器继承过去。
  const env = Object.assign({}, process.env)
  for (const k of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'NODE_OPTIONS']) delete env[k]

  try {
    const child = spawn(o.edge, args, { detached: true, stdio: 'ignore', env })
    child.unref()
  } catch (e) {
    return { ok: false, error: '起进程失败：' + String((e && e.message) || e) }
  }

  // 窗口先出来，调试口要再等一会儿。等不到不算失败——窗口可能已经开了。
  for (let i = 0; i < 30; i++) {
    await sleep(400)
    const v = await probe(o.port)
    if (v) return { ok: true, action: 'launched', url: wantUrl, port: o.port, waitedMs: (i + 1) * 400 }
  }
  return { ok: true, action: 'launched', url: wantUrl, port: o.port, note: '窗口起来了，调试口 12 秒内没响应（不影响你操作）' }
}

// 自测：node browser-launch.mjs [url]
if (process.argv[1] && process.argv[1].endsWith('browser-launch.mjs')) {
  const url = process.argv[2]
  openMyBrowser(url ? { url } : {}).then((r) => console.log(JSON.stringify(r, null, 2)))
}
