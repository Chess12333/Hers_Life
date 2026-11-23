# v1.2.4（2026-11-23）

补丁版，没有新功能。全部来自**另一台机器从零装这套**时记的问题清单——
作者机器上不会出现、换个人装就会踩的那些。逐条回执在
`Hers_Life_For_Astrbot/docs/install-fixes-20261123.md`。

## 修了什么

**1. `qqObservations` 留空会让整条 neuron 路径抛错**（`dsh-ming-memory` 0.2.1）

`MEMORY_DEFAULTS.qqObservations` 默认 `''`，注释写「留空 = 不读 QQ 侧」；但
`readQqObservations()` 直接把它交给 `readFile`：

```
ENOENT: no such file or directory, open ''
```

星图建神经元时必调它，于是没配 QQ 侧观察库的机器上星图永远空白，还容易和另一条
「没配工作区」的错误混成同一个原因。这是全部读盘里**唯一**没有 try/catch 兜底的一处。
改成 `if (!file) return []`。

**2. 工作区改成每次现算**（`dsh-ming-graph` 1.1.1）

以前 `const WORKSPACE = (() => ...)()` 是模块加载时求值的常量，于是「照直觉建好
`~/.dsh/ming-graph.json`，然后发现不生效、得重启 DSH」这件事没有任何地方写着。
现在 `workspace()` 惰性求值：`skillsCwd` / `costPricesFile` / `costAutoFile` 三个默认值改成
getter，`/acp` 路由每次现读。**建完文件点一次面板刷新就行。**

非路径键（`ownerName` / `roomLabels`）仍是加载期读一次，这条差异和一张完整的配置键表都补进
`dsh-ming-graph/README.md`——以前键只在代码里散着，没人列全过。

**3. 兴趣唤醒的路径与提示词**（`dsh-ming-interest` 0.1.3）

- `inboxPath` / `chatSessionsPath` 支持相对路径（按 `workspacePath` 解），配置里不用再把整串
  绝对路径拼进占位符——那样按整串替换一次就会漏一半。
- 读入正文时剥掉平台接在尾巴上的 `<system_reminder>Current datetime…</system_reminder>`，
  它会跟着进提示词。

**4. 自动行为的默认值改成关**（`dsh-ming-browse` 0.1.3 / `dsh-ming-mousepet` 1.0.2）

`browse` / `interest` 的 `enabled`、`mousepet` 的 `companion.enabled`：在作者机器上打开是本意，
别人照原样装完就是「一启动就在后台烧 token、还会去找不存在的 adb」。默认全关，各带一行原因。

## 验证

- DSH 0.2.2-rc.5：`node scripts/check.mjs --suite offline` **29/29 PASS**。
- `readQqObservations('')` 实测返回 `[]`（不再 ENOENT）。
- `index.js` / `neuron.mjs` / `dsh-ming-interest/index.js` 全部 `node --check` 通过。

## 不在这个 tag 里

AstrBot 那半边（路径改成读 `MING_WORKSPACE`、平台 id 参数化、人设热同步、`requirements.txt`、
占位值自检脚本）在另一个仓 `Hers_Life_For_Astrbot`，单独提。

## 还没验的

没有真起一台 AstrBot 跑对话；没有其他人在干净 DSH 上从零装一遍。语法层干净不等于运行期没坑。
