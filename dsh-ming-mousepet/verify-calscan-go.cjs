// 定案测量：MoveRaw(物理点) → GetCursorPos 读回，看是不是同一个点。
// 只动 70ms 左右，Calibrate 内部 SaveCursor/RestoreCursor 会还原。
const { spawn } = require('child_process')

const PS = 'C:\\dsh\\dsh-ming-mousepet\\sidecar.ps1'
const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

const points = [[400, 300], [2000, 1500], [3300, 1800]]
let buf = ''
const replies = []
child.stdout.setEncoding('utf8')
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (line) replies.push(line)
  }
})
let stderr = ''
child.stderr.on('data', (d) => { stderr += d })

let want = 1 + points.length
const timer = setInterval(() => {
  if (replies.length >= wants()) {
    clearInterval(timer)
    for (const r of replies) {
      try {
        const j = JSON.parse(r)
        if (j.event === 'ready') { console.log('ready pid=' + j.pid); continue }
        const res = j.result || {}
        if (res.readBack) {
          console.log('ask(' + res.asked.x + ',' + res.asked.y + ') -> readBack(' + res.readBack.x + ',' + res.readBack.y + ')  error(' + res.error.x + ',' + res.error.y + ')')
        } else {
          console.log(JSON.stringify(res).slice(0, 300))
        }
      } catch { console.log('RAW:', r.slice(0, 200)) }
    }
    if (stderr.trim()) console.log('STDERR:', stderr.trim().slice(0, 500))
    try { child.kill() } catch {}
    process.exit(0)
  }
}, 200)

function wants() { return want }

let sent = false
const sender = setInterval(() => {
  if (replies.length >= 1 && !sent) {
    sent = true
    clearInterval(sender)
    points.forEach(([x, y], k) => {
      setTimeout(() => {
        child.stdin.write(JSON.stringify({ id: k + 1, cmd: 'calscan', x, y, go: true }) + '\n')
      }, k * 1200)
    })
  }
}, 200)

setTimeout(() => {
  console.log('TIMEOUT; replies=' + replies.length)
  if (stderr) console.log('STDERR:', stderr.slice(0, 600))
  try { child.kill() } catch {}
  process.exit(1)
}, 30000)
