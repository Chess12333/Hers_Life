# AI cursor and bubble positioning repair

Status: proposed; implementation awaits confirmation. No DSH restart.

## Confirmed code defects
- GlideTick advances elapsed time by timer interval, not actual elapsed time. A fixed 660 ms sleep therefore does not establish arrival.
- LastX/LastY remain the old destination until glide completion. Say snapshots these after the sleep; BubbleForm never follows later movement.
- Bubble centering assumes width 64, and negative desktop coordinates are treated as invalid.
- Glide start failure writes the destination as if movement succeeded.

## Proposed minimal design
Use a monotonic clock for glide progress; retarget from the actual current window position. Publish/read successful physical window bounds rather than interpreting requested coordinates as observed position. Anchor bubbles to that live rectangle, using actual width; continue following while visible. Prefer above, clamp to the anchor monitor, and avoid the real pointer only when necessary. Preserve user-requested idle wobble; precise landing must be verified separately from idle animation. Audit actual sprite hotspots before changing image offsets. No guessed DPI multipliers.

## Alternatives
Increasing the fixed sleep only hides the race. A live anchor removes it and handles subsequent movement. Disabling all idle motion would change intended appearance and is not proposed.

## Validation
First reproduce delayed timer/old-anchor behavior in isolation. Test retargeting during glide, 24/64/192 px sizes, negative coordinates and monitor edges. Verify actual window rectangles and rendered sprite hotspots, not only LastX/LastY. Preserve BOM, parse PowerShell and compile embedded C#. Back up before patching. Live sidecar reload must be explicitly agreed; never restart DSH automatically.

---

# 点一下＝叫它一次，按住＝拖动（2026-11-08 21:1x）

她的原话：「点按桌宠直接进行一次不记次数的活动，长按拖动」。

## 判据（sidecar，OverlayForm）
- 按下不当场算拖动：先记下按下点与时刻。移动过 6px 之前，手抖一律不算。
- 转拖动：按住 ≥ 220ms 之后再移动，或者 220ms 内甩出 12px 以外。
- 松开时若从未拖动、且按住 ≤ 350ms → 算「轻点」，往 stdout 抛一行 `{"event":"tap","x":..,"y":..}`。
- 长按不动（>350ms）既不拖也不点：她按着多半是在准备拖，不该触发说话。

## 通道
sidecar 的 stdout 只有 `ready` 和带 id 的响应；这次多一种无 id 的事件行。写管道和主循环写响应可能撞车，统一走 `DshOverlay.EmitLine` 里那把锁。

## 说话（插件侧）
engine 收到 `event=tap` 转给 index.js；那边 2.5 秒防抖（连点、手抖只算一次），再调 talker 的 `poke()`。
`poke()` 与心跳共用 `compose()`（读卡、生成、定位、气泡、缓动手形），区别只有前面几行事实和**说完不记账**：

- 不调 `judgeNudge`：她不看「该不该主动开口」那套判据——她伸手了。
- 不写 `spokenToday`、不动 `nextAt`、不受每日上限与宵禁约束。
- 自动开口没开时退化成一个字「在」，不替模型编话。

## 验证（都在隔离环境里跑，不碰桌面那只）
- `test/tap-contract.mjs`：自己起一个 sidecar，PostMessage 塞真消息，量「轻点/长按/拖动/甩动」四档 + 拖动真的位移 + 事件带坐标。6/6。
- `test/poke-contract.mjs`：假 llm + 假 engine 跑 `poke()`，验开口、气泡、位置，并静态断言 poke 段内没有 `markSpoken` / `savePetState` / `judgeNudge`。8/8。
- PS 5.1 的 `-File` 在这台机器上传参会被当成位置参数（`parameter '10'`），测试脚本改走环境变量。

## 生效条件
sidecar 改的是鼠标判据，重载 sidecar 即可；`index.js` 与 `lib/*.js` 改的是插件侧，需要重启 DSH。重启由她决定。
