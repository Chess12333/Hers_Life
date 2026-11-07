// 题库：12 道「我真会问」的问题，分三类。
// A 词面对得上   —— 问法里就有原文的词，BM25 该赢/平
// B 同义改写     —— 问法里避开原文关键词，暴露关键词检索的死穴（两边都可能挂）
// C 现行口径     —— 库里有旧的/被取代的条目，看谁分得清新旧
// expected 里可以有多个可接受答案（同一件事可能散在两条里）。

export const corpusNote = '语料 = 本机归档记忆（memory/index.json + notes/*.md），2026-11-03 快照。';

export const questions = [
  // ---------- A 词面对得上 ----------
  { id: 'A1', cls: 'A', q: 'web_search 报 401 怎么办', expected: ['20261103-050648-web-search-401-key-page-text-mjs', '20261102-074309-page-text-mjs-bypass'] },
  { id: 'A2', cls: 'A', q: 'snowluma 容器迁到 Docker Desktop 之后 CLI 在哪', expected: ['20261101-215212-snowluma-docker-desktop-2026-11'] },
  { id: 'A3', cls: 'A', q: '番茄下载器 Node 内置 WebSocket 没有 .on', expected: ['20261030-131759-node-websocket-on-2026-10-30'] },
  { id: 'A4', cls: 'A', q: 'sl-guard 被 skip 的批次 已读', expected: ['20261031-215754-sl-skip-2026-10-31'] },
  { id: 'A5', cls: 'A', q: 'QQ 收图归档 rkey 过期 url 回补', expected: ['20261101-144652-qq-url-2026-11-01'] },

  // ---------- B 同义改写（避开关键词） ----------
  { id: 'B1', cls: 'B', q: '怎么确认一条消息真的发出去了，不是只看接口没报错', expected: ['20261030-121122-onebot-data-messages-2026-10-30', '20261102-141755-qq-say-unknown-24'] },
  { id: 'B2', cls: 'B', q: '手机不插线能连电脑，断了怎么自己恢复', expected: ['20261031-210812-adb-ssh-5-2026-10-31', '20261031-185102-adb-2026-10-31-termux-ssh-r'] },
  { id: 'B3', cls: 'B', q: '那段话到底被塞进哪一半提示词里了', expected: ['20261031-133244-systemprompt-userprompt-2026-10'] },
  { id: 'B4', cls: 'B', q: '走本地反代之后 git 一直报证书错误', expected: ['20261031-232026-github-steam-302-git-schannel-op'] },
  { id: 'B5', cls: 'B', q: '同一件事记忆散成好几条把索引挤满了怎么办', expected: ['20261103-074054-memory-merge-2026-11-03'] },

  // ---------- C 现行口径 ----------
  { id: 'C1', cls: 'C', q: '记忆注入在 systemPrompt 还是 userPrompt，现在算哪个说法', expected: ['20261031-133244-systemprompt-userprompt-2026-10'] },
  { id: 'C2', cls: 'C', q: 'qq-send 说发了但对方没收到，现在的判据是什么', expected: ['20261102-141755-qq-say-unknown-24', '20261102-074309-unknown-sweep-mingoutboxsweep-re'] },
];

// C 类额外看的：输出里有没有把「旧的那条」标出来
export const staleIds = {
  C1: ['20261031-132607-2026-10-31-bug'],
  C2: ['20261101-224329-unknown-qq-say-message-id-2026-1'],
};
