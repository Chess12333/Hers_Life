// ⚠ 由 dsh-ming-ui/sync.mjs 生成，不要手改。改 C:\dsh\dsh-ming-ui\src\theme.js
/**
 * dsh-ming-ui —— 我们自己那批插件的共用皮（2026-11-07 立）
 *
 * 一条规矩：**只写 --dsw-alias-* token，不写死颜色、不写死 px 颜色值**。
 * 现在宿主是浅色，`dsh-myskin` 换主题时这些面板要跟着变；写死一个 #fff，
 * 深色底下就是一整块白。
 *
 * 为什么是这么个怪文件：各插件的 build.mjs 是「读源码文本 → 拼进 client.js」，
 * 不是真打包。所以这份源码里不能出现 import/export（拼进 CJS 工厂会炸），
 * 写成 IIFE 挂在 MING_UI 上；末尾留一句 module.exports，Node 里也能 require。
 *
 * 用法（插件里）：
 *   const MING_UI = require('./theme.js')   // 或者直接内联，同名变量已在作用域里
 *   style.textContent = MING_UI.css('ming') // 前缀用来避开宿主的同名类
 *   尺寸走 MING_UI.SCALE，颜色走 MING_UI.TOKENS.xxx
 *
 * 这一份是**唯一源**。改这里，然后 `node sync.mjs` 推到各插件的 src/theme.js。
 */
const MING_UI = (() => {
  /** 颜色：全部对到宿主的 alias token。名字按「用在哪」取，不按色值取。 */
  const TOKENS = {
    bg: 'var(--dsw-alias-bg-base)',
    surface: 'var(--dsw-alias-bg-layer-1)',
    surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
    overlay: 'var(--dsw-alias-bg-overlay)',
    border: 'var(--dsw-alias-border-l2)',
    borderSoft: 'var(--dsw-alias-border-l1)',
    borderStrong: 'var(--dsw-alias-border-l3)',
    separator: 'var(--dsw-alias-separator-secondary)',
    text: 'var(--dsw-alias-label-primary)',
    textDim: 'var(--dsw-alias-label-secondary)',
    textFaint: 'var(--dsw-alias-label-tertiary)',
    accent: 'var(--dsw-alias-brand-primary)',
    hover: 'var(--dsw-alias-interactive-bg-hover)',
    active: 'var(--dsw-alias-interactive-bg-active)',
    danger: 'var(--dsw-alias-state-error-primary)',
    warn: 'var(--dsw-alias-state-warn-primary)',
    ok: 'var(--dsw-alias-state-success-primary)',
  }

  /** 尺子：间距/圆角/字号只从这里取，别在组件里现编一个 7px。 */
  const SCALE = {
    gap: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radius: { sm: 6, md: 10, lg: 14 },
    font: { xs: 11, sm: 12, md: 13, lg: 15, xl: 18, hero: 22 },
    line: 1.55,
  }

  /**
   * 生成一份样式表。prefix 默认 ming，用来避开宿主或其他插件的同名类。
   * 面板骨架只有六个：panel / head / card / row / stat / empty。多一个算我输。
   */
  function css(prefix) {
    const p = prefix || 'ming'
    const S = SCALE
    return `
.${p}-panel {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: ${TOKENS.bg}; color: ${TOKENS.text};
  font-size: ${S.font.md}px; line-height: ${S.line};
}
.${p}-head {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.md}px ${S.gap.lg}px; border-bottom: 1px solid ${TOKENS.separator};
  flex: 0 0 auto;
}
.${p}-title { font-size: ${S.font.lg}px; font-weight: 600; color: ${TOKENS.text}; }
.${p}-sub { font-size: ${S.font.sm}px; color: ${TOKENS.textFaint}; }
.${p}-body {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: ${S.gap.lg}px; display: flex; flex-direction: column; gap: ${S.gap.md}px;
}
.${p}-card {
  background: ${TOKENS.surface}; border: 1px solid ${TOKENS.borderSoft};
  border-radius: ${S.radius.md}px; padding: ${S.gap.md}px ${S.gap.lg}px;
}
.${p}-row {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.sm}px ${S.gap.md}px; border-radius: ${S.radius.sm}px;
  border-bottom: 1px solid ${TOKENS.separator};
}
.${p}-row:last-child { border-bottom: none; }
.${p}-row:hover { background: ${TOKENS.hover}; }
.${p}-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.${p}-kpi { font-size: ${S.font.hero}px; font-weight: 600; color: ${TOKENS.text}; letter-spacing: -0.02em; }
.${p}-empty {
  margin: auto; padding: ${S.gap.xl}px; text-align: center;
  color: ${TOKENS.textFaint}; font-size: ${S.font.sm}px;
}
.${p}-pill {
  display: inline-flex; align-items: center; gap: ${S.gap.xs}px;
  padding: 1px 8px; border-radius: 999px; font-size: ${S.font.xs}px;
  background: ${TOKENS.surfaceAlt}; color: ${TOKENS.textDim};
  border: 1px solid ${TOKENS.borderSoft};
}
.${p}-pill[data-tone="ok"] { color: ${TOKENS.ok}; border-color: ${TOKENS.ok}; }
.${p}-pill[data-tone="warn"] { color: ${TOKENS.warn}; border-color: ${TOKENS.warn}; }
.${p}-pill[data-tone="danger"] { color: ${TOKENS.danger}; border-color: ${TOKENS.danger}; }
.${p}-btn {
  font: inherit; font-size: ${S.font.sm}px; cursor: pointer;
  padding: ${S.gap.xs}px ${S.gap.md}px; border-radius: ${S.radius.sm}px;
  background: ${TOKENS.surfaceAlt}; color: ${TOKENS.text};
  border: 1px solid ${TOKENS.border};
}
.${p}-btn:hover { background: ${TOKENS.hover}; }
.${p}-btn:active { background: ${TOKENS.active}; }
.${p}-btn[data-primary="1"] { background: ${TOKENS.accent}; color: #fff; border-color: transparent; }
.${p}-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.${p}-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1); border-radius: 4px; }
.${p}-scroll::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1); }
`
  }

  return { TOKENS, SCALE, css, version: '0.1.0' }
})()

if (typeof module !== 'undefined' && module.exports) module.exports = MING_UI
