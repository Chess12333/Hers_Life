/* 空壳，2026-11-08。
 * 这个插件的 client 半端已经撤了（package.json 里没有 dsh.client 和 ./client 导出了）：
 * 面板渲染由 dsh-ming-graph 的 build.mjs 直接读 src/panel.js 拼进它那一份 client.js。
 * 这个文件只在「改完之后、还没重启 DSH」的这段空档里有用——旧进程的清单里还有它，
 * 少了会让加载器报 404。重启完就可以删。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-interest',
  factory() {
    return { inject: [], apply() {} }
  },
})
