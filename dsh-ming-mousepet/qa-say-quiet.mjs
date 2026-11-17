#!/usr/bin/env node
/**
 * qa-say-quiet.mjs —— 「AI 指针的气泡在宵禁里闭不闭嘴」的回归。
 *
 * 2026-11-09 00:2x 她问「AI 指针有聊天宵禁吗」——查完发现：自动陪伴那条路有静音，
 * 我手动调的 say 没有。补完之后，判据在 lib/pet.js 的 shouldMuteSay，这里按样例钉住。
 *
 * 00:25 她否掉了第一版：「那不就是说我必须两分钟动一次？」
 * 那版拿键鼠空闲当「她醒着」的证据，等于把成本推给她。现在没有例外，宵禁就是闭嘴。
 *
 * 跑：node qa-say-quiet.mjs     有失败会 exit 1
 */
import { inQuietHours, shouldMuteSay } from './lib/pet.js'

let bad = 0
const at = (h, m) => new Date(2026, 10, 9, h, m, 0, 0)   // 2026-11-09 本地时间

function expect(name, got, want) {
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  → ${got}${ok ? '' : `（应为 ${want}）`}`)
}

// ---- 静音窗边界：00:30 起，10:30 止（含 00:30，不含 10:30）----
expect('00:29 不在静音里', inQuietHours(at(0, 29)), false)
expect('00:30 进静音', inQuietHours(at(0, 30)), true)
expect('10:29 还在静音里', inQuietHours(at(10, 29)), true)
expect('10:30 出静音', inQuietHours(at(10, 30)), false)
expect('中午不在静音里', inQuietHours(at(12, 0)), false)

// ---- 宵禁里：一律不说（没有「她在动就放行」这种口子）----
expect('00:30 闭嘴', shouldMuteSay({ now: at(0, 30), state: {} }).mute, true)
expect('03:00 闭嘴', shouldMuteSay({ now: at(3, 0), state: {} }).mute, true)
expect('10:29 闭嘴', shouldMuteSay({ now: at(10, 29), state: {} }).mute, true)

// ---- 出宵禁：放行 ----
expect('10:30 放行', shouldMuteSay({ now: at(10, 30), state: {} }).mute, false)
expect('12:00 放行', shouldMuteSay({ now: at(12, 0), state: {} }).mute, false)
expect('23:59 放行', shouldMuteSay({ now: at(23, 59), state: {} }).mute, false)

// ---- 开关关着：静音窗也放行（测试/特殊场合用）----
expect('03:00、quietHours:false → 放行',
  shouldMuteSay({ now: at(3, 0), state: { quietHours: false } }).mute, false)

console.log(bad ? `\n✗ ${bad} 条没过` : '\n全部通过')
process.exit(bad ? 1 : 0)
