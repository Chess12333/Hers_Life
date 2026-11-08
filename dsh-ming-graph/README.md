# dsh-ming-graph

一个 DSH 插件：**把记忆库画成一张能读的图**——每条真记忆一个点，每条边都答得出「它凭什么连」。

入口在「插件」页的 tab 栏，和插件市场并排，点开是「关系图」。

```
~/.dsh/memory/notes/*.md        ┐
QQ-Agent 的 observations.jsonl  ├──► 纯读盘建图（不过模型）──► 快照 JSON ──► 前端画图
people/_index.json（号码→昵称） ┘
```

## 为什么不是一张「好看的图」

把记忆做成星云、粒子、力导向球体的东西很多，问题是**它们不回答任何问题**：两个点为什么连着？因为距离近？因为颜色像？那些边是布局算出来的，不是事实。

这里的规矩只有一条：**边必须有理由，理由必须能读。**

所以边只有四种，每种都带一个 `why` 字符串，点开节点能逐条读：

| 边 | 凭什么连 | why 里写什么 |
|---|---|---|
| 引用 | A 的正文里出现了 B 的关键词 | 那个关键词 |
| 共词 | 两条记忆的关键词交集 ≥2 | 是哪几个词 |
| 归属 | 项目节点 ↔ 该项目下每一条记忆 | 项目名 |
| 补边 | 同项目、按时间排下来紧挨着的两条 | 时间差 |

不编数据、不画演示点。读不到就报错，不拿假货顶上。

## 配套

配 **[dsh-ming-memory](https://github.com/Chess12333/dsh-ming-memory)** 一起用：那边把 persona 文件与最近几篇日记摆进系统提示词（只读、不捕获对话），这边把这些记忆的归档画成图。

一个管「下一轮用得上」，一个管「回头看都有什么」。装不装对方都能跑，装在一起，图上的点才和提示词里的字是同一批。

## 三个视图

- **人**：星图。中心是记录者，边宽 = 关于那个人的记忆条数，只画 count ≥ 3 的。
- **主题**：词共现。只算同一条记忆里一起出现 ≥2 次的词；父子词不连边。
- **时间线**：按天，两侧分开。

**不给人和人连边。** 按共享词连过一次，连出来全是「机器人 ↔ 直接」这种噪音。人和人之间的关系，只能靠一条条能核的计数，不能靠词。

## 数据源（只读）

- **DSH 侧**（默认开）：`~/.dsh/memory/notes/*.md` 的 frontmatter。**扫目录，不读 index.json**——索引会有滞后，目录才是全的。老笔记没有 `created` 就从文件名 `20261020-123127-…` 里解析。
- **QQ 侧**（可选）：任何一行的 JSONL 观察库，路径配 `qqObservations`。**不读 evidence/原文档**——那文件几十 MB，图上用不着。
- **人名**（可选）：`peopleIndex` 指的 `{ byId: { "<号码>": [{ name }] } }`。昵称会改，认人只认号。

三个都不写死在仓库里：路径、号码、群名一律从 `~/.dsh/ming-graph.json` 读（见下面「配置」）。
## 路由与刷新

- `GET /_dsh/dsh-ming-graph/snapshot` —— 当前快照；`/refresh` 强制重算。
- 用 `connection.requestRejection` 做认证边界。**curl 不带 cookie 会拿到 401——那个 401 就是路由活着的证据。**
- Host 端每 `syncSeconds`（默认 120）stat 一次三个源，mtime 变了才重算（读 20ms + 算 100ms）。
- Client 端每 60 秒拉一次，`generatedAt` 没变就不重绘。

## top 栏：skill 开关 / 费用（2026-11-08）

她要在 top 栏直接开关 skill、直接看花掉多少钱。两个入口都是浮层，不占一格 tab——它们不是「看什么」，是「模型现在能看见什么」和「钱花在哪」。

| 路由 | 说明 |
| --- | --- |
| `GET /skills` · `/skills/refresh` | 清单：名字、描述、开关状态、来源（service / disk）、写的是哪个 `skills-off.json` |
| `POST /skills/toggle?name=<kebab-case>&on=1\|0` | 写状态文件并回读；`GET` 打这个会被挡（写动作只认 POST） |

- **清单以宿主 `ctx.skills.list()` 为准**：那是模型看到的同一份合并结果，插件包里自带的 skill 也在里面。自己扫 `~/.dsh/skills` 只能看见一半，所以扫描只当兜底（服务没接上时整份退回磁盘，面板上会明写「可能比模型真正看到的多」）。
- **开关只写 `<workspace>/skills-off.json`**（跟 `dsh-ming-skill-isolate` 同一个文件）。不跨插件调用：那个插件每次 `list()` 都重读这个文件，谁写都算数。
- **开关状态只认文件，不认服务返回的 `invocation`**：遮罩条目 rank 是 1，会赢过真 skill，描述被换成「（本工作区已隔离…）」；拿它当状态来源，关了哪几个反而看不出来。
- 费用读的是 `dsh-bottom-info-bar` 的 `/_dsh/dsh-bottom-info-bar/getUsageSummary`（POST，JSON）——它已经按条记 token×价（含缓存命中价），这里只展示，不自己算第二份账。
- 改完立刻算数，但当前这一轮的 skill 目录已经组装完，**下一次请求**才刷新。

```bash
node skills-lib.test.mjs        # 清单与开关逻辑：真磁盘 + 假服务 + 孤儿名字
node route-test.mjs             # 路由层：假 ctx 跑 apply()，抓 handler 真请求一遍（不用重启 DSH）
node panel-skillcost-test.mjs   # 两个浮层的渲染逻辑：真源码 + 假 h
```

## 人这一层：一个人一颗点

早期版本里，同一个人会在私聊房间、群成员、观察记录里各成一个点，看起来像好几个人。现在按**号码**合并：一个人一颗点，跨房间的记忆都挂在他身上；房间只作场所。

私聊房间不单独成点——一对一没有信息量。群保留场所节点。

`neuron-check.mjs` 会顺手报这件事：同号多点不为 0 就算坏。

## 平面展开：点开一个点，把它的全部相关摊平

球面那个视图只回答「谁和谁连着」；点开一个点，右边只能看到一串边，仍然读不出「这条记忆到底和哪些东西有关」。

所以加了第二层视图：**平面上以这个点为中心，把所有直接相关的条目按关系类型分扇区铺开。**

- **入口**：侧栏那个「在平面上展开这张网（N 条相关）」按钮，或者**双击**球面上的任一点。
- **左半边是图**：中心一颗点，外圈按 `project / subject / ref / cokey / adjacent` 分扇区（同类挨在一起，颜色就是类型色），线宽是权重，点大小按项目/人放大。铺不下就自动多排一环；再铺出画布就整体缩回来。
- **右半边是清单**：同一份数据按类型分组全部列出，每条带标题、权重和**为什么连**（`why` 原文），不截断。上面有过滤框，筛标题 / 正文 / 理由。
- **换中心**：点外圈任一点，或点右边任一条，就切到那个点；顶部面包屑留返回，`Esc` 或右上角关闭。
- **不编**：列表和图上都是 `buildNeuron()` 给的边，没有一条是这里补的。
- **动效**：面板淡入+轻微缩放；圈里的点从中心往外长（460ms，easeInOutQuad），标签后段才淡出；右侧条目逐条错开 16ms 淡入；关闭 180ms 淡出；换中心重播一次展开。系统设了「减少动效」就直接给最终状态。调试时把 `window.__MING_PLANE_ANIM_MS` 设长可以截中间帧。

调试入口：`make-standalone.mjs` 生成的那份 HTML 支持 `#plane=<id 或标题片段>`，打开就直接展开到那个点（写这块时截图自验用的）。

## 自己验

```bash
node neuron-check.mjs            # 报节点/边/孤立点/同号多点，并落一份 JSON 给前端调试
node neuron-check.mjs out.json   # 指定落盘路径
```

输出的是数据源的条数、图的规模、孤立点比例，以及人这一层的健康度。**它是自验，不是演示**：数字不对就是不对。

## 配置

跟某台机器绑在一起的值不进仓库，放 `~/.dsh/ming-graph.json`（或用 `MING_GRAPH_CONFIG` 指一个文件）：

```json
{
  "qqObservations": "/path/to/QQ-Agent/data/memory/observations.jsonl",
  "peopleIndex": "/path/to/workspace/people/_index.json",
  "ownerId": "123456789",
  "ownerName": "我",
  "roomLabels": {
    "group:123456": "群 · 某个群",
    "private:123456789": "私聊 · 我"
  }
}
```

**没有这个文件也能跑**：只读 DSH 侧记忆，人名显示号码，房间按号码命名，星图中心不特指谁。
配置项全写在 `index.js` 的 `DEFAULTS` 里，文件里的同名键就地覆盖。

## 装

```yaml
# profile 的 cordis.patch.yml
- id: ming-graph
  config:
    syncSeconds: 120
```

**装完要看两处**：Host 起来了不等于界面在——client 半边要等一次 HMR 重载（touch `client.js` 等几秒）才会注册进 `plugins.tab`；`Slots.listSubTree` 的 occupants 里能看到 `ming-graph` 才算成。

## 目录

```
index.js          Host 端：路由、快照、定时重算
client.js         前端入口
src/neuron-view.js  画图
neuron-check.mjs  自验
people-merge.mjs  按号码合并人
build.mjs         打包
```

**读盘和建图不在这儿**（2026-11-08 搬的）：`readDsh/readQQ/readPeople/readDiaries/build`
在 `../dsh-ming-memory/lib/model.mjs`，`buildNeuron/buildUnified` 在 `../dsh-ming-memory/lib/neuron.mjs`。
理由：神经元、星图、「她的一生」三个视图吃的是同一批数据，那批数据的实现不该住在「展示」这个插件里。
代价是**这个仓要跟 `dsh-ming-memory` 放在同一个父目录下**（默认 `C:\dsh\` 并排），
借的是相对路径而不是包名——profile 的 node_modules 是按真路径加载的，包名在这里解析不到。
单独把这个仓 clone 出去，Host 半边起不来。

## 开发约定：推送前过闸

仓库里带了一个 pre-push 钩子（`.githooks/pre-push`），拦三样东西：本机号码/路径、`.html`、超过 1 MB 的文件。

```sh
git config core.hooksPath .githooks   # 每个 clone 跑一次
```

为什么要有它：这个插件最早一版把使用者的 QQ 号、群号和两个内嵌整图数据的预览页一起推了上去，后来改写过一次历史。钩子是为了让「下次」不会再犯。

## License

MIT
