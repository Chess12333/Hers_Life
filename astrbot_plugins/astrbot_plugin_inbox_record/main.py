"""astrbot_plugin_inbox_record —— 把 AstrBot 收到的每条消息追加进 qq-inbox.jsonl

2026-11-11 立。原因：QQ 从 QQ-Agent 换到 AstrBot 之后，
`~/.dsh/media/onebot/qq-inbox.jsonl` 在 13:06 就停了（那是旧 onebot 插件写的）。
而 `dsh-ming-interest`（兴趣唤醒）还在读这个文件——于是它读不到任何新消息，等于瞎了。

这个插件只做一件事：按旧格式把入站消息写回去，让兴趣唤醒不用改代码就能继续工作。

格式（跟旧 onebot 插件一致，字段只保留兴趣唤醒真正用到的）：
  {"ts": 毫秒, "kind": "message", "decision": {...}, "frame": {
      "message_type": "group"|"private",
      "group_id": "...", "user_id": "...", "self_id": "...",
      "sender": {"card": "...", "nickname": "..."},
      "message": [{"type": "text", "data": {"text": "..."}}]
  }}

写盘用行缓冲、单行不拆——兴趣唤醒按行读、按换行切，半行会被它跳过（它那边有注释）。
"""

from __future__ import annotations

import json
import os
import time

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register

INBOX = os.path.join(
    os.environ.get("USERPROFILE", r"C:\Users\13588"),
    ".dsh", "media", "onebot", "qq-inbox.jsonl",
)


@register("astrbot_plugin_inbox_record", "溟", "把入站消息写进 qq-inbox.jsonl，供兴趣唤醒读取", "0.1.0")
class InboxRecord(Star):
    def __init__(self, context: Context, config: dict | None = None):
        super().__init__(context)
        self.config = config or {}
        self._warned = False

    @filter.event_message_type(filter.EventMessageType.ALL)
    async def record(self, event: AstrMessageEvent):
        try:
            gid = event.get_group_id()
            line = {
                "ts": int(time.time() * 1000),
                "kind": "message",
                "decision": {
                    "ok": False,
                    "stage": "inbound",
                    "reason": "兴趣观察：这条进了消息库，没有当作要回复的消息",
                },
                "source": "astrbot",
                "frame": {
                    "message_type": "group" if gid else "private",
                    "group_id": str(gid or ""),
                    "user_id": str(event.get_sender_id() or ""),
                    "self_id": str(event.get_self_id() or ""),
                    "sender": {
                        "card": str(event.get_sender_name() or ""),
                        "nickname": str(event.get_sender_name() or ""),
                    },
                    "message": [
                        {"type": "text", "data": {"text": event.message_str or ""}}
                    ],
                },
            }
            with open(INBOX, "a", encoding="utf-8") as f:
                f.write(json.dumps(line, ensure_ascii=False) + "\n")
        except Exception as e:  # noqa: BLE001
            if not self._warned:
                logger.warning("[inbox-record] 写入失败（只提示一次）：%s", e)
                self._warned = True
