# 兼容性表（L-6）

> 只写**实际跑过**的，不写「应该支持」。每一行都要能被别人照着复现；
> 没条件验的写「未验」，不填空格的 PASS。
>
> 最后更新：2026-11-19 14:0x（Windows 本机实测）

## 本机基线

| 组件 | 版本 / 提交 | 验证层级 | 结果 | 日期 |
|---|---|---|---|---|
| Windows | 10.0.26100.8457 | windows-live | 本表所有手动项都在这个版本上跑 | 2026-11-17 |
| Windows PowerShell | 5.1.26100.8457 | parse | `check.mjs --suite windows-live` 的 sidecar 解析项 | 2026-11-17 |
| Node | v24.21.0 | offline / build | `node scripts/check.mjs --suite offline` 全绿 | 2026-11-17 |
| DSH | 0.2.2-rc.5 | host-contract | 十一套 ming 插件在 rc.5 上加载、注入块照常；`--suite offline` 29/29 PASS。`host` 档（`MING_RUN_MANUAL=1`）与 `windows-live` 本轮未重跑 | 2026-11-19 |
| AstrBot | 4.29.4 | E 端到端 | 6199 端口收消息、日志「适配器已连接」 | 2026-11-17 |
| Chrome | 157.0.4341.57 | I 扩展联调 | **未验**：需要扩展 + sidecar + Node 同批升级 | — |

## 检查分档与前置条件

| 档 | 跑什么 | 前置条件 | 会不会碰真实数据 |
|---|---|---|---|
| `offline` | 纯逻辑、合成工作区、假网络 | 只要 Node | 不会（`fixture: 'workspace'` 会现场造一个临时工作区） |
| `build` | 生成物 vs 源码 | 只要 Node | 不会（重建到仓库内，不碰 live） |
| `host` | 需要宿主真实注入的断言（【时间感】块） | 真 DSH 会话 | 读，不写 |
| `windows-live` | PS 5.1 解析、桌宠、扩展、账号 | 真 Windows + 真设备 | 可能读本机状态，**必须人工跑** |
| `fixture` | runner 自己的自测（故意失败） | 只要 Node | 不会 |

## 已知未验项（如实记录）

1. **I 浏览器取文**：设置页 `options.html` 已补进仓库（2026-11-17，R03）；仍未在 Chrome 里真装过一次、没做右键到桌宠回答的实机链路。旧 47322 收文口已默认关闭（R07），要接老扩展得显式开 legacyWebPick。
2. **G 统一 B 站登录**：真实入口的三个反例（恢复要校验 / tombstone 优先 / 退出的迟到结果不写回）已用假宿主 + 假网络离线跑过（`qa-entry.mjs`，8 项）；仍需一次真人扫码 + 退出 + 重启确认「旧文件不复活」。
3. **中文 / 空格路径**：`check.mjs` 用参数数组启动子进程（不经 shell），理论上安全，但**没有在中文空格路径的仓库副本上实跑过**。要在本机换目录验一次才算。
4. **完整干净安装**：没有在另一台机器上从零装过。
5. **向量质量**：J-4 的 30 道**合成**题已建（`test-support/rag-eval.mjs`），只证明检索逻辑；真实资料上的 5–10 题仍待验。
6. **J 索引整组切换**：读端已认 `live/rag-index/current.json`（R09，从不可变代目录一次取齐四个文件，代不完整或比 live 旧就退回 live）；生成链仍在本机、不在公开仓库，所以「生成 + 发布 + 读取」的完整链路只能证明三分之二。

## CI

暂不接 GitHub Actions。原因：本仓库的检查有一半要 Windows 本机条件（PS 5.1、桌宠、扩展、账号），
CI 里跑不出真结果，只会显示一片绿色——那比没有 CI 更坏。
要接的话只接 `--suite offline` 与 `--suite build`，固定 Node 24、不登录任何账号、不向真实群发消息。

## 相关命令

```bash
node scripts/check.mjs --list
node scripts/check.mjs --suite offline
node scripts/check.mjs --suite build
MING_RUN_MANUAL=1 node scripts/check.mjs --suite host
node scripts/check.mjs --suite windows-live    # 人工看着跑
```
