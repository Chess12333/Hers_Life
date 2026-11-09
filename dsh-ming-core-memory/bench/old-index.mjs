// dsh-core-memory — 跨会话持久记忆（OpenClaw 风格：核心记忆常驻注入 + 归档记忆按需检索）
// 由动态插件 dshmem-3 原型固化而来；静态 host 插件，Node 原生 fs 直读直写。
//
// 布局（<dshHome>/memory/，默认 ~/.dsh/memory）：
//   MEMORY.md   核心记忆：每个会话系统提示常驻注入（order 60 节，同步读、永远新鲜）
//   notes/      归档记忆：一条一文件，front-matter（id/title/tags/created/updated
//               /status/source/supersedes/last_confirmed）
//               2026-10-30 加后四个字段：状态（候选/生效/被取代/作废）、来源（她说的/我推断的/
//               观察到的）、被哪条取代、最近一次被证据确认的日期。检索默认不返回作废/被取代的。
//   index.json  元数据索引（list/search 的真相源；损坏时从 notes/ 重建）
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  buildPersonaText,
  listPresets,
  readPersona,
  renderPersonaFile,
  normalizePersonaInput,
  personaPath,
  MAX_CUSTOM_TEXT,
  PRESETS,
} from '../lib/persona.js';

export const name = 'dsh-core-memory';
export const inject = ['tools', 'systemPrompt'];

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}
const corePath = () => join(dshHome(), 'memory', 'MEMORY.md');
const notesDir = () => join(dshHome(), 'memory', 'notes');
const indexPath = () => join(dshHome(), 'memory', 'index.json');

const TEMPLATE = [
  '# DSH 核心记忆',
  '',
  '> 由 dsh-ming-core-memory（AI的 fork）维护，并注入每个会话的系统提示。保持精炼（建议 6KB 内）。',
  '> 可用 memory_core 工具增删改，也可手工编辑（插件每次组装时同步读取，立即可见）。',
  '> 只装事实，不装人。',
  '',
  '## 环境',
  '- （机器、部署、常用路径等长期事实）',
  '',
  '## 项目',
  '- （进行中的项目、关键决策与约定）',
  '',
].join('\n');

// ---------- 纯函数 ----------
function noteSort(a, b) { return (b.created || '').localeCompare(a.created || '') }

// 记忆状态（2026-10-30）：缺字段的老条目一律当「生效 / 来源未知」——不能一夜之间全变候选。
const STATUSES = ['candidate', 'active', 'superseded', 'invalidated'];
const SOURCES = ['user_statement', 'direct_observation', 'agent_inference', 'external_source', 'unknown'];
const RETIRED = ['superseded', 'invalidated'];
function normStatus(v, fallback = 'active') {
  const s = String(v || '').trim().toLowerCase();
  return STATUSES.indexOf(s) >= 0 ? s : fallback;
}
function normSource(v, fallback = 'unknown') {
  const s = String(v || '').trim().toLowerCase();
  return SOURCES.indexOf(s) >= 0 ? s : fallback;
}
function isRetired(n) { return RETIRED.indexOf(normStatus(n && n.status)) >= 0 }
function statusLabel(s) {
  return { candidate: '候选', active: '生效', superseded: '已被取代', invalidated: '已作废' }[normStatus(s)] || normStatus(s);
}
function sourceLabel(s) {
  return { user_statement: '她说的', direct_observation: '观察到的', agent_inference: '我推断的', external_source: '外部来源', unknown: '来源未知' }[normSource(s)] || normSource(s);
}

function parseNoteFile(text) {
  const out = { meta: {}, body: text };
  if (typeof text === 'string' && text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) {
      const fm = text.slice(3, end);
      out.body = text.slice(end + 4).replace(/^\n+/, '');
      for (const line of fm.split('\n')) {
        const at = line.indexOf(':');
        if (at > 0) out.meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
    }
  }
  return out;
}

function parseCoreSections(text) {
  const lines = String(text).split('\n');
  const header = [];
  const sections = [];
  let current = null;
  let body = [];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current !== null) sections.push({ title: current, body: body.join('\n') });
      current = m[1];
      body = [];
    } else if (current !== null) {
      body.push(line);
    } else {
      header.push(line);
    }
  }
  if (current !== null) sections.push({ title: current, body: body.join('\n') });
  return { header: header.join('\n'), sections };
}

function renderCore(parsed) {
  let text = parsed.header;
  for (const s of parsed.sections) {
    const body = s.body.replace(/^\n+/, '').replace(/\n+\s*$/, '');
    text += '\n## ' + s.title + '\n' + (body ? body + '\n' : '');
  }
  return text;
}

function makeId(title, existing) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '');
  const base = stamp + (slug ? '-' + slug : '');
  const taken = new Set(existing.map((n) => n.id));
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) { candidate = base + '-' + n; n++; }
  return candidate;
}

function noteFileText(meta, content) {
  const lines = [
    '---',
    'id: ' + meta.id,
    'title: ' + meta.title,
    'tags: ' + ((meta.tags || []).join(', ')),
    'created: ' + meta.created,
    'updated: ' + meta.updated,
    'status: ' + normStatus(meta.status),
    'source: ' + normSource(meta.source),
    'supersedes: ' + (meta.supersedes || ''),
    'superseded_by: ' + (meta.superseded_by || ''),
    'last_confirmed: ' + (meta.last_confirmed || ''),
    '---',
    '',
    content,
  ];
  return lines.join('\n') + '\n';
}

function scoreNote(note, query, bodyText) {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const title = (note.title || '').toLowerCase();
  const tagStr = (note.tags || []).join(' ').toLowerCase();
  const body = (bodyText || '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (title.indexOf(t) >= 0) score += 3;
    if (tagStr.indexOf(t) >= 0) score += 3;
    let hits = 0;
    let at = 0;
    while (hits < 50) {
      const i = body.indexOf(t, at);
      if (i < 0) break;
      score += 1;
      hits++;
      at = i + t.length;
    }
  }
  if (tokens.length > 1 && body.indexOf(q) >= 0) score += 2;
  return score;
}

function makeSnippet(bodyText, query) {
  const flat = String(bodyText).replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let at = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, 120) + (flat.length > 120 ? '…' : '');
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + 120);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

// prompt 组装对 {{variable}} 严格插值——注入前把字面 {{ 拆开，避免撞变量语法
function sanitize(text) { return String(text).split('{{').join('{ {') }

// ---------- fs 辅助 ----------
function readFileSyncOrNull(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

async function rebuildIndex() {
  const out = [];
  let entries = [];
  try { entries = await readdir(notesDir()); } catch { return out; }
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    try {
      const text = await readFile(join(notesDir(), name), 'utf8');
      const parsed = parseNoteFile(text);
      if (parsed.meta.deleted === 'true') continue; // 墓碑文件不复活
      const id = name.slice(0, -3);
      out.push({
        id,
        title: parsed.meta.title || id,
        tags: (parsed.meta.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
        created: parsed.meta.created || '',
        updated: parsed.meta.updated || parsed.meta.created || '',
        status: normStatus(parsed.meta.status),
        source: normSource(parsed.meta.source),
        supersedes: parsed.meta.supersedes || '',
        superseded_by: parsed.meta.superseded_by || '',
        last_confirmed: parsed.meta.last_confirmed || '',
        size: text.length,
      });
    } catch { /* 跳过无法解析的文件 */ }
  }
  return out.sort(noteSort);
}

async function loadIndex() {
  try {
    const raw = await readFile(indexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.notes)) {
      return parsed.notes.filter((n) => n && typeof n.id === 'string').sort(noteSort);
    }
  } catch { /* 缺失或损坏 → 从 notes/ 重建 */ }
  return rebuildIndex();
}

// 写串行化：同进程多 agent 并发写也按序落盘
let tail = Promise.resolve();
function enqueue(job) {
  const run = tail.then(job, job);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

function errText(e) { return '操作失败：' + (e && e.message ? e.message : String(e)); }

/** 写入审计：每次落盘记一行，用户可随时 `type memory\audit.jsonl` 看AI到底存了什么。 */
const auditPath = () => join(dshHome(), 'memory', 'audit.jsonl');
async function audit(line) {
  try {
    await mkdir(dirname(auditPath()), { recursive: true });
    await writeFile(auditPath(), JSON.stringify({ t: new Date().toISOString(), ...line }) + '\n', { flag: 'a', encoding: 'utf8' });
  } catch { /* 审计失败不影响正常写入 */ }
}

/** 读取并限制请求体大小（防误用），返回 UTF-8 文本。 */
function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体过大')); try { req.destroy(); } catch { /* 忽略 */ } return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 召回节（同步读，每次模型组装永远新鲜） ----------
function buildSectionText() {
  try {
    let core = '';
    const coreRaw = readFileSyncOrNull(corePath());
    if (coreRaw !== null) core = coreRaw.trim();
    let coreNote = '';
    if (core.length > 3000) {
      core = core.slice(0, 3000);
      coreNote = '\n（核心记忆过长已截断——请尽快用 memory_core 精简）';
    }
    let notes = [];
    const indexRaw = readFileSyncOrNull(indexPath());
    if (indexRaw) {
      try {
        const p = JSON.parse(indexRaw);
        if (p && Array.isArray(p.notes)) notes = p.notes.filter((n) => n && typeof n.id === 'string').sort(noteSort);
      } catch { /* 索引损坏时本节不列归档，工具侧会重建 */ }
    }
    const recent = notes.slice(0, 12).map((n) =>
      '- [' + n.id + '] ' + n.title + ((n.tags && n.tags.length) ? '  #' + n.tags.join(' #') : '') +
      (isRetired(n) ? '  〔' + statusLabel(n.status) + '〕' : '')
    ).join('\n');
    const persona = buildPersonaText();
    return [
      '# 跨会话记忆（AI · 本机）',
      '',
      '你在本机的所有会话共享以下持久记忆。核心记忆常驻注入；归档记忆仅列索引，用 memory_search / memory_read 按需取用。',
      '',
      '## 核心记忆（MEMORY.md）',
      sanitize(core) || '（空）',
      coreNote,
      ...(persona ? ['', '## 回复风格（用户设置）', sanitize(persona)] : []),
      '',
      '## 最近归档记忆（新→旧，最多 12 条）',
      recent || '（暂无归档记忆）',
      '',
      '## 使用政策（AI改过 · 与她的约定一致）',
      '- 这个库只装「机器、环境、项目、工具、做法」这类事实。它是工具箱，不是人像。',
      '- 不写关于「人」的判断：身份、偏好画像、情绪、健康、关系、私人生活，以及未经明确同意的对话转述。这类内容属于用户自己的日记，不属于这里。',
      '- 用户说「记住这个」时，先判断属于哪一类：属于人的那一类，就回一句「这条我不存，你要是想留，写进 workspace 的日记里」，不要落盘。',
      '- 不要为了「以后可能有用」而主动囤积。没有明确事实、没有明确要求，就不写。',
      '- 保存的内容必须自包含：未来会话看不到当前对话，要写清楚背景。',
      '- 不要保存：一次性细节、敏感信息（密码/凭据/token）、能从代码或文件轻易恢复的信息。',
      '- 需要回忆细节时主动 memory_search；需要浏览时 memory_list。',
      '- **每条记忆都带四个字段**：status（candidate 候选 / active 生效 / superseded 已被取代 / invalidated 已作废）、source（user_statement 她说的 / direct_observation 观察到的 / agent_inference 我推断的 / external_source 外部来源）、supersedes（这条取代了哪条）、last_confirmed（最近一次被证据确认的日期）。',
      '- **推断不是事实**：我自己的推断写进记忆时 source 要写 agent_inference，别写成她说的。memory_search 默认不返回作废/被取代的条目，要看得传 include_retired。',
      '- 推翻一条旧记忆的正确做法：新写一条并把 supersedes 填上旧 id（旧条目会自动标 superseded），不要偷偷改旧条目正文。',
      '- 回复风格用 persona 工具，不写进 MEMORY.md。',
      '- 每次写入都会记一行到 memory/audit.jsonl，用户随时可查。',
    ].join('\n');
  } catch {
    return '（跨会话记忆：暂不可用）';
  }
}

// ---------- 六个记忆工具 ----------
const outputText = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };

const toolDefs = [
  {
    name: 'memory_write',
    description: '保存一条归档记忆（episodic note），跨所有会话持久。适用：环境事实、项目决策与约定、工具与路径、可复现的做法。内容要自包含（未来会话看不到当前对话）。**不适用于关于用户的判断、偏好画像、私人内容**——那类东西属于用户自己的日记。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '简短标题（用于生成文件名与检索）' },
        content: { type: 'string', description: '记忆正文，自包含，可多行 Markdown' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签数组，便于检索' },
        status: { type: 'string', enum: STATUSES, description: '可选：candidate 候选 / active 生效（默认）。拿不准就写 candidate，等有第二条证据再转正' },
        source: { type: 'string', enum: SOURCES, description: '可选：这条是我亲眼量的（direct_observation）/ 她明说的（user_statement）/ 我推的（agent_inference）/ 外部资料（external_source）' },
        supersedes: { type: 'string', description: '可选：这条取代哪条记忆的 id（旧条目会被标成 superseded，并记下 superseded_by）' },
      },
      required: ['title', 'content'],
    },
    output: outputText,
    async execute(args) {
      const title = typeof args.title === 'string' ? args.title.replace(/\s+/g, ' ').trim() : '';
      const content = typeof args.content === 'string' ? args.content : '';
      if (!title || !content.trim()) return '保存失败：title 和 content 均不能为空。';
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [];
      const status = normStatus(args.status, 'active');
      const source = normSource(args.source, 'unknown');
      const supersedesRef = typeof args.supersedes === 'string' ? args.supersedes.trim().replace(/\.md$/, '') : '';
      try {
        return await enqueue(async () => {
          const existing = await loadIndex();
          let superseded = null;
          let target = null;
          if (supersedesRef) {
            const exact = existing.filter((n) => n.id === supersedesRef);
            const candidates = exact.length > 0 ? exact : existing.filter((n) => n.id.indexOf(supersedesRef) === 0);
            if (candidates.length === 0) return '保存失败：supersedes 指定的记忆「' + supersedesRef + '」不存在。';
            if (candidates.length > 1) return '保存失败：supersedes 有歧义，候选：\n' + candidates.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
            target = candidates[0];
          }
          const id = makeId(title, existing);
          const now = new Date().toISOString();
          const meta = {
            id, title, tags, created: now, updated: now, size: 0,
            status, source, supersedes: target ? target.id : '',
            last_confirmed: status === 'active' ? now : '',
          };
          const fileText = noteFileText(meta, content);
          meta.size = fileText.length;
          await atomicWrite(join(notesDir(), id + '.md'), fileText);
          let notes = [meta, ...existing.filter((n) => n.id !== id)].sort(noteSort);
          // 被取代的那条：改状态、记下 superseded_by，正文一个字不动
          if (target) {
            try {
              const oldText = await readFile(join(notesDir(), target.id + '.md'), 'utf8');
              const oldParsed = parseNoteFile(oldText);
              const oldMeta = {
                ...target,
                status: 'superseded',
                superseded_by: id,
                updated: now,
                tags: target.tags || [],
              };
              await atomicWrite(join(notesDir(), target.id + '.md'), noteFileText(oldMeta, oldParsed.body.replace(/\n+$/, '')));
              notes = notes.map((n) => (n.id === target.id ? { ...n, status: 'superseded', superseded_by: id, updated: now } : n)).sort(noteSort);
              superseded = target.id;
            } catch { /* 旧条目改写失败不影响新条目 */ }
          }
          await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes }, null, 2));
          await audit({ tool: 'memory_write', id, title, tags, chars: fileText.length, status, source, supersedes: superseded || '' });
          return '已保存归档记忆 [' + id + '] ' + title + (tags.length ? ' #' + tags.join(' #') : '') +
            '（' + statusLabel(status) + ' · ' + sourceLabel(source) + '）' +
            (superseded ? '，并把 [' + superseded + '] 标成已被取代' : '') + '。已进入索引，所有会话可见。';
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_core',
    description: '编辑核心记忆 MEMORY.md——它在每个会话的系统提示里常驻注入，务必保持精炼。action=append 在指定分节末尾追加要点；action=replace 用 text 整体替换指定分节；action=remove 删除指定分节。适合：环境事实、项目约定这类「每次都记得」的长期事实。**不要写用户画像。**',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['append', 'replace', 'remove'], description: 'append=追加到分节末尾；replace=整体替换分节；remove=删除分节' },
        section: { type: 'string', description: '分节名（MEMORY.md 里的 ## 标题），如：环境 / 项目' },
        text: { type: 'string', description: '要写入的内容（append/replace 时必填）' },
      },
      required: ['action', 'section'],
    },
    output: outputText,
    async execute(args) {
      const action = args.action;
      if (action !== 'append' && action !== 'replace' && action !== 'remove') {
        return '编辑失败：action 必须是 append / replace / remove。';
      }
      const section = typeof args.section === 'string' ? args.section.trim() : '';
      const text = typeof args.text === 'string' ? args.text : '';
      if (!section) return '编辑失败：section 不能为空。';
      if ((action === 'append' || action === 'replace') && !text.trim()) return '编辑失败：append/replace 需要提供 text。';
      try {
        return await enqueue(async () => {
          let raw = null;
          try { raw = await readFile(corePath(), 'utf8'); } catch { /* 不存在 → 用模板 */ }
          const parsed = parseCoreSections(raw !== null ? raw : TEMPLATE);
          const target = parsed.sections.find((s) => s.title.toLowerCase() === section.toLowerCase());
          const titles = parsed.sections.map((s) => s.title).join('、') || '（无）';
          if (action === 'remove') {
            if (!target) return '删除失败：找不到分节「' + section + '」。现有分节：' + titles;
            parsed.sections = parsed.sections.filter((s) => s !== target);
          } else if (action === 'append') {
            if (target) target.body = (target.body.replace(/\s+$/, '') ? target.body.replace(/\s+$/, '') + '\n' : '') + text;
            else parsed.sections.push({ title: section, body: text });
          } else {
            if (!target) return '替换失败：找不到分节「' + section + '」。现有分节：' + titles;
            target.body = text;
          }
          const next = renderCore(parsed);
          // 2026-10-31（AI，照架构评审 4.3）：**写超了要拒绝，不要先落盘再截断。**
          //   注入那段是 `core.slice(0, 3000)`（UTF-16 code unit），所以这里用同一个口径量：
          //   next.length。超了就返回结构化错误、保留旧文件，绝不写一个「尾巴会被切掉一半」的版本。
          //   2026-10-30 踩过：体检脚本按"去空白的可见字"量出 2929，真身 3018，末条被切半句。
          const LIMIT = 3000;
          const measured = next.length;
          if (measured > LIMIT) {
            return JSON.stringify({
              ok: false,
              code: 'CORE_BUDGET_EXCEEDED',
              measured,
              limit: LIMIT,
              unit: 'utf16_units',
              old_version_preserved: true,
              next_action: '先把要挪走的事实写成归档记忆（memory_write），再压缩这一节后重试；也可以 replace 整节而不是 append。',
            });
          }
          await atomicWrite(corePath(), next);
          await audit({ tool: 'memory_core', action, section, chars: text.length, coreBytes: next.length });
          const verb = action === 'append' ? '追加' : (action === 'replace' ? '替换' : '删除');
          // 90% 预警（建议阈值，可调）：还没超，但下一笔就会碰到墙。
          const warn = measured > LIMIT * 0.9
            ? '（预警：核心记忆 ' + measured + ' / ' + LIMIT + ' 字，已过 90%，下一笔很可能被拒——先归档再压。）'
            : (next.length > 6000 ? '（警告：核心记忆已超 6KB…）' : '');
          return '已' + verb + '核心记忆分节「' + section + '」。当前核心记忆 ' + measured + ' 字（上限 ' + LIMIT + '）。' + warn;
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_search',
    description: '按关键词检索归档记忆（标题/标签/正文），返回相关度排序的摘要。需要回忆过往会话保存的细节时主动使用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索关键词，可多个（空格分隔）' },
        limit: { type: 'integer', description: '最多返回条数，默认 8' },
        include_retired: { type: 'boolean', description: '默认 false：不返回已被取代/已作废的记忆。true 时连它们一起搜（挂着〔〕标记）' },
      },
      required: ['query'],
    },
    output: outputText,
    async execute(args) {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) return '搜索失败：query 不能为空。';
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 30) : 8;
      const withRetired = args.include_retired === true;
      try {
        const all = await loadIndex();
        const notes = withRetired ? all : all.filter((n) => !isRetired(n));
        const hidden = all.length - notes.length;
        const scored = [];
        for (const note of notes) {
          let bodyText = '';
          try {
            const t = await readFile(join(notesDir(), note.id + '.md'), 'utf8');
            bodyText = parseNoteFile(t).body;
          } catch { bodyText = ''; }
          const score = scoreNote(note, query, bodyText);
          if (score > 0) scored.push({ note, score, bodyText });
        }
        scored.sort((a, b) => b.score - a.score);
        if (scored.length === 0) {
          return '没有匹配「' + query + '」的记忆。可尝试其他关键词，或用 memory_list 浏览全部。' +
            (hidden > 0 && !withRetired ? '\n（另有 ' + hidden + ' 条已作废/被取代的没搜；要看加 include_retired）' : '');
        }
        const lines = scored.slice(0, limit).map((hit) =>
          '[' + hit.note.id + '] ' + hit.note.title + '（' + (hit.note.created || '').slice(0, 10) + '，' + statusLabel(hit.note.status) + ' · ' + sourceLabel(hit.note.source) + '）\n  ' + makeSnippet(hit.bodyText, query)
        );
        return '找到 ' + scored.length + ' 条匹配（显示前 ' + Math.min(limit, scored.length) + ' 条，按相关度排序）：\n\n' + lines.join('\n\n');
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_read',
    description: '按 id 读取一条归档记忆的完整内容。id 来自 memory_list / memory_search 的结果（或注入索引里的 [id]）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '记忆 id（可带 .md 后缀；支持唯一前缀匹配）' },
      },
      required: ['id'],
    },
    output: outputText,
    async execute(args) {
      const ref = typeof args.id === 'string' ? args.id.trim() : '';
      if (!ref) return '读取失败：id 不能为空。可用 memory_list 获取 id。';
      try {
        const notes = await loadIndex();
        const clean = ref.replace(/\.md$/, '');
        let matches = notes.filter((n) => n.id === clean);
        if (matches.length === 0) matches = notes.filter((n) => n.id.indexOf(clean) === 0);
        if (matches.length === 0) return '未找到记忆「' + ref + '」。可用 memory_list 浏览全部 ' + notes.length + ' 条归档记忆。';
        if (matches.length > 1) return 'id 有歧义，候选：\n' + matches.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
        const note = matches[0];
        let text = '';
        try {
          text = await readFile(join(notesDir(), note.id + '.md'), 'utf8');
        } catch (e) {
          return '记忆 [' + note.id + '] 在索引中存在但文件读取失败：' + errText(e);
        }
        const parsed = parseNoteFile(text);
        const metaLine = '状态：' + statusLabel(note.status) + (note.superseded_by ? '（被 [' + note.superseded_by + '] 取代）' : '') +
          ' · 来源：' + sourceLabel(note.source) +
          (note.last_confirmed ? ' · 最近确认：' + String(note.last_confirmed).slice(0, 10) : ' · 未记录确认时间');
        const warn = isRetired(note) ? '\n⚠ 这条已' + statusLabel(note.status) + '，不能当现行事实用。' : '';
        let out = '[' + note.id + '] ' + note.title + '\n' + metaLine + '\n创建：' + note.created +
          ((note.tags && note.tags.length) ? '\n标签：' + note.tags.join(', ') : '') +
          (note.supersedes ? '\n取代了：[' + note.supersedes + ']' : '') + warn +
          '\n\n' + parsed.body;
        if (out.length > 8000) out = out.slice(0, 8000) + '\n…（内容过长已截断）';
        return out;
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_list',
    description: '列出归档记忆（新→旧），可按标签过滤。用于浏览记忆库全貌。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: '最多返回条数，默认 15' },
        tag: { type: 'string', description: '可选：只列带此标签的记忆' },
        include_retired: { type: 'boolean', description: '默认 true：浏览时把作废/被取代的也列出来（挂〔〕标记）。false 只看现行的' },
      },
      required: [],
    },
    output: outputText,
    async execute(args) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 100) : 15;
      const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
      const hideRetired = args.include_retired === false;
      try {
        let notes = await loadIndex();
        if (hideRetired) notes = notes.filter((n) => !isRetired(n));
        if (tag) notes = notes.filter((n) => (n.tags || []).some((t) => String(t).toLowerCase() === tag));
        if (notes.length === 0) return tag ? '没有带标签 #' + tag + ' 的记忆。' : '暂无归档记忆。';
        const lines = notes.slice(0, limit).map((n) =>
          '- [' + n.id + '] ' + n.title + ((n.tags && n.tags.length) ? '  #' + n.tags.join(' #') : '') + '（' + (n.created || '').slice(0, 10) + '，' +
          statusLabel(n.status) + ' · ' + sourceLabel(n.source) + '）'
        );
        return '归档记忆共 ' + notes.length + ' 条（显示前 ' + Math.min(limit, notes.length) + ' 条，新→旧）：\n' + lines.join('\n');
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_delete',
    description: '删除一条归档记忆：从索引移除并把文件改写为墓碑占位。用于清理过时或错误的记忆。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '要删除的记忆 id' },
      },
      required: ['id'],
    },
    output: outputText,
    async execute(args) {
      const ref = typeof args.id === 'string' ? args.id.trim() : '';
      if (!ref) return '删除失败：id 不能为空。';
      try {
        return await enqueue(async () => {
          const notes = await loadIndex();
          const clean = ref.replace(/\.md$/, '');
          // 精确全等优先（2026-10-25 AI修）：id 全等时它唯一，不该因为「它同时也是别人的前缀」被判歧义
          const exact = notes.filter((n) => n.id === clean);
          const matches = exact.length > 0 ? exact : notes.filter((n) => n.id.indexOf(clean) === 0);
          if (matches.length === 0) return '删除失败：未找到「' + ref + '」。可用 memory_list 浏览全部。';
          if (matches.length > 1) return 'id 有歧义，请精确指定：\n' + matches.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
          const note = matches[0];
          const next = notes.filter((n) => n.id !== note.id);
          await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes: next }, null, 2));
          try {
            await atomicWrite(join(notesDir(), note.id + '.md'), '---\ndeleted: true\nid: ' + note.id + '\n---\n\n（此记忆已删除）\n');
          } catch { /* 索引已移除，墓碑写失败不影响结果 */ }
          return '已删除记忆 [' + note.id + '] ' + note.title + '。';
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'persona',
    description: '读取或设置 AI 的回复风格（与 MEMORY.md 并列的持久偏好，注入每个会话的系统提示）。action=get 查看当前风格与全部预设；action=set 切换到某个预设；action=custom 写入自定义风格文本；action=disable 停用风格注入。仅在用户明确要求改变回复风格、或表达长期语气偏好时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'custom', 'disable'], description: 'get=查看；set=切预设；custom=写自定义；disable=停用' },
        preset: { type: 'string', description: 'action=set 时的预设 id，如 warm / concise / rigorous / humorous / gentle / default' },
        text: { type: 'string', description: 'action=custom 时的风格正文（建议 200 字内，上限 ' + MAX_CUSTOM_TEXT + ' 字符）' },
      },
      required: ['action'],
    },
    output: outputText,
    async execute(args) {
      const action = args.action;
      try {
        if (action === 'get') {
          const state = readPersona();
          const current = state.enabled
            ? (state.preset === 'custom' ? '自定义' : ((PRESETS.find((p) => p.id === state.preset) || {}).name || state.preset))
            : '（已停用）';
          return '当前回复风格：' + current +
            (state.enabled && state.preset === 'custom' && state.custom ? '（正文 ' + state.custom.length + ' 字符）' : '') +
            '\n生效文本：' + (buildPersonaText() || '（默认：不注入风格指令）') +
            '\n\n可选预设：\n' + PRESETS.map((p) => '- ' + p.id + '（' + p.name + '）：' + p.summary).join('\n') +
            '\n\n提示：改动将在下一次模型组装时生效。';
        }

        if (action === 'disable') {
          return await enqueue(async () => {
            const cur = readPersona();
            await atomicWrite(personaPath(), renderPersonaFile({ enabled: false, preset: cur.preset, custom: cur.custom }));
            return '已停用回复风格注入（预设选择「' + cur.preset + '」已保留，重新启用即可恢复）。';
          });
        }

        if (action !== 'set' && action !== 'custom') {
          return '设置失败：action 必须是 get / set / custom / disable。';
        }

        const patch = { enabled: true, preset: action === 'custom' ? 'custom' : (typeof args.preset === 'string' ? args.preset.trim() : '') };
        if (action === 'set' && !patch.preset) {
          return '设置失败：action=set 需要提供 preset。可用：' + PRESETS.map((p) => p.id).join(' / ');
        }
        if (action === 'custom') patch.custom = typeof args.text === 'string' ? args.text : '';

        return await enqueue(async () => {
          const cur = readPersona();
          const incoming = { enabled: true, preset: patch.preset, custom: patch.custom !== undefined ? patch.custom : cur.custom };
          const check = normalizePersonaInput(incoming, cur);
          if (!check.ok) return '设置失败：' + check.error;
          await atomicWrite(personaPath(), renderPersonaFile(check.value));
          const preset = PRESETS.find((p) => p.id === check.value.preset);
          return '已切换回复风格为「' + (preset ? preset.name : check.value.preset) + '」。已在后续模型组装中生效。';
        });
      } catch (e) { return errText(e); }
    },
  },
];

export function apply(ctx) {
  // 引导创建（不阻塞激活；失败仅告警）
  enqueue(async () => {
    await mkdir(notesDir(), { recursive: true });
    if (readFileSyncOrNull(corePath()) === null) await atomicWrite(corePath(), TEMPLATE);
    if (readFileSyncOrNull(indexPath()) === null) await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes: [] }, null, 2));
  }).catch((e) => console.error('dsh-core-memory: bootstrap failed', e));

  for (const def of toolDefs) {
    ctx.tools.register(def);
  }

  // 自动召回：常驻注入每个会话的每次模型组装（同步读取，永远最新）
  ctx.systemPrompt.section({
    name: 'ming-core-memory:recall',
    order: 60,
    text: () => buildSectionText(),
  });

  // 设置页读写接口：风格页（client.js）经同源 fetch 调用。
  // webServer 是可选依赖——缺席时插件照常工作，只是设置页不可用。
  ctx.inject(['webServer'], (c) => {
    c.effect(() => c.webServer.register({
      kind: 'exact',
      path: '/dsh-core-memory/persona',
      async handler(req, res) {
        const sendJson = (code, payload) => {
          try {
            const body = JSON.stringify(payload);
            res.statusCode = code;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(body);
          } catch { /* 响应已发出时忽略 */ }
        };
        try {
          if (req.method === 'POST') {
            const body = await readBody(req);
            const patch = JSON.parse(body || '{}');
            if (!patch || typeof patch !== 'object') throw new Error('请求体必须是对象');
            const result = await enqueue(async () => {
              const cur = readPersona();
              const check = normalizePersonaInput(patch, cur);
              if (!check.ok) return { ok: false, error: check.error };
              await atomicWrite(personaPath(), renderPersonaFile(check.value));
              return { ok: true, persona: readPersona() };
            });
            if (!result.ok) { sendJson(400, { error: result.error }); return; }
            sendJson(200, { persona: result.persona, presets: listPresets() });
            return;
          }
          sendJson(200, { persona: readPersona(), presets: listPresets(), maxCustom: MAX_CUSTOM_TEXT });
        } catch (error) {
          sendJson(400, { error: (error && error.message) ? error.message : String(error) });
        }
      },
    }), 'dsh-core-memory: persona settings route');
  });

  console.log('dsh-core-memory: 已激活，记忆库 ' + join(dshHome(), 'memory'));
}
