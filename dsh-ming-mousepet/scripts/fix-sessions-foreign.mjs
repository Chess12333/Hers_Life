// 2026-11-09 17:1x：把「数条数」换成「看 rpcId」。
// 起因：宿主上 ask 回了「本轮合并了其他请求」，但会话里只有我们那一条
//（projcache 的 titleInput.count = 1）。重复投递自己的消息被旧逻辑当成了合并。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'

const file = new URL('../lib/sessions.js', import.meta.url)
const src = readFileSync(file, 'utf8')

const oldBlock = `    let currentTurn = null
    let userCount = 0
    const accept = ev => {
      if (!ev || ac.signal.aborted) return
      if (ev.type === 'turn/start') {
        currentTurn = Number.isSafeInteger(ev.data?.turn) ? ev.data.turn : null
        userCount = 0
      } else if (ev.type === 'user/message') {
        userCount++
        const ours = ev.data?.source?.kind === 'user' && ev.data.source.rpcId === requestId
        if (ours) {
          if (currentTurn === null || matchedTurn !== null) throw new Error('无法唯一关联本次会话请求')
          matchedTurn = currentTurn
        }
        if (matchedTurn === currentTurn && userCount > 1) throw new Error('本轮合并了其他请求，无法安全关联回复')
      } else if`

const newBlock = `    let currentTurn = null
    // 2026-11-09 17:1x：不再数条数。宿主的 user/message 可能同一句投两遍（append + replace），
    // 数条数会把「自己的请求重复出现」误判成「合并了别人的请求」——宿主上就是这么炸的。
    // 判据改成「这一轮里有没有出现不是我这个 rpcId 的用户消息」。
    const foreignTurns = new Set()
    const accept = ev => {
      if (!ev || ac.signal.aborted) return
      if (ev.type === 'turn/start') {
        currentTurn = Number.isSafeInteger(ev.data?.turn) ? ev.data.turn : null
      } else if (ev.type === 'user/message') {
        const src0 = ev.data?.source
        const ours = src0?.kind === 'user' && src0.rpcId === requestId
        if (ours) {
          if (currentTurn === null) throw new Error('无法唯一关联本次会话请求')
          if (matchedTurn === null) matchedTurn = currentTurn
          else if (matchedTurn !== currentTurn) throw new Error('无法唯一关联本次会话请求')
        } else if (currentTurn !== null) {
          // 同一轮里别人也投了一句：先记下这一轮，回放完了再判
          foreignTurns.add(currentTurn)
        }
      } else if`

if (!src.includes(oldBlock)) throw new Error('没找到要替换的那段')
let out = src.replace(oldBlock, newBlock)

const oldCheck = `    if (matchedTurn === null) throw new Error('无法关联本次会话请求')`
const newCheck = `    if (matchedTurn === null) throw new Error('无法关联本次会话请求')
    if (foreignTurns.has(matchedTurn)) throw new Error('本轮合并了其他请求，无法安全关联回复')`
if (!out.includes(oldCheck)) throw new Error('没找到关联检查那行')
out = out.replace(oldCheck, newCheck)

copyFileSync(file, new URL('../backup/sessions.js.20261109-rpcid-foreign.bak', import.meta.url))
writeFileSync(file, out)
console.log('改完了：数条数 → 看 rpcId')
