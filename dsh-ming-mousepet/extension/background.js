// 发请求 + 右键菜单。service worker 的 fetch 不受页面 CORS 限制。
//
// 两条入口：
//  ① 右键「溟：指一段」→ 页面进入指认模式，光标指到哪块就高亮哪块，点一下交出去。
//  ② 选中一段字 → 右键「交给溟：看这段」/ Ctrl+Alt+S（兜底，老路照旧）。

const PICK_URL = 'http://127.0.0.1:47322/webpick'

function send(payload) {
  return fetch(PICK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((j) => Boolean(j && j.ok))
    .catch(() => false)
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
  send({ text: text.slice(0, 4000), url: info.pageUrl || '', title: '', tag: 'selection' })
})

// 快捷键（Ctrl+Alt+S）和指认模式都从这里出去。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return
  if (msg.type === 'webpick') {
    send(msg.payload || {}).then((ok) => sendResponse({ ok }))
    return true
  }
  if (msg.type === 'webpick-state') {
    // 页面那边交完/取消了：只回执，不转发（本机不需要知道「没交」）。
    sendResponse({ ok: true })
    return true
  }
})
