# Pointy 适配验证

2026-11-09 16:26，本地执行。

- plugin-test.mjs：退出 0，apply 完成，工具注册，status/windows/capture 返回。测试 ctx 没有 inject/webServer，因此不证明宿主会话桥或模型注入成功。
- card-contract.mjs：11/11，通过真实 sidecar 验证开关、追加、收起与展开。
- card-ask-contract.mjs：9/9，假模型与假 engine，验证流式追加和追问历史。
- pick-contract.mjs：10/10，真实 sidecar，几何与启动/停止；不等于人工指认体验验收。
- session-bridge-contract.mjs：19/19，假 sessionController；不等于真实宿主会话端到端验收。
- index.js、lib/card.js、lib/talker.js：node --check 通过。

尚未完成：宿主重启加载后，实测 sessions、pick、卡片真实模型追问及浏览器扩展交接。未自行重启。

已知未实现的交互：桌面指认点击确认、滚轮缩放、卡片上的“丢进 DSH”按钮。现有桌面指认使用 Enter 和方括号；会话桥由工具动作调用。

## 2026-11-09 16:38 补验

- card-cancel-contract.mjs：7/7。reset/close、晚到的输出/异常、新旧回答交叠、超时后的遗留 collector 均不再改写新卡片；原 card-ask 9/9 复验通过。
- webpick-click-contract.mjs：通过。先复现“鼠标已经移到第二段，点击仍提交上一段”，再修为点击时重新定位目标。假 DOM 测试，不代表真实浏览器验收；更新扩展后需重新加载扩展及目标网页。
- card-contract 11/11、pick-contract 10/10 再次通过，均使用真实 sidecar；测试已 shutdown。
- 当时会话桥仍在修复请求关联与卡片输出归属，最新结果见下。

## 2026-11-09 16:49 补验

- 父会话复跑：session-bridge 20/20、session-lifecycle 17/17、session-correlation 7/7、card-session 9/9、card-cancel 7/7、card-ask 9/9；webpick-click 与 answer-capability 通过。
- 会话桥按 requestId / source.rpcId 关联持久消息；原始 token 块不进入卡片，混入其他请求、缺少关联或结束事件时失败关闭。关闭卡片仅停止跟随，不代表宿主任务停止。
- card-session 横幅已有实际换行断言，9/9 通过；读文件工具显示的双反斜杠不是缺陷证据，未为此改代码。
- 真实 sidecar 再验：card-contract 11/11、pick-contract 10/10；plugin-test 退出 0。假 ctx 无 inject/webServer 的日志符合测试环境，不证明真实宿主服务已接通。
- index.js 语法检查通过。未重启宿主；真实模型追问、真实会话端到端与浏览器扩展交接仍待验。扩展 0.3.0 需重新加载并刷新目标网页。

## 2026-11-09 17:1x 重启前补验（分派层）

`test/pet-action-routing-contract.mjs` 5/5 过。它用假 ctx 走 `apply()`，直接拿注册出来的两只工具：
- `pet {action:"sessions"}` → 落到 sessions 分支（没接会话服务时回「列不出来」，**不再**是「未知 action」）；
- `pet {action:"ask"}` → 没给内容时回「要说点什么」；
- `pet_input` 对 sessions / ask / pick / card 四个一律回「未知 action」；
- `pet_input {action:"windows"}` 仍正常。

这条验的是**分派**，不是宿主行为：它证明「动作挂在 pet 上」，不证明重启后卡片能答、会话桥能跑。

`test/answer-call-config-contract.mjs` 5/5（先红后绿）：
- finish 块带 error / aborted 时把原因说出来，不再显示「模型给的空话」；
- provider/model 真的进 `llm.stream`；
- 缺路由时不发请求，当场报缺哪一项；
- 正常流式仍然逐块回调 `onDelta`。

顺带修了两份夹具：`card-cancel-contract`、`card-ask-contract` 原来没给模型路由，靠「不传也能跑」才过；补上路由后 7/7、9/9。

仍需重启后复验：真实模型追问、会话桥端到端、扩展 0.3.0 交接、真实 pick。清单见 `pointy-host-acceptance.md`。

## 2026-11-09 17:1x 补验：ask 从工具入口走到假会话

`test/ask-branch-contract.mjs` 3/3 过。假 ctx 提供 `inject` 和一个假 sessionController，走的是真代码：
- `pet{action:"ask", text, cwd}` → `sessionCard.ask` → `createSession` → `prompt` → `follow` → 关联 → 回执；
- 回执里带正文（6 字）、工具动了几次（1）、sessionId；prompt 的 `mode` 是 `queue`，`requestId` 前缀仍是 `ming-card-`；
- follow 的地址是 `{kind:'session', sessionId}` 且 `assistantStream:true`。

这证明**参数与关联口径**在插件内部是通的；宿主的 sessionController 到底怎么回放，仍要重启后看。

## 2026-11-09 17:14 宿主实测（重启后第一轮）

- `pet {action:"sessions"}` 通了：真的列出 12 个会话。接线这件事在宿主上成立。
- `pet {action:"card", text:"记住测试词：蓝石…"}`：**答了 2 字**（收到）。模型路由通了，不再是「空话」。
- 追问同一张卡片：**失败** —— `模型这条路失败了：Cannot read properties of undefined (reading 'replayState')`。
  查宿主 `AssistantMessage` 契约：assistant 消息必须带 `source`（`ModelMessageSource`，含 provider/model）。
  我们只传了 `{role,content}`，第一问没历史所以不炸，第二问带历史就炸。
  已修：`lib/answer.js` 给历史里的 assistant 补 `source:{kind:'model',provider,model}`；先红后绿，`answer-call-config-contract` 6/6。
- `pet {action:"ask", …}`：**没成** —— `本轮合并了其他请求，无法安全关联回复`。
  但会话真的建了、也回了（`session-e09fffb9`，标题「桥接验收成功」，输出 5 token；projcache `titleInput.count = 1`），
  说明是我们这一侧的关联判据太粗：旧逻辑**数这一轮 user/message 的条数**，同一句投两遍（append+replace）就被当成「合并了别人的请求」。
  已改成「看这一轮里有没有不是我这个 rpcId 的用户消息」，并且：
  - 混进别人请求时清空已攒的正文再报错；
  - 正文改成**验完之后整段交付**（设计本来就写「只追加已确认的完整回答，不逐 token」），
    失败/中止的那一轮一个字都不交给调用方。
  回归：correlation 8/8（新增「同一条请求重复出现不算合并」）、bridge 20/20、lifecycle 17/17。
  两份旧断言跟着改了：`onDelta` 从「每段各调一次」改成「整段一次」；被中止的一轮 `seen` 必须为空。

**还没验**：重启后的真实追问、ask 端到端、网页取文交接、真实 pick。这两处修复都要重启才生效。
