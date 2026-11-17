// test-support/qa-fixture-fail.mjs —— 故意失败的测试，只给 runner 自测用（L-T2）。
// 它永远不会被 offline 套件跑到；只有 `--suite=fixture` 才会执行。
console.error('这是故意失败：用来验证 runner 在失败时返回非零，并且指出是哪一项。')
process.exit(1)
