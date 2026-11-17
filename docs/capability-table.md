# 能力表（交接书 H.3 · 2026-11-17 11:1x 填）

> 2026-11-17 11:13 她拍板：`permissionPolicy` 默认值用 **browse_only**。
> 下面最后一列就是这个默认值下的结果；显式写 `legacy` 才会回到以前的手。
>
> 2026-11-17 11:5x 她补边界：**browse_only 只管没有 DSH 远端调用权的主体**；她、溟、阑珊都放行。
> 落地方式：`permissionPolicy.subjects` 名单里写会话标识（QQ 号或会话名）。会话 id 形如
> `onebot-private-<owner-qq>-mvgpinr5`，所以名单写 `<owner-qq>` 即可——判定按 `- _ : .` 切段后
> 整段相等，不做子串猜。名单里的人可写/可执行；**花钱类在任何名单里都拒**。
> 名单为空 = 和加这条之前完全一样。

这是「软件到底拦住了什么」的核查表。**「软件是否真正限制」一列只写从代码读出来的**
（文件名 + 行号），读不出来的写「待核」，不写「应该会拦」。
「现有授权依据」一列写位置，**不抄她的私人约定原文**（交接书 479 行：私人约定原文不进公开仓库）。

| 动作 | 走的工具/脚本 | 现有授权依据 | 软件是否真正限制（代码证据） | 只浏览模式下 |
|---|---|---|---|---|
| 看网页 / 搜索 / 读视频 | `web_search`、`web_fetch`、`bilibili_*` | 个人配置 | 只读接口本身无副作用；分类为 `read`（lib/permissions.mjs RULES） | 放行 |
| 手机滑动 / 点按 / 输入 | `android_interact`(tap)、`android_tap*` | 个人授权（2026-10-22 放开） | **只拦 tap**：`index.js:1210-1217`；`android_interact` 的其它 action 直接 `next()`（:1214） | 拒（`android_action`） |
| 开关机 / 刷机 | `android_shutdown`、`android_boot`、`android_build_run` | 无（明确不做） | 硬拒：`index.js:1218-1220` | 拒（`desktop`） |
| 点赞 / 投币 / 关注 / 评论 | `bilibili_comment_post` 等 | 平台与动作分别确认 | `confirm:true` 只是该工具的参数条件，**不是所有通道的统一闸**；点按路径还能绕过（同上一条） | 拒（`publish`） |
| 主动发私聊 / 群聊 | `qq_send`、`send_message` | 指定接收目标 | 发送前的气泡数闸在 `hers_workplace/scripts/say.mjs`；目标选择见 `index.js:1238 pickTarget`（H-2 待做） | 拒（`send`） |
| 发空间 / 其它社交发布 | `qzone_post`、外部脚本 | 个人约定 | 脚本存在即执行，无二次确认；路径写死在提示词里这件事 H-2 要改 | 拒（`publish`） |
| 付费 / 购买 / 打赏 | 浏览器、移动端 | 边界：不花她的钱 | **没有统一拦截**：文字按钮检查覆盖不了图标与其他通道（dsh-ming-browse `checkTap` 只认词表） | 拒（`pay`） |
| shell / 桌面控制 | `ops_bash`、`pet_input`、`cv_act` | 无（自主轮次不该有） | **当前完全没有拦截**：pre-execute 只列了 android_* 三类，其余 `next()` | 拒（`shell`/`desktop`） |

## 读出来的三件事

1. **现在的「只读」是假的**：pre-execute 只认三个工具名（`index.js:1210-1220`），shell、桌面、发送全部走 `next()`。
2. **拦住的是「点按里的花钱按钮」，不是「所有写动作」**：`checkTap` 按词表匹配，图标/别的语言漏得掉。
3. **没有任何地方按 agent 限工具集**：自主轮次能拿到她正常轮次能拿到的任何工具。

## 还没读出来的（待核，不填猜测）

- 宿主 `tools/pre-execute` 是否支持按 agent 白名单（而不是靠插件自己 intercept）。
- `exec.agent.id` 在所有工具调用路径上都存在且可信（目前只在 browse 里用过）。
- 桌面控制（mousepet）在自主轮次里会不会被别的插件放行。
