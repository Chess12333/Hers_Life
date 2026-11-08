# dsh-ming-mousepet

桌面上陪着她。看得见、会说一句话、也能动手——三件事本来分在两个插件里（`dsh-independent-input` 负责输入和 AI 光标、`dsh-ming-desktop` 负责看），这个插件把它们并成一个。

2026-11-08 起。起因是她说「把电脑操作插件和独立光标插件合在一起做一个新插件，像是在桌面陪伴，偶尔还会说两句话」。

## 两个工具

### `pet` —— 陪伴层（默认只读）

| action | 干什么 |
| --- | --- |
| `status` | 前台窗口、她多久没动、光标状态、今天说过几次 |
| `look` | 看一眼屏幕（可裁），图直接附上来 |
| `watch` | 连拍几秒，只回变化大的帧；静止画面只回一张 |
| `say` | 在桌面上说一句话：无边框气泡浮在她光标上方，几秒自己消失，不抢焦点 |
| `nudge` | 问「现在值不值得开口」，回 speak 与否 + 为什么 + 现在什么情况 |
| `cursor` | AI 光标 显示 / 隐藏 / 移动 / 大小 / 模式 |

`nudge` **不生成话**。它只回答该不该说、现在什么情况；说什么由模型自己写。
插件一旦开始编话，就会变成定时播报器，那不是陪伴。

判据（`lib/pet.js`）：

- 静音 00:30–10:30
- 她 15 秒内动过电脑 → 不说（正在用）
- 两次开口至少隔 10 分钟
- 一天最多主动说 6 次
- 她安静满 25 分钟才值得开口

### `pet_input` —— 动手层

`status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay`。

默认走 UIA / 窗口消息：**不移动真实光标、不抢键盘焦点**，她随时可以继续用鼠标键盘。
`mode:"physical"` 才是真 SendInput。她按 **Ctrl+Alt+Q** 随时暂停；一碰鼠标键盘，物理模式立刻暂停并把光标放回原处。

## 边界写在代码里

- 气泡用 `WS_EX_NOACTIVATE`，不夺焦点。
- 物理输入只在显式要求时启用。
- `watch` 是最便宜的一档：静止画面只回一张，不在那儿空转。
- 没有 `postinstall`，没有运行时依赖；侧车是 Windows PowerShell 5.1 + WinForms。

## 结构

```
index.js        工具层（pet / pet_input）
client.js       Web 侧设置页（光标大小/模式、显示/隐藏）
lib/engine.js   sidecar 客户端（一行一条 JSON）
lib/pet.js      该不该开口（nudge 判据）
sidecar.ps1     STA 常驻：UIA / 消息输入 / AI 光标 / 截图 / 气泡 / 帧差
assets/cursors  15 只 AI 光标（精灵图）
assets/previews 设置页预览
test/           sidecar 冒烟与输入测试
```

## 跑测试

```bash
node test/pet-test.mjs
```

起 sidecar，依次发 ping / status / say / watch，再确认说完话 sidecar 还活着。
`say` 会在屏幕上真的弹一个气泡——这是唯一能验证「她看得见」的办法。

## 已知

- `sidecar.ps1` **必须带 UTF-8 BOM**。PS 5.1 读无 BOM 的文件按 ANSI 解，中文注释会把字符串截断，整份解析失败。编辑这个文件之后记得补 BOM。
- 跟 `dsh-independent-input`、`dsh-ming-desktop` 目前并存；两套 AI 光标会叠在一起。替掉旧插件之前别同时开。

---

## 来源与致谢

这个插件是把两样东西并起来的，其中一样不是我的：

| 部分 | 出处 |
|---|---|
| UIA / 窗口消息那套输入、AI 光标 | [**dsh-independent-input**](https://github.com/dongcaodeliyu/dsh-independent-input)（作者 dongcaodeliyu），原仓照旧可用 |
| 截屏、看屏幕 | `dsh-ming-desktop`，我自己写的，2026-11-08 起退役 |

「独立」两个字是从前者带过来的：它的意思**不是**再装一套系统鼠标（Windows 只有一个光标和一个键盘焦点），
而是**不占用主人那套光标和焦点**——点击/输入优先走 UIA 或窗口消息，只有显式 `mode:"physical"` 才动真光标，
而且主人一碰键鼠就立刻暂停、把光标放回原处。

合并时我保留了它的这条安全边界，也保留了「物理输入是显式回退」这个默认值。要是有人只想要输入、不想要陪桌，
直接用上面那个原仓就行。

## 桌面上那只怎么用（2026-11-08）

- **轻点一下**：它说一句（相当于你叫它一声）。这一次不占「每天最多几次」的自动开口配额。
- **按住再拖**：挪位置。按住超过约 0.2 秒再移动才算拖，手抖不会把它拖走。
- **右键**：锁定 / 取消锁定、关闭显示。
