// 2026-11-09 21:1x：菜单里那档「简易/完整回答」要真的分岔。
//   quick：框选/指认后气泡一句话（老路）
//   full ：同样的事实交给卡片，走完整回答
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const edit = (rel, fn) => {
  const url = new URL('../' + rel, import.meta.url)
  const raw = readFileSync(url, 'utf8')
  const crlf = raw.includes('\r\n')
  let s = crlf ? raw.split('\r\n').join('\n') : raw
  const out = fn(s)
  copyFileSync(url, new URL('../backup/' + rel.replace(/\//g, '_') + '.20261109-answermode.bak', import.meta.url))
  writeFileSync(url, crlf ? out.split('\n').join('\r\n') : out)
}

// ---- engine.js ----
edit('lib/engine.js', (s) => {
  const a = 'onAsk = null, onCardClosed = null, onPick = null } = {}) {'
  if (!s.includes(a)) throw new Error('engine 构造签名没对上')
  s = s.replace(a, 'onAsk = null, onCardClosed = null, onPick = null, onMenu = null } = {}) {')

  const b = '    this.onPick = typeof onPick === \'function\' ? onPick : null'
  if (!s.includes(b)) throw new Error('engine onPick 赋值没对上')
  s = s.replace(b, b + `
    // 2026-11-09 21:1x：右键菜单里改了「晃动检测」或「回答档」。
    this.onMenu = typeof onMenu === 'function' ? onMenu : null`)

  const c = `      if (message.event === 'card-closed') {`
  if (!s.includes(c)) throw new Error('engine 事件分发锚点没对上')
  s = s.replace(c, `      if (message.event === 'menu') {
        try { this.onMenu?.(message) } catch (error) { this.log(\`menu 处理失败：\${error?.message || error}\`) }
        continue
      }
` + c)
  return s
})

// ---- talker.js ----
edit('lib/talker.js', (s) => {
  const a = `      const r = await compose(rows, null, {})
      say(r.spoken ? \`框选后说了：\${r.line}\` : \`框选后没说 — \${r.why}\`)
      return r`
  if (!s.includes(a)) throw new Error('talker.speakWith 的收尾没对上')
  s = s.replace(a, `      // 2026-11-09 21:1x：右键菜单里选了「完整回答」就走卡片，否则还是气泡一句话。
      const full = typeof options.answerMode === 'function' && options.answerMode() === 'full'
      if (full) {
        const r = await cardCtl.ask('这一块屏幕上是什么？挑紧要的说。', rows)
        say(r.ok ? \`框选后走了卡片：\${String(r.text || '').length} 字\` : \`框选后卡片没答成：\${r.why}\`)
        return { spoken: r.ok, card: true, line: r.ok ? String(r.text || '').slice(0, 40) : '', why: r.ok ? '' : r.why }
      }
      const r = await compose(rows, null, {})
      say(r.spoken ? \`框选后说了：\${r.line}\` : \`框选后没说 — \${r.why}\`)
      return r`)
  return s
})

// ---- index.js ----
edit('index.js', (s) => {
  const a = "  let lastPickNote = ''"
  if (!s.includes(a)) throw new Error('index lastPickNote 没对上')
  s = s.replace(a, a + `
  // 2026-11-09 21:1x：框选/指认之后用哪一档回答。默认简易（气泡），右键菜单可改。
  let answerMode = 'quick'`)

  const b = `    onCardClosed: () => {`
  if (!s.includes(b)) throw new Error('index onCardClosed 没对上')
  s = s.replace(b, `    onMenu: (evt) => {
      // 右键菜单里点了东西：回答档要记进 pet-state，晃动检测只要记一行日志。
      const action = String(evt?.action || '')
      if (action === 'answer') {
        answerMode = evt?.mode === 'full' ? 'full' : 'quick'
        log(\`回答档改成：\${answerMode === 'full' ? '完整（卡片）' : '简易（气泡）'}\`)
        Promise.resolve(loadPetState())
          .then((state) => updatePetState({ answerMode }))
          .catch((error) => log(\`回答档没存上：\${error?.message || error}\`))
      } else if (action === 'shake') {
        log(\`晃动检测：\${evt?.on ? '开' : '关'}\`)
      }
    },
` + b)

  const c = `    cardPath: resolveCardPath(companionCfg.workspace),`
  if (!s.includes(c)) throw new Error('talkerOptions.cardPath 没对上')
  s = s.replace(c, c + `
    // 框选/指认后的回答档：菜单改的就是它。
    answerMode: () => answerMode,`)
  return s
})

console.log('JS 三处改完：menu 事件 → answerMode → 气泡/卡片分岔')
