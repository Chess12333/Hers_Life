# dsh-ming-ui —— 不是插件

这里没有 `package.json`，也没有界面。**它一个插件都不是**，是 ming 系列共用的两份「唯一源」和把它们推给各插件的两个脚本。

名字叫 ui，是因为里头的源都是样式和面板渲染；它自己不注册任何东西。

## 为什么要有这个目录

各插件的 `build.mjs` 不是真打包，是「读文本 → 拼进 client.js」。所以没法 `import '@ming/ui'`，只能各留一份拷贝。拷贝多了必然漂，于是就设唯一源 + 一个比对脚本。

| 源 | 谁在抄 | 推给谁 |
|---|---|---|
| `src/theme.js` | 5 个插件 | `dsh-ming-{graph,memory,interest,voice,browse}/src/theme.js` |
| `dsh-ming-*/src/panel.js`（各插件自己那份是源） | `dsh-ming-graph` | `dsh-ming-graph/src/panels.js` 里的同名段落 |

## 三个脚本

```
node sync.mjs             # 把 theme.js 推给 5 个插件
node sync.mjs --check     # 只比对，漂了退出码 1

node sync-panels.mjs      # 把各插件的 panel.js 段落推给 graph/src/panels.js
node sync-panels.mjs --check
```

`sync-panels.mjs` 里的 `SHELL_ONLY` / `STANDALONE` 两份清单是**账**，不是待办：
桌宠、接续、桌面只活在壳里（没有独立源）；记忆自成一个独立页（自己的 build，自己注册图标）。
它们不参与同步，但 `--check` 会把它们一起打出来——省得下次有人问「怎么没在同步表里」，还得重新查一遍。

## 两条规矩

1. **改面板：改插件那份源，再跑 `sync-panels.mjs`。** 别直接改 `graph/src/panels.js`——下次同步就被覆盖。
2. **`dsh-ming-graph` 的 `build.mjs` 现在会先跑 `--check`，漂了就拒绝 build。** 这条是 2026-11-08 加的，起因是同一份面板改了两小时、文件全对，跑的还是旧拷贝。

## 改完的完整顺序

```
node dsh-ming-ui/sync-panels.mjs
node dsh-ming-ui/sync.mjs
cd dsh-ming-graph && node build.mjs      # 内含 --check，不过就不出产物
```

DSH 那边要刷新页面才看得到（client 半端是构建物，不是热更）。

## 历史

- `_patch-*.mjs`：2026-11-07 给各插件补「面板只读接口」时用的一次性脚本，已挪进 `C:\dsh\backup\ui-patches-20261108\`。打的就是源码本身（node_modules 里全是软链接），留着会让人以为还得再跑一遍。

---

2026-11-08 03:4x 立。此前这个目录没有说明，容易被人当成「有个界面插件叫 ming-ui」。
