// 隔离验证：直接和 sidecar 对话，不经过插件、不碰正在用的那只光标。
// 只发 calscan（不带 go），它按设计只报口径、不动真实光标。
const { spawn } = require('child_process')

const PS = 'C:\\dsh\\dsh-ming-mousepet\\sidecar.ps1'
const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

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
  if (replies.length >= 3) finish()   // ready + 两条回复
})
let stderr = ''
child.stderr.on('data', (d) => { stderr += d })

function finish() {
  for (const r of replies) {
    try { console.log(JSON.stringify(JSON.parse(r), null, 1)) } catch { console.log('RAW:', r.slice(0, 300)) }
  }
  if (stderr.trim()) console.log('STDERR:', stderr.trim().slice(0, 800))
  try { child.kill() } catch {}
  process.exit(0)
}

setTimeout(() => { console.log('TIMEOUT after 25s'); if (stderr) console.log('STDERR:', stderr.slice(0, 800)); console.log('replies:', replies.length); try { child.kill() } catch {}; process.exit(1) }, 25000)

// ready 行到之后再发请求
const send = setInterval(() => {
  if (replies.length >= 1) {
    clearInterval(send)
    child.stdin.write(JSON.stringify({ id: 1, cmd: 'calscan', x: 400, y: 300 }) + '\n')
    setTimeout(() => {
      child.stdin.write(JSON.stringify({ id: 2, cmd: 'calscan', x: 2560, y: 1350 }) + '\n')
    }, 800)
  }
}, 200)
