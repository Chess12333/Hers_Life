# v1.2.0 — 按 E–L 交接书收口

这一版把 E–L 交接书里能离线做完的部分做完了，离线检查 **25 项全过**（`node scripts/check.mjs --suite offline`）。
没验的写在这里，不混进「已完成」。

## 新能力

- **E-2 转发链路**（真跑通）：**只在一种场景生效**——AstrBot 判定「不接」、但这条消息命中兴趣的时候。
  流程：AstrBot 命中兴趣 → 写 `live/interest-forward.jsonl` → DSH 用宿主模型生成 → 写 `live/qq-outbox` → 出站插件发群。
  **普通回复（被 @、正常接话）不走这条路**：仍是 AstrBot 自己生成、直接发群，只有一道。
  为什么这一种要绕两道：AstrBot 那边没有 DSH 的上下文（人设、记忆、索引、群里刚聊过什么），
  它生成的话不像本人；所以「要不要接」这个便宜判断留在 AstrBot 本地，「说什么」交给 DSH。
  **代价**：文件当队列、20 秒一轮，从命到发出最长约 40 秒。
  实测 2026-11-17 13:52:00 在群里发出一句 27 字（`[outbox-ok] … 27字 487ms`）。
  开关是文件 `live/interest-forward.on`：在才转发，不在就还是老办法。
- **E-3 消息身份与状态**：入站记录升 v2，`eventId` 取平台 `message_id`（实测 `idSource: platform`），`normalHandling` 三态；
  `not_handled` 有生产方（额度 / 抽签 / preflight 判不接 / 拿不准 四处），消费端只认它。
- **E-3 会话映射生成方**：`scripts/chat-sessions.mjs` 从 DSH 会话文件名推 `group:<id>` / `private:<id>` → 会话；
  一个 chatId 留多个候选，按序 `agents.get` 试。
- **E-3 去重落盘**：`live/inbox-state.json`，已结算事件不再投递，7 天 / 5000 条裁剪。
- **G B 站账号统一**：`account.mjs`（服务 + 文件双写、退出写 tombstone 防复活、generation 防迟到）+ `provider-holder.mjs`（Proxy + swap）。
  **真人验收过**：扫码后不重启 DSH，`whoami` 与收藏夹立刻读到新账号。
- **I 浏览器取文**：并回桌宠自带的那个扩展（0.4.0），带 token、带 `requestId`、忙时 409 不覆盖、超长 413。
  真机两次取文成功。
- **J 索引**：manifest 契约 + 原子发布（维度/条数不符拒绝发布，永不删当前代）+ 块级复用 +
  **断点续跑**（每批把向量追加进 `live/doc-emb-checkpoint.{json,f32}`，按 hash 认领；实测中断在 64/300，重启后复用 182/300，33 秒完成）。
- **K 用量对照**：`scripts/inject-report.mjs` 把「组装值 / 实际请求 / 费用指针」三档分开显示。
- **L 维护**：`test-support/` 最小测试层 + `scripts/check.mjs` 默认入口。

## 权限边界（H）

`browse_only` 只管**没有 DSH 远端调用权**的主体；她 / 溟 / 阑珊三个主体显式豁免。
名单匹配按 `- _ : .` 切段整段相等，不做子串猜；花钱类操作仍然拒绝。

## 不能宣称的部分

1. **E-4 的 `handled`**：`after_message_sent` 在本机 AstrBot 部署一次都不触发（该钩子按 `event.plugins_name` 过滤，旁观插件不在处理链里）。
   只做到 `claimed`（发送前取得归属），**没伪造 handled**。
2. **E-6 真实端到端**：转发链路是注入合成请求验证的，真实「群里自然聊到 → 自动命中」还没发生。
3. 深水区群 <一个群> 在 DSH 里没有会话，兴趣投递暂时到不了那里。
4. K-5 现有「注入总账」的措辞没改。
5. J-4 评测用的是合成语料，缺真实题库。

## 关于历史

这个仓库的历史在本次发布后重写过一次：真实 QQ 号 / 群号 / B站 uid 曾被误提交进公开仓库，
换成占位符后重建了仓库（旧历史只在本地留了 bundle）。功能代码与测试与首次发布的版本一致，
离线 25 项全过。以后推送前会先跑 `node scripts/check-privacy.mjs`。

## 完整回执

`docs/回执-20261117.md`（逐项状态 + 证据 + 未验清单）。
