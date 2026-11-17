/**
 * say.mjs —— 合成一句，然后播出来。
 *
 * 直播那条线的第一段：文字 → mp3 → 扬声器。
 * 播出来的声音由 OBS 的「应用程序音频采集」抓 ffplay 这个进程，
 * 所以不需要装虚拟声卡（这台机器上也没有装 VB-Cable 之类）。
 *
 * 用法：
 *   node say.mjs "要说的话"
 *   node say.mjs "要说的话" zh-CN-YunxiNeural
 */
import { spawn, execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// 2026-11-17（F-2）：不再写死作者机器上的 winget 路径与 <workspace> 占位。
// MING_FFPLAY 指到 ffplay.exe；没设就用 PATH 里的 ffplay。
const FFPLAY = (process.env.MING_FFPLAY || '').trim() || 'ffplay'
const ROOT = path.join(
  (process.env.MING_WORKSPACE || '').trim() || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'ming-workspace'),
  'live', 'voice',
)

const text = (process.argv[2] || '').trim()
const voice = (process.argv[3] || 'zh-CN-XiaoxiaoNeural').trim()
if (!text) {
  console.error('用法: node say.mjs "要说的话" [音色]')
  process.exit(2)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
const out = path.join(ROOT, stamp + '-' + Math.random().toString(36).slice(2, 6) + '.mp3')
await mkdir(ROOT, { recursive: true })

const synth = () => new Promise((resolve, reject) => {
  execFile('python', ['-m', 'edge_tts', '--voice', voice, '--rate', '+0%', '--text', text, '--write-media', out],
    { timeout: 60000 }, (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve())
})

try {
  await synth()
} catch (e) {
  console.error('合成失败: ' + e.message)
  process.exit(1)
}

// -nodisp：不开窗口；-autoexit：播完退出；-loglevel error：别刷日志
const player = spawn(FFPLAY, ['-nodisp', '-autoexit', '-loglevel', 'error', out], { stdio: 'ignore' })
player.on('exit', (c) => process.exit(c === 0 ? 0 : 1))
