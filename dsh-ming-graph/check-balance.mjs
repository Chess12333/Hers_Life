import { readFileSync } from 'node:fs'
const src = readFileSync('C:/dsh/dsh-ming-graph/src/panel.js', 'utf8')
const start = src.indexOf('function PetPage()')
const end = src.indexOf('function NeuronPanel()')
const seg = src.slice(start, end)
const lines = seg.split('\n')
let depth = 0
let inS = null
let inC = false
let esc = false
for (let ln = 0; ln < lines.length; ln++) {
  const line = lines[ln]
  let col = 0
  while (col < line.length) {
    const ch = line[col]
    if (esc) { esc = false; col++; continue }
    if (inS) {
      if (ch === '\\') { esc = true; col++; continue }
      if (ch === inS) inS = null
      col++; continue
    }
    if (inC) { col++; continue }
    if (ch === '/' && line[col + 1] === '/') { inC = true; col += 2; continue }
    if (ch === "'" || ch === '"' || ch === '`') { inS = ch; col++; continue }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth < 0) { console.log('NEG at segment line', ln + 1, ':', line.trim()); }
    }
    col++
  }
  inC = false
  // 每行末尾打印深度（只在 PetPage 范围内，且只打异常值）
  if (ln + 1 <= lines.length) {
    if (depth !== 0 && (line.startsWith('function ') || line.startsWith('}') || line.startsWith('  )') || line.startsWith('    ),'))) {
      console.log(String(ln + 1).padStart(4), 'depth=' + depth, '|', line.slice(0, 60))
    }
  }
}
console.log('end depth:', depth, 'segment lines:', lines.length)
