// 2026-11-09 21:2x：开机把存档里的回答档推给 sidecar，菜单里的勾才跟存档一致。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const url = new URL('../index.js', import.meta.url)
const raw = readFileSync(url, 'utf8')
const crlf = raw.includes('\r\n')
let s = crlf ? raw.split('\r\n').join('\n') : raw

const anchor = '  const toolConfig = toolSpec()'
if (!s.includes(anchor)) throw new Error('没找到 toolConfig 锚点')
s = s.replace(anchor, `  // 2026-11-09 21:2x：开机把存档里的回答档推给 sidecar——菜单里的勾要跟存档一致。
  Promise.resolve(loadPetState())
    .then((st) => {
      if (st && (st.answerMode === 'full' || st.answerMode === 'quick')) {
        answerMode = st.answerMode
        return engine.request('menustate', { answer: answerMode }, 5000)
      }
      return null
    })
    .catch((error) => log(\`回答档没推上去：\${error?.message || error}\`))

` + anchor)

copyFileSync(url, new URL('../backup/index.js.20261109-menustate.bak', import.meta.url))
writeFileSync(url, crlf ? s.split('\n').join('\r\n') : s)
console.log('开机推 menustate')
