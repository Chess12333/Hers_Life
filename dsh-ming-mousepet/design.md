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

---

# 对着 Pointy 补短板：指认 · 网页取文 · 快答/深入 · 卡片（2026-11-09 16:0x）

对照 `<DSH>\refs\pointy`（MIT，素材 CC BY-NC-SA 不复用）。**只抄判据，不抄壳**：不搬 Electron 运行时、托盘、单实例、卸载清理——我们的 sidecar 本来就是常驻进程。

## 1. 指认：从「拖一个框」变成「指一下」

- 入口两条，都保留：晃鼠标（已有）；`pick` 模式（新）。
- `pick` 判据：光标下 UIA 元素 → 向上走到「有意义的块」——有名字或有子元素文字、面积在 24×12 到屏幕 90% 之间、不是整窗壳。Chromium 壳/自绘窗口走聚焦框：固定 720×320 起，滚轮 ×1.15 收放。
- 键：`[` 收一级 / `]` 放一级 / 滚轮缩放 / 左键确认 / Esc 或右键取消。
- 输出：`{"event":"pick","rect":"x,y,w,h","chain":[...],"text":"..."}`。
- 高亮框归源窗口所有（`setOwner`），不抢前台、不吃点击，确认那一瞬才吃一次左键。

## 2. 网页取文：指一段，不用先选中

- 扩展加「指一段」模式（快捷键 + 右键菜单两条入口）。鼠标下的语义块高亮（h1-h6/p/li/pre/blockquote/table/figure），点一下发回本机。
- 附带：站点、作者、发布时间、BV 号、播放进度（B 站）。正文上限 4000 字，Shadow DOM 也走一遍。
- 现有的「选中 + Ctrl+Alt+S」留着，当兜底。

## 3. 快答 / 深入两档

- 默认 `quick`：不许下载、跑命令、读图；最多 1–2 次搜索；三句以内。
- `full`：第一句必须是结论，允许查证。
- 两档在气泡和卡片里共用，判据写在 prompt 里，不另做分支。

## 4. 卡片：能追问，但用的是我们自己的嘴

- Pointy 的卡片绑在 DSH 会话上，因为它没有别的脑子。我们有 `llm.stream`。
- 所以卡片 = 流式字幕 + 输入框 + 收起成 pill；追问直接续同一段对话，不走会话桥。
- 需要「真去干活」（读文件、跑命令）时，卡片上给一个「丢进 DSH」：`agents.create` + `followup`，把抓取内容包成 `<抓取内容>` 块。这是可选按钮，不是默认路径。
- 没有 `llm.stream` 时退化成现在的一条气泡，不报错。

## 5. 安全对齐

- 已有：密码框、敏感标题、全屏抑制（shake）。
- 要补：提权（管理员）程序检测，命中就拒绝并说一句；`pick` 模式同样受全屏与提权抑制。

## 生效条件
- sidecar 改判据 → 重载 sidecar 即可；`index.js` / `lib/*` → 需重启 DSH，重启由她按。

## 落地情况（2026-11-09 16:2x 对账）

| 项 | 在哪 | 证据 |
|---|---|---|
| 指一下 | sidecar `DshPick` + `pick`/`pickrect` 命令；`index.js` 的 `onPick` 走 `handleRect` | `test/pick-contract.mjs` 10/10 |
| 能追问的卡片 | sidecar `DshCard` + `lib/answer.js` + `talker.cardAsk` | `test/card-contract.mjs` 11/11、`test/card-ask-contract.mjs` 9/9 |
| 快答 / 深入 | `lib/answer.js` 的 MODE_QUICK / MODE_FULL；气泡走 quick、卡片走 full | 仅提示词分档，卡片没有工具执行循环；真实模型回答体验未验 |
| 会话桥 | `lib/sessions.js`（list / create / prompt / follow）+ `index.js` 的 `sessions`、`ask` 动作 | 假 controller：bridge 20/20、lifecycle 17/17、correlation 7/7；只追加 rpcId 关联的完整持久消息，不显示原始 token 流。停止跟随不等于停止宿主任务；宿主端到端未验 |
| 网页指一段 | 扩展 0.3.0 `content.js` / `background.js` | `test/webpick-click-contract.mjs` 通过：点击时重算目标，避免提交上一块；真实浏览器交接未验 |
| 提权不读 | sidecar `DshSec.ForegroundElevated()` + `guard.elevated` | `guard` 实测返回 `elevated:false`（非提权窗口） |
| 收起 | 卡片 `–` 按钮 / `card op=collapse` | card-contract 里高度 360→32→360 |

**没做的三件**：点一下确认（要低级鼠标钩子）、滚轮缩放（`[ ]` 顶替）、卡片上的「丢进 DSH」按钮（改由 `pet {action:"ask"}` 触发，界面上不再多一个按钮）。

生效：sidecar 侧重载即可；`index.js` / `lib/*` 要重启 DSH，重启由她按。

## 2026-11-09 17:0x 宿主验收时抓住的两处

1. **动作挂错了工具**：`sessions` / `ask` / `pick` / `card` 四个分支写进了 `pet_input` 的 execute，schema 和文档却写在 `pet` 上。宿主上表现是 `pet {action:"sessions"}` 回「未知 action」，而 `pet_input {action:"sessions"}` 却能列会话。已把这 52 行挪回 `pet`；`pet_input` 只剩鼠标键盘那些。
2. **卡片答不出话，被写成「模型给的空话」**：`lib/answer.js` 传给 `llm.stream` 的是 `provider: undefined / model: undefined`，而宿主 `GenerateOptions` 里这两项必填，选不到适配器就以一个带 `error` 的 **finish 块**收尾——旧代码从不读 finish 块，于是「调用失败」显示成「空话」。
   - 现在 `answer.js` 收 `provider` / `model`，缺了就当场说缺，不再去撞适配器；finish 的 `error` / `aborted` / `max-tokens` 各说各的原因。
   - 路由从 `talkerOptions` 一路传下来（`index.js` → `createCard.callModel` → `answer.js`；`lib/talker.js` 同理），页面上换模型，卡片下一次开口就跟着换。
   - 回归：`test/answer-call-config-contract.mjs` 5/5（先红后绿），并顺手把 `card-cancel-contract` / `card-ask-contract` 两份夹具补上模型路由——之前它们靠「不传也能跑」才勉强通过。
3. 这两处都还没在重启后的宿主上复验；验收清单在 `test/pointy-host-acceptance.md`。

## 2026-11-09 17:25 卡片跟桌宠

她问「卡片能不能跟随桌宠，就和气泡一样」。做到的是：

- 卡片开在桌宠（AI 光标）的右上方，翻边规则和气泡共用同一套锚点（`DshOverlay.TryGetBounds`）：
  右边放不下翻到左边，上面放不下落到底下，四个边都夹在工作区里。
- 卡片自己有一个 250ms 的计时器，桌宠一动它就跟着挪（`FollowTick`）。
- **她手动拖标题栏就不再跟**：`follow=false`，位置以她放的为准。
- 命令行拨开关：`card op=follow on=true|false`（JS 侧 `pet {action:"card", op:"follow", on}`，要重启 DSH 才会挂上）。

两档回复本来就是分开的，这次没动：气泡走 `MODE_QUICK`（两三句、不交代过程），卡片走 `MODE_FULL`（先结论再理由）。差异在提示词，不在代码分支。
