import {readFile,writeFile} from 'node:fs/promises'
const p='lib/talker.js'
let s=await readFile(p,'utf8')
s=s.replace('markSpoken, savePetState, schedGapMs','markSpoken, updatePetState, schedGapMs')
s=s.replace("  // tickMs 留着当兼容：给了就按固定间隔跑，不给就走心跳。\n  const fixedTick = Number(options.tickMs) > 0 ? Math.max(15000, Number(options.tickMs)) : 0",'  // Panel schedule is authoritative; legacy tickMs must not override it.')
s=s.replace('  let stopped = false','  let stopped = false\n  let generation = 0')
s=s.replace('    const said = await engine.request(\'say\', sayArgs, 15000)',"    if (stopped || (opts.valid && !opts.valid())) return { spoken: false, why: '调度已更新' }\n    const said = await engine.request('say', sayArgs, 15000)")
s=s.replace('  async function once() {','  async function once(epoch = generation) {\n    const valid = () => !stopped && epoch === generation')
s=s.replace('    const verdict = judgeNudge({ now, status, state })',"    if (!valid() || (state.gapMode || state.schedMode) === 'off') return { spoken: false, why: '自动开口已关闭或更新', quiet: true }\n    const verdict = judgeNudge({ now, status, state })")
s=s.replace('    const r = await compose(rows, status)','    if (!valid()) return { spoken: false, why: \'调度已更新\' }\n    const r = await compose(rows, status, { valid })')
s=s.replace('await savePetState(markSpoken(await loadPetState(), now))','await updatePetState(st => markSpoken(st, new Date()))')
s=s.replace("    if (running) return { spoken: false, why: '上一轮还没说完' }", "    if (stopped || running) return { spoken: false, why: '上一轮还没说完或已停止' }")
s=s.replace('    const t0 = Date.now()','    running = true\n    try {\n    const t0 = Date.now()')
s=s.replace('    return r\n  }\n\n  async function tick', '    return r\n    } finally { running = false }\n  }\n\n  async function tick')
// Replace scheduling block, including startup immediate speech.
const a=s.indexOf('  let timer = null')
const b=s.indexOf('  const manual =',a)
s=s.slice(0,a)+`  let timer = null
  const clearTimers = () => {
    if (timer) clearTimeout(timer)
    if (midTimer) clearTimeout(midTimer)
    timer = midTimer = null
  }
  const scheduleNext = async () => {
    const epoch = ++generation
    clearTimers()
    const valid = () => !stopped && epoch === generation
    try {
      const state = await loadPetState()
      if (!valid()) return 0
      const gap = schedGapMs(state)
      const deadline = gap > 0 ? Date.now() + gap : 0
      await updatePetState(st => valid() ? { ...st, nextAt: deadline } : st)
      if (!valid() || !gap) return 0
      timer = setTimeout(() => {
        if (!valid()) return
        // Re-arm immediately: model latency must not stretch fixed cadence.
        const work = tick()
        scheduleNext().catch(error => say('调度失败：' + error.message))
        work.catch(error => say('自动开口失败：' + error.message))
      }, Math.max(0, deadline - Date.now()))
      timer.unref?.()
      return gap
    } catch (error) {
      if (valid()) say('调度失败：' + error.message)
      throw error
    }
  }
  scheduleNext().catch(() => {})
  say('桌面陪伴开了 · 按面板设置计时 · 卡：' + cardPath)
  if (!llm || typeof llm.stream !== 'function') say('没拿到宿主的模型服务，自动开口不会生效')

`+s.slice(b)
// tick must keep its epoch while rearming increments generation. Schedule next after work instead until deadline scheduler is separated.
s=s.replace("        const work = tick()\n        scheduleNext().catch(error => say('调度失败：' + error.message))\n        work.catch(error => say('自动开口失败：' + error.message))", "        tick().finally(() => {\n          if (valid()) scheduleNext().catch(() => {})\n        }).catch(error => say('自动开口失败：' + error.message))")
s=s.replace('    stopped = true\n    if (timer)', '    stopped = true\n    generation += 1\n    if (timer)')
s=s.replace('  stop.manual = manual','  stop.reschedule = scheduleNext\n  stop.manual = manual')
await writeFile(p,s)
const q='index.js'
s=await readFile(q,'utf8')
s=s.replace(/import \{([^\n]*loadPetState[^\n]*)\} from '\.\/lib\/pet.js'/,(_,v)=>`import {${v}, updatePetState, normalizeSchedulePatch } from './lib/pet.js'`)
const x=s.indexOf('          const st = await loadPetState()',s.indexOf("if (route === '/schedule')"))
// endpoint block found by unique mode line instead
const mode=s.indexOf("          const mode = String(body?.gapMode || '')")
if(mode<0) throw Error('schedule block missing')
const start=s.lastIndexOf('          const st = await loadPetState()',mode)
const end=s.indexOf('          return json(res, 200, view(next))',mode)
s=s.slice(0,start)+`          const patch = normalizeSchedulePatch(body)
          const next = await updatePetState(st => ({ ...st, ...patch, nextAt: 0 }))
          await stopTalker?.reschedule?.()
`+s.slice(end)
s=s.replace('view(next))','view(await loadPetState()))')
s=s.replace("            gapMode: String(st.gapMode || st.schedMode || 'heartbeat'),", "            gapMode: String(st.gapMode || st.schedMode || 'heartbeat'),\n            schedMode: String(st.gapMode || st.schedMode || 'heartbeat'),\n            everyMin: n(st.minGapMinutes ?? st.everyMin, 50),\n            dailyCap: n(st.dailyMax ?? st.dailyCap, 6) < 0 ? 0 : n(st.dailyMax ?? st.dailyCap, 6),")
await writeFile(q,s)
