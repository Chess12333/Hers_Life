import assert from 'node:assert/strict'
import { MODE_QUICK, MODE_FULL, modeLine } from '../lib/answer.js'
for (const prompt of [MODE_QUICK, MODE_FULL]) {
  assert.ok(prompt.includes('没有联网或执行工具'))
  assert.doesNotMatch(prompt, /最多查一|允许查资料/)
}
assert.equal(modeLine('quick'), MODE_QUICK)
assert.equal(modeLine('full'), MODE_FULL)
console.log('answer capability contract: passed')
