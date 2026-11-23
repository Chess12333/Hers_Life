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

### 2.1 环境变量（换机器唯一要改的地方）

两个仓里的路径都先读环境变量，没设才退回作者本机那份。在**启动 DSH / AstrBot 的那个环境**里设：

| 变量 | 谁读 | 作用 |
|---|---|---|
| `MING_WORKSPACE` | 全部插件 | 数据工作区（`live/` `people/` `diary/`） |
| `MING_ROOT` | 构建脚本 | 源码树（生成物、测试落盘） |
| `MING_GRAPH_CONFIG` | `dsh-ming-graph` | 换一个本机配置文件（默认 `~/.dsh/ming-graph.json`） |
| `MING_PLATFORM_ID` / `MING_SELF_NAME` | AstrBot 侧插件 | 平台 id 前缀与自我称呼 |
| `MING_HER_QQ` / `MING_OWNERS` / `MING_GROUPS` | AstrBot 侧插件 | 主人号、自己人、群号 |

自检：`python tools/check-placeholders.py`（在 `Hers_Life_For_Astrbot` 里跑）。

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

## 9. 换机器撞到的环境问题（2026-11-23，另一台机器上记的）

不是本仓代码的问题，但按 README 从零装一定会遇上，记下来免得下一个人重踩：

| 现象 | 根因 | 绕法 |
|---|---|---|
| 装本地目录包报 `ambiguous-install`，`package.json` 被回滚 | DSH 的 `plugin_manager install_bundle` 跑 `pnpm add link:<dir>` 后从输出里认包名，输出里同时列了已有的包就判歧义 | 走手工路线：`pnpm add link:...` + 手写 `dsh.profile.bundles` |
| WSL 里跑 Docker 的 QQ 过一会儿就掉线 | 没有客户端连着约 1 分钟后 WSL 关整个虚拟机；`vmIdleTimeout=-1` 在 WSL 3.0.5 上实测无效 | 挂 `wsl.exe -d <distro> -- sleep infinity` 按住，并做成登录自启的计划任务（vbs 转一层不弹黑窗） |
| compose 里写 `127.0.0.1:6081:6081` 后，Windows 侧完全连不上 noVNC | WSL 的 localhost 转发连的是虚拟机 eth0，不是回环 | 写 `"6081:6081"`（WSL 本身在 NAT 后面，局域网看不到） |
| 进不去 SnowLuma 的 noVNC | 密码每次随机、只打在启动日志里 | 镜像认 `VNC_PASSWD` 环境变量（文档没写），在 compose 里固定下来 |
| PyPI 装 `opencv-python-headless` 卡十几分钟 | 直连慢 | `--default-index https://mirrors.aliyun.com/pypi/simple/` |
| GitHub release 附件 48 KB/s 甚至不动 | 直连被限 | `ghfast.top` 前缀代理（实测 250 KB/s–1.8 MB/s） |
| Docker Hub 拉不动 | `registry-1.docker.io` 直连不通 | 配 `registry-mirrors`（如 `docker.1ms.run`） |
| Playwright 浏览器下载慢 | 官方 CDN | `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` |
| ubuntu-base rootfs 里 apt 报 `Certificate verification failed` | 镜像里没有 CA 证书 | apt 源先用 **http**，装 `ca-certificates` 之后再换 https |
| `systemctl: command not found` / dockerd 不自启 | 没有 systemd | 先 `apt install systemd systemd-sysv` |

## 相关检查

```bash
node scripts/check.mjs --suite offline
node test-support/qa-portability.mjs   # F-T1/T2/T4/T5
```
