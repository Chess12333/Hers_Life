// options.js —— 存配置、测连接。token 不回显明文。
const $ = (id) => document.getElementById(id)
const DEFAULT_ENDPOINT = 'http://127.0.0.1:51557/dsh-ming-mousepet/api/webpick'

async function load() {
  const s = await chrome.storage.local.get(['endpoint', 'token'])
  $('endpoint').value = s.endpoint || DEFAULT_ENDPOINT
  $('token').value = s.token || ''
}

function say(msg, cls) {
  const el = $('status')
  el.textContent = msg
  el.className = cls || ''
}

$('save').onclick = async () => {
  const endpoint = ($('endpoint').value || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '')
  const token = ($('token').value || '').trim()
  await chrome.storage.local.set({ endpoint, token })
  say('已保存。去页面选中文字右键试一下。', 'ok')
}

$('test').onclick = async () => {
  const endpoint = ($('endpoint').value || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '')
  const token = ($('token').value || '').trim()
  if (!token) return say('先填 token。', 'bad')
  try {
    const h = await fetch(endpoint + '/status')
    const hj = await h.json().catch(() => ({}))
    if (!hj.ok) return say('接收端回了，但不是我认识的样子：' + JSON.stringify(hj).slice(0, 120), 'bad')
    // 用一次注定失败的请求验 token：发空正文，token 对了回 400，不对回 401
    const r = await fetch(endpoint + '/pick', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ming-token': token },
      body: JSON.stringify({}),
    })
    if (r.status === 401) return say('连接没问题（端口 ' + hj.port + '），但 token 不对。', 'bad')
    if (r.status === 400) return say('都通了：桌宠在跑，token 也对。', 'ok')
    if (r.status === 409) return say('都通了；顺便说一句，现在有一段还没被取走。', 'ok')
    return say('意外状态：HTTP ' + r.status, 'bad')
  } catch (e) {
    say('连不上：确认 DSH 在跑。\n' + e.message, 'bad')
  }
}

load()
