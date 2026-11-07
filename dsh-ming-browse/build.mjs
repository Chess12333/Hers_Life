/**
 * build.mjs —— 把 src/theme.js + src/panel.js 拼成 client.js（同 dsh-ming-memory 的拼法）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p) => fs.readFile(path.join(here, p), 'utf8')

const theme = await read('src/theme.js')
const panel = await read('src/panel.js')

const out = `/**
 * dsh-ming-browse —— 逛到哪儿了（Client 半端）
 *
 * ⚠ 生成物：改 src/panel.js 或 dsh-ming-ui/src/theme.js，然后 node build.mjs
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist → 浏览），点开占满主区域（main key = ming-browse）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-browse/state，只读。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-browse',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

${theme}

${panel}

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'ming-browse',
        }, BrowsePanel))
        // 2026-11-07 18:5x：侧栏图标撤了——四个面板统一进「她的一生」（dsh-ming-graph）的 tab 里。
      },
    }
  },
})
`

await fs.writeFile(path.join(here, 'client.js'), out, 'utf8')
console.log('client.js', out.length, 'bytes')
