// 发请求 + 右键菜单。service worker 的 fetch 不受页面 CORS 限制。
//
// 两条入口：
//  ① 右键「溟：指一段」→ 页面进入指认模式，光标指到哪块就高亮哪块，点一下交出去。
//  ② 选中一段字 → 右键「交给溟：看这段」/ Ctrl+Alt+S（兜底）。
//
// 2026-11-17（I 并进桌宠）：
//   · 目标从 sidecar 的 47322（POST 就覆盖、没配对、没请求身份）换成桌宠插件自己的口：
//       http://127.0.0.1:51557/dsh-ming-mousepet/api/webpick/pick
//   · 带 token（选项页填），带 requestId；上一段没取走时服务端回 409，**这里如实说，不重试、不覆盖**。
//   · 47322 那条老路不再作为默认；要回退在选项页把地址改回去即可。

const DEFAULT_ENDPOINT = 'http://127.0.0.1:51557/dsh-ming-mousepet/api/webpick'
const ENDPOINT_KEY = 'endpoint'
const TOKEN_KEY = 'token'

function cfg() {
  return chrome.storage.local.get([ENDPOINT_KEY, TOKEN_KEY]).then((s) => ({
    endpoint: String(s[ENDPOINT_KEY] || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
    token: String(s[TOKEN_KEY] || ''),
  }))
}

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function notify(title, message) {
  try {
    chrome.notifications.create('ming-' + Date.now(), {
      type: 'basic',
      iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      title,
      message,
    })
  } catch { /* 通知失败不影响主流程 */ }
}

/** 发一段给桌宠。返回 {ok, why}；content.js 用 ok 决定页面上的提示。 */
async function send(payload) {
  const { endpoint, token } = await cfg()
  const p = payload || {}
  const text = String(p.text || '')
  if (!text) return { ok: false, why: 'empty' }
  if (!token) {
    notify('还没配对', '打开扩展的选项页，把 token 填进去')
    try { chrome.runtime.openOptionsPage() } catch { /* 没有选项页就算了 */ }
    return { ok: false, why: 'no-token' }
  }
  const body = {
    requestId: newId(),
    url: String(p.url || ''),
    title: String(p.title || ''),
    text,
    source: 'mousepet-extension',
  }
  let res, j
  try {
    res = await fetch(endpoint + '/pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ming-token': token },
      body: JSON.stringify(body),
    })
    j = await res.json().catch(() => ({}))
  } catch {
    notify('连不上桌宠', '确认 DSH 在跑（' + endpoint + '）')
    return { ok: false, why: 'network' }
  }
  if (res.ok && j && j.ok) {
    notify('已经交过去了', j.chars + ' 字')
    return { ok: true }
  }
  if (res.status === 401) {
    notify('配对失败', 'token 不对。去选项页重新填一次')
    try { chrome.runtime.openOptionsPage() } catch { /* ignore */ }
    return { ok: false, why: 'token' }
  }
  if (res.status === 409) {
    notify('上一段还没取走', '等鱼看完这段再发下一段（不覆盖）')
    return { ok: false, why: 'busy' }
  }
  if (res.status === 413) {
    notify('太长了', '一段最多 2 万字')
    return { ok: false, why: 'too-large' }
  }
  notify('没发出去', (j && j.why) || ('HTTP ' + res.status))
  return { ok: false, why: (j && j.why) || 'http-' + res.status }
}

function makeMenu() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'ming-pick-block',
        title: '溟：指一段',
        contexts: ['page', 'frame', 'image', 'link'],
      })
      chrome.contextMenus.create({
        id: 'ming-webpick',
        title: '交给溟：看这段',
        contexts: ['selection'],
      })
    })
  } catch {
    /* 建过就忽略 */
  }
}

chrome.runtime.onInstalled.addListener(makeMenu)
chrome.runtime.onStartup.addListener(makeMenu)
makeMenu()

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ming-pick-block') {
    if (!tab || !tab.id) return
    // 页面里没有 content script（比如刚装完扩展、页面没刷新）时静默失败，不去注入。
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'webpick-toggle' })
    } catch {
      /* ignore */
    }
    return
  }
  if (info.menuItemId !== 'ming-webpick') return
  const text = String(info.selectionText || '').trim()
  if (!text) return
  send({ text: text.slice(0, 20000), url: info.pageUrl || '', title: '' })
})

// 快捷键（Ctrl+Alt+S）和指认模式都从这里出去。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return
  if (msg.type === 'webpick') {
    send(msg.payload || {}).then(sendResponse)
    return true
  }
  if (msg.type === 'webpick-state') {
    // 页面那边交完/取消了：只回执，不转发（本机不需要知道「没交」）。
    sendResponse({ ok: true })
    return true
  }
})
