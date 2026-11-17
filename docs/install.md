# 最小安装（F-3）

> 这是**本机跑通过**的一份记录，不是「所有机器都行」的承诺。
> 每条都标了验证层级：`已验证` = 在这台机器上真跑过；`未验` = 没条件，别当已经支持。

## 1. 支持条件

| 项 | 本机实测值 | 说明 |
|---|---|---|
| Windows | 10.0.26100.8457 | 只有这一个版本验过 |
| Node | v24.21.0 | `check.mjs` 用 ESM + `spawnSync`，Node 18+ 大概率可用，但**没逐个版本验** |
| DSH | 0.2.2-rc.1 | 插件靠 Cordis 的 `inject` / `tools` / `agents`；低版本不一定有 |
| AstrBot | 4.29.4 | 只有 QQ 那半边需要；不装也能跑记忆与 UI |

## 2. 安装方式

当前**没有发 npm**。本机是 DSH profile 的 `link:` 依赖 + `dsh.profile.bundles`：

```jsonc
// ~/.dsh/profiles/web/package.json 里
{
  "dependencies": {
    "dsh-ming-memory": "link:C:/dsh/dsh-ming-memory",
    "dsh-ming-core-memory": "link:C:/dsh/dsh-ming-core-memory",
    "dsh-ming-browse": "link:C:/dsh/dsh-ming-browse"
  }
}
```

Windows 路径用正斜杠。`link:` 指向的目录必须是**运行目录**（DSH 实际加载的那份），不是源码仓库
——这两者是两套文件，改仓库不会自动生效，这是今天踩过的坑。

## 3. 三个位置要分清

| 名字 | 是什么 | 本机值 |
|---|---|---|
| 源码仓库（`MING_ROOT`） | 放代码、跑的测试、生成物 | `C:\dsh\Hers_Life` |
| 数据工作区（`MING_WORKSPACE`） | 人设、日记、`live/`、索引 | `C:\dsh\hers_workplace` |
| 宿主配置目录 | profile 的 `cordis.patch.yml`、插件 config | `C:\Users\<你>\.dsh\profiles\web` |

`MING_ROOT` 与 `MING_WORKSPACE` **不是一回事**：混淆的结果是构建去读数据目录、或者插件去数据目录找源码。

## 4. 递进组合（别一次全装）

1. **最小可用**：`dsh-ming-core-memory` + `dsh-ming-memory`。给一个带 `persona/`、`diary/` 的工作区就能开场。
2. **加 UI**：`dsh-ming-graph`（关系图）→ 需要先构建生成物：`node dsh-ming-graph/build.mjs`。
3. **加自己玩**：`dsh-ming-browse`（要 `workspacePath` 指向数据工作区）。
4. **加声音/桌宠**：`dsh-ming-voice`（要 ffplay）、`dsh-ming-mousepet`（要 Windows 桌面）。
5. **加 QQ**：AstrBot + E 的消息桥。这一步最重，前四步都能独立跑。

## 5. 素材

| 文件 | 用途 | 是否必需 |
|---|---|---|
| `dsh-ming-ui/src/theme.js` | 所有面板共用的主题 | 构建 UI 必需 |
| `dsh-ming-graph/icon.svg` | 侧栏图标 | 可选（缺了没图标） |
| 立绘 / 语音模型 | 桌宠、语音 | 可选（缺了对应用不了，其它照常） |

没有捆绑任何私人素材；缺了只有对应功能不可用。

## 6. 外部组件（缺了怎么降级）

| 组件 | 用途 | 缺了会怎样 |
|---|---|---|
| 嵌入服务（`EMB_ENDPOINT`，默认 `127.0.0.1:18091`） | 语义检索 | `rag` 三层报 `service: unavailable`，关键词层照常 |
| `ffplay` | 语音试听 | 只有试听不可用，合成不受影响；用 `MING_FFPLAY` 指定路径 |
| B 站凭证（`~/.dsh/bili-duty/bili_credential.json`） | B 站工具 | 只读接口仍可用，需要登录的返回明确错误 |
| AstrBot | QQ | 不装就没有 QQ 那半边，网页这边完全不受影响 |

## 7. 启动后怎么算成功

- DSH 里能看到 `【溟 · 开场记忆】` 那段字 → memory 插件挂上了。
- 面板上有记忆关系图图标、点开有内容 → graph 挂上了。
- 右侧栏看到「自己玩」状态 → browse 挂上了。
- 启动日志里没有 `Traceback` / `cannot get property ... without inject`。

关闭可选组件：在 `cordis.patch.yml` 里给它那条加 `disabled: true`，别删依赖。

## 8. 没验的部分

- **干净用户 / 第二台机器从零装**：未验（F-T9）。
- **中文空格路径**：构建脚本已用参数数组，理论安全；`qa-portability.mjs` 在临时目录验过，
  但临时目录路径是英文的，**中文没实跑**。
- **npm 发布**：没有。将来要发，另跑 `npm pack --dry-run` 检查 client / license 是否齐。

## 相关检查

```bash
node scripts/check.mjs --suite offline
node test-support/qa-portability.mjs   # F-T1/T2/T4/T5
```
