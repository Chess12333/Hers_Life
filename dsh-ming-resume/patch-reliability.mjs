import {readFile,writeFile} from 'node:fs/promises'
const p=new URL('./index.js',import.meta.url);let s=await readFile(p,'utf8')
const start=s.indexOf('function mediaPlaying(cfg)');const end=s.indexOf('\nexport function apply',start)
s=s.slice(0,start)+`async function mediaPlaying(cfg) {
  try {
    const out = await adbShell(cfg, ['dumpsys audio'])
    return out.split('\\n').some(line => line.includes('state:started') && line.includes('USAGE_MEDIA'))
  } catch { return null }
}
async function pressKey(cfg, code) {
  try { await adbShell(cfg, ['input', 'keyevent', String(code)]); return true }
  catch { return false }
}
async function pauseMedia(cfg) {
  const playing = await mediaPlaying(cfg)
  if (playing === null) return 'unknown'
  if (!playing) return 'idle'
  if (!await pressKey(cfg, 85)) return 'unknown'
  await sleep(700)
  const after = await mediaPlaying(cfg)
  if (after === null) return 'unknown'
  if (!after) return 'paused'
  if (!await pressKey(cfg, 127)) return 'unknown'
  await sleep(800)
  const final = await mediaPlaying(cfg)
  return final === null ? 'unknown' : final ? 'failed' : 'paused'
}
async function resumeMedia(cfg) {
  const playing = await mediaPlaying(cfg)
  if (playing === null) return 'unknown'
  if (playing) return 'already'
  if (!await pressKey(cfg, 85)) return 'unknown'
  await sleep(700)
  const after = await mediaPlaying(cfg)
  if (after === null) return 'unknown'
  if (after) return 'resumed'
  if (!await pressKey(cfg, 126)) return 'unknown'
  await sleep(800)
  const final = await mediaPlaying(cfg)
  return final === null ? 'unknown' : final ? 'resumed' : 'failed'
}
`+s.slice(end)
const a=s.indexOf('  let pausedByUs = false');const b=s.indexOf("  ctx.on('agent/pre-step'",a)
s=s.slice(0,a)+`  let mediaOwner = null
  let mediaQueue = Promise.resolve()
  const serialMedia = fn => {
    const pending = mediaQueue.then(fn)
    mediaQueue = pending.catch(() => {})
    return pending
  }
  const resumeIfPausedByUs = payload => serialMedia(async () => {
    if (!mediaOwner || mediaOwner.agent !== payload?.agent || mediaOwner.turn !== payload?.turn) return
    mediaOwner = null
    await resumeMedia(cfg)
  })
  ctx.on('agent/turn-stopping', async payload => {
    await resumeIfPausedByUs(payload)
  })

`+s.slice(b)
s=s.replace('await resumeIfPausedByUs()','await resumeIfPausedByUs(payload)')
s=s.replace('if (cfg.pauseMediaOnInterrupt && !pausedByUs) {\n        const result = await pauseMedia(cfg)',`if (cfg.pauseMediaOnInterrupt && payload?.agent && payload?.turn) {
        const result = await serialMedia(async () => {
          if (mediaOwner) return 'owned'
          if (payload.signal?.aborted) return 'unknown'
          const result = await pauseMedia(cfg)
          if (result === 'paused') mediaOwner = { agent: payload.agent, turn: payload.turn }
          return result
        })`)
s=s.replace('          pausedByUs = true\n','')
s=s.replace("        } else {\n          mediaNote = '我试着按了暂停", "        } else if (result === 'unknown') {\n          mediaNote = '设备播放状态未知，未确认暂停；先检查设备，不要盲按播放切换键。'\n        } else if (result !== 'owned') {\n          mediaNote = '我试着按了暂停")
await writeFile(p,s)
