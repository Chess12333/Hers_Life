# dsh-ming-cursor

桌面上的**一只 AI 光标**：画出来、滑过去、说一句话。就这两件。

它不截屏、不连拍、不点、不拖、不读 UIA、不碰你的键盘。
要那些，装 [`dsh-ming-mousepet`](https://github.com/Chess12333/Hers_Life)——那是完整版（眼睛 + 手 + 卡片），这个是拆出来的轻量版。

2026-11-09 晚定的事：**鼠标单独做一个轻量仓库**，Hers_Life 那边的鼠标和这个仓库的鼠标一起更新。
做法和判据写在「两个仓库怎么不漂」那一节。

## 两个工具

| 工具 | 干什么 |
| --- | --- |
| `cursor` | `status` 现在在哪 / `show` 放到 x,y / `move` 滑过去 / `hide` 收起 / `style` 换样子 / `size` 24–192 / `mode` 陪伴或整洁 |
| `cursor_say` | 说一句：无边框气泡浮在她光标上方，几秒自己消失，**不抢焦点** |

坐标一律**屏幕绝对像素**，指光标左上角。

## 光标的两种模式

- `companion`：一直显示，直到被收起。她要它「待在屏幕上」时用这个。
- `clean`：露一下就自己收（`holdMs`，默认 2600ms）。用完就走，不碍眼。

15 只光标：`pointer / work / unavailiable / link / text / cross / busy / move / vert / horz / help / handwriting / dgn1 / dgn2 / alternate`。
素材是 64×64 的原图，放大用最近邻，不糊。

## 设置页挂在哪（不硬依赖）

- 装了 `dsh-ming-graph`（「她的一生」）→ 挂进它的顶栏，**设置里不再重复出现**；
- 没装 → 自己注册一个 `settings.section` 设置页。

判据是 `window.__MING_TAB_HOST` 在不在（graph 提供的口，见它 README 的「外部页签」一节）。
两个都是 immediately 加载，先后不定：早到的先进 `window.__MING_TABS_PENDING`，
**1.5 秒内没人来收就自己开设置页**。取舍写在 `client.js` 里——它 1.5 秒后才起来的话，会重复一个入口，不坏。

## sidecar 协议

`cursor-core.ps1` 是一个常驻的 Windows PowerShell 5.1 进程（STA），一行一条 JSON：

```jsonc
{"id":1,"cmd":"ping"}                              // {"ok":true,"pong":true,"id":1}
{"id":2,"cmd":"show","x":900,"y":500}
{"id":3,"cmd":"move","x":1200,"y":620,"ms":700}    // ms=0 直接跳；>0 缓动滑过去
{"id":4,"cmd":"hide"}
{"id":5,"cmd":"style","name":"link"}
{"id":6,"cmd":"size","px":72}
{"id":7,"cmd":"mode","mode":"clean","holdMs":2600}
{"id":8,"cmd":"status"}
{"id":9,"cmd":"say","text":"一句话","x":1200,"y":620,"ms":3200}
{"id":10,"cmd":"shutdown"}
```

响应一律 `{"id":N,"ok":true|false,...}`。`say` 会等气泡真的 Show 出来再回话（回执里的 `at` 是它的位置），
所以「说了」是有证据的，不是我以为我说了。

## 结构

```
index.js          两个工具 + 设置口（/dsh-ming-cursor/api/*）
lib/engine.js     sidecar 客户端：懒启动、按 id 配对请求响应
cursor-core.ps1   光标窗 + 气泡窗 + 请求循环（编译失败会把 stderr 原样带回来）
client.js         设置页：陪伴/整洁、大小、15 种样子、看一眼它现在在哪
assets/cursors    15 只光标（+1 张预览）
test-smoke.mjs    冒烟：默认只跑不打扰屏幕的项，--visual 才真画
fix-ps.mjs        .ps1 补 UTF-8 BOM + CRLF（PS 5.1 的坑，见下）
```

## 测试

```sh
node test-smoke.mjs            # ping / status / 越界夹紧 / 未知命令
node test-smoke.mjs --visual   # 再加上 show / move / style / say（会占屏三秒）
```

`--visual` 那几步是真画：光标出在 (900,500)、滑到 (1200,620)、气泡弹出来。
判据不是「命令回来了」，是**状态里的坐标真的变成了新坐标**——滑行是异步的，回执只说明「开始滑了」。

## 改 sidecar 之后必须做的一件事

```sh
node fix-ps.mjs cursor-core.ps1
```

PS 5.1 读**没有 BOM** 的 UTF-8 会按 ANSI 解析：中文注释变乱码，单引号 here-string 直接解析失败，
报错还指在文件中间某一无害的行上。已踩过两次（2026-11-08、11-09 各一次），所以写进流程里。

## 关于 `.env`

本仓不读、不写、不打印任何 `.env` / 密钥 / 凭据文件。整个插件没有任何需要配置的密钥。

## License

MIT
