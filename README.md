# 溟 · DSH 插件集

一台 Windows 机器上，一个 AI 的**记忆、眼睛、手和声音**。十二个插件，跑在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）上。

它们不是一个框架，是同一个东西的十二个面：会记得、会看图、会动手、会说话、会自己出去逛。

## 这里面有什么

| 包 | 干什么 |
|---|---|
| `dsh-ming-core-memory` | 核心记忆 + 归档记忆。核心常驻注入，归档按意思检索；写入政策只收机器/环境/项目事实，不写关于人的判断 |
| `dsh-ming-memory` | 开场记忆：把人设文件与最近几篇日记拼进系统提示词，只读不回写 |
| `dsh-ming-graph` | 记忆神经元与星图。每条真记忆一个点，每条边都带「凭什么连」的理由 |
| `dsh-ming-mousepet` | 桌宠：截图、连拍、气泡说话（不抢焦点）、UIA/窗口消息动手 |
| `dsh-ming-voice` | 文字转语音，落成 mp3 |
| `dsh-ming-bilibili-account` | B 站：扫码登录、搜视频、字幕、评论、私信、历史、收藏 |
| `dsh-ming-browse` | 「自己玩」：工作区闲够久时自己醒一轮，只读地看，点按被硬拦 |
| `dsh-ming-interest` | 兴趣唤醒：被 @ 门控丢掉的消息里，只有命中在意的题材才叫醒 |
| `dsh-ming-wake` | 定时唤醒：工具写 `dueAt`，插件扫描后调 `agents.resume` |
| `dsh-ming-resume` | 插话之后记得回去：检测到 steer 插话，下一步追加「先答她、再回到原任务」 |
| `dsh-ming-skill-isolate` | 按工作区遮 skill：这个目录用不上的从模型视野里关掉，不删文件 |
| `dsh-ming-ui` | **不是插件**。两份「唯一源」（样式、面板渲染）和把它们推给各包的同步脚本 |

## 装法

这些包走 DSH profile 的 `link:` 安装，没有发 npm。假定你 clone 到 `C:/dsh/ming`：

```jsonc
// <DSH_HOME>/profiles/web/package.json 的 dependencies
"dsh-ming-graph": "link:C:/dsh/ming/dsh-ming-graph",
"dsh-ming-mousepet": "link:C:/dsh/ming/dsh-ming-mousepet",
// ……其余九个同理
```

再把它们加进同一个文件的 `dsh.profile.bundles` 数组，重启 DSH。

`client.js` 是构建物。改 `src/` 之后要重建：

```bash
cd dsh-ming-graph && node build.mjs        # 会先跑 sync-panels --check，漂了拒绝构建
cd dsh-ming-memory && node build.mjs
```

## 隐私

这个仓是从本机导出的，导出脚本会先剔一遍再自检（本机用户名、QQ 号、群号、B 站 uid、密钥、真人昵称、超过 1MB 的文件），命中任何一条就不许提交。

所以下面这些**不是配置，是占位**，你得自己填：

| 变量 / 位置 | 说明 |
|---|---|
| `MING_WORKSPACE` | 工作区目录（放人设、日记、见闻的那个夹子） |
| `MING_OWNER_QQ` | 谁的私聊算「本人指令」（`dsh-ming-browse` 的开关只认这个号） |
| `USERPROFILE` | 本机路径默认从它拼，不用改 |
| `MING_FFPLAY` | 试听用的 ffplay，默认走 `PATH` |
| `MING_GRAPH_CONFIG` | 星图的本地配置（群号、群名），默认 `~/.dsh/ming-graph.json` |

`dsh-ming-interest/cordis.patch.yml` 里的群号是空的，填你自己的。

## 状态

在一台机器上天天用，不是发布版。改动的理由和踩过的坑都写在代码注释里——那些注释是这个仓最有用的部分。

## 来源与致谢

- `dsh-ming-mousepet` 里**输入与 AI 光标**那一半，来自 [**dsh-independent-input**](https://github.com/dongcaodeliyu/dsh-independent-input)（作者 **dongcaodeliyu**）。
  它把「操作鼠标键盘」从悬浮球里单独拆出来，默认走 UIA / 窗口消息、不动主人真实光标。这份代码的安全边界原样保留（见那个包的 README）。
  原仓照旧可用，只想要输入、不想要陪桌的，直接用原仓就行。
- 截屏与「看屏幕」那一半原有 `dsh-ming-desktop`，2026-11-08 起退役，已并进 `dsh-ming-mousepet`。
- 其余各包为本机自写。

## 许可

MIT。随便用，出问题别找我。
