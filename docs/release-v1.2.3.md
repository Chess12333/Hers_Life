# v1.2.3（2026-11-19）

补丁版。没有新功能，修一处「脚本里好、宿主里坏」的接线。

## 修了什么

**rag_recall 三层全报「未配置工作区」。** lib/rag.js 在模块加载那一刻读 MING_WORKSPACE，
而 DSH 的插件进程里没有这个变量（宿主只给 DSH_HOME），于是 LIVE 一直是空串。
脚本版自己带着变量跑，所以只有工具层坏、命令行好。

改成懒解析：第一次真要用时按 环境变量 → ~/.dsh/ming-memory.json 的 root → ~/.dsh/open-door.json 的 root 找工作区。
setWorkspace() 留给测试和迁移，同一个路径重复调用不重算、不清缓存。

实测（env -u MING_WORKSPACE 起进程、直接调 ragSearch）：拿回 doc 层命中，不再报未配置。

## 关于 DSH 0.2.2-rc.5

不用为升版改代码，理由是可查的：

- 宿主侧 evaluatePluginCompatibility（dsh-app-boot/lib/index.js:1100）和 dshmarket 的
  discovery-compatibility.js:153 都带 includePrerelease: true，所以 engines.dsh 写 ">=0.2.0"
  也认 0.2.2-rc.5；不带那个参数 semver 会判 false（实测）。
- cordis 在 rc.1 与 rc.5 里都是 4.1.0，peer ^4.0.1 照旧满足。
- 本机 rc.5 上：--suite offline 29/29、--suite build 2/2 PASS，插件加载与开场注入正常。

host 档（MING_RUN_MANUAL=1）与 windows-live 本轮没有重跑，兼容表里如实标着未跑。
