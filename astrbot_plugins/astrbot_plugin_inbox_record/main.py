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

2026-11-17（E-3）：升到 v2，加消息身份与处理状态。
  · `eventId` 取平台消息 ID（`message_obj.message_id`）；取不到才生成 uuid，并如实标 `idSource: "generated"`。
    —— 正文相同不代表同一条消息，所以绝不用文本哈希。
  · `normalHandling`：pending（收到，还没判定）→ claimed（普通回复接管了）→ handled（已经发出去）
    或 not_handled（明确不走普通回复）。只有 not_handled 才该进兴趣候选。
  · 状态变化**另写一条事件**（kind="outcome"，引用同一 eventId），不改已经追加的旧行。
  · 发送后钩子写 outcome：这是 E-3 要求的「发送端回执」，不能只证明 inbox 文件在变长。

旧字段一律保留：`ts` / `kind="message"` / `decision` / `frame`。
旧消费者（只读 decision.ok 的）行为不变。

写盘用行缓冲、单行不拆——兴趣唤醒按行读、按换行切，半行会被它跳过（它那边有注释）。
"""

from __future__ import annotations

import json
import os
import time
import uuid

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register

# 2026-11-17（E-1）：路径可配（和兴趣唤醒共用一个 MING_INBOX），默认仍是老位置。
INBOX = os.environ.get("MING_INBOX") or os.path.join(
    os.environ.get("USERPROFILE", os.path.expanduser("~")),
    ".dsh", "media", "onebot", "qq-inbox.jsonl",
)

VERSION = 2


def _message_id(event: AstrMessageEvent):
    """平台消息 ID；拿不到就生成一个并标明来源（不假装是平台 ID）。"""
    try:
        mid = getattr(getattr(event, "message_obj", None), "message_id", None)
        if mid not in (None, ""):
            return str(mid), "platform"
    except Exception:  # noqa: BLE001
        pass
    return "gen-" + uuid.uuid4().hex, "generated"


def _identity(event: AstrMessageEvent, event_id: str, id_source: str) -> dict:
    """一条事件的身份：**入站、claimed、handled 三处必须一模一样**。

    2026-11-17（核查 R04）：回执原来只写 eventId，而消费者按
    (platform, bot, 会话, eventId) 组 key —— 于是同一条消息变成两条：
    带正文那条一直 pending，回执那条自己 claimed。这里的字段就是那个 key 的全部来源。
    """
    try:
        gid = event.get_group_id()
    except Exception:  # noqa: BLE001
        gid = None
    try:
        bot = str(event.get_self_id() or "")
    except Exception:  # noqa: BLE001
        bot = ""
    try:
        sender = str(event.get_sender_id() or "")
    except Exception:  # noqa: BLE001
        sender = ""
    return {
        "eventId": event_id,
        "idSource": id_source,
        "platform": "qq",
        "botAccountId": bot,
        "conversation": {"kind": "group" if gid else "private", "id": str(gid or sender or "")},
        "senderId": sender,
    }


def _append(line: dict) -> None:
    parent = os.path.dirname(os.path.abspath(INBOX))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(INBOX, "a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


@register("astrbot_plugin_inbox_record", "溟", "把入站消息写进 qq-inbox.jsonl，供兴趣唤醒读取", "0.2.0")
class InboxRecord(Star):
    def __init__(self, context: Context, config: dict | None = None):
        super().__init__(context)
        self.config = config or {}
        self._warned = False
        # eventId -> 入站时间；发送后钩子要靠它找回同一条消息。
        self._seen: dict[str, str] = {}
        # 平台没给 message_id 时的兜底 id：同一个 event 对象在几个钩子里要拿到同一个，
        # 不然「调用模型前 / 发送后」两个回执各自 gen 一个，永远拼不回一条。
        self._gen_ids: dict[int, str] = {}
        logger.info("[inbox-record] v%d，写入 %s", VERSION, INBOX)

    def _ids(self, event: AstrMessageEvent):
        event_id, id_source = _message_id(event)
        if id_source == "generated":
            key = id(event)
            cached = self._gen_ids.get(key)
            if cached:
                event_id = cached
            else:
                self._gen_ids[key] = event_id
                if len(self._gen_ids) > 500:
                    for k in list(self._gen_ids)[: len(self._gen_ids) - 500]:
                        self._gen_ids.pop(k, None)
        return event_id, id_source

    def _warn(self, msg: str, exc: Exception) -> None:
        if not self._warned:
            logger.warning("[inbox-record] %s：%s", msg, exc)
            self._warned = True

    @filter.event_message_type(filter.EventMessageType.ALL)
    async def record(self, event: AstrMessageEvent):
        try:
            gid = event.get_group_id()
            event_id, id_source = self._ids(event)
            now = time.time()
            received_at = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now))
            line = {
                # —— v2 字段：身份只从 _identity 来，回执和入站用的是同一份 ——
                "version": VERSION,
                **_identity(event, event_id, id_source),
                "sourceKind": "user",
                "receivedAt": received_at,
                "normalHandling": "pending",
                "sessionId": None,
                # —— 旧字段（旧消费者只认这些）——
                "ts": int(now * 1000),
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
                    "message_id": event_id,
                    "sender": {
                        "card": str(event.get_sender_name() or ""),
                        "nickname": str(event.get_sender_name() or ""),
                    },
                    "message": [
                        {"type": "text", "data": {"text": event.message_str or ""}}
                    ],
                },
            }
            self._seen[event_id] = received_at
            if len(self._seen) > 500:
                # 只留最近的：发送后钩子通常几秒内就到，不需要长记忆。
                for k in list(self._seen)[: len(self._seen) - 500]:
                    self._seen.pop(k, None)
            _append(line)
        except Exception as e:  # noqa: BLE001
            self._warn("写入失败", e)

    @filter.on_decorating_result()
    async def mark_claimed(self, event: AstrMessageEvent):
        """要发东西了 → 标 claimed。

        2026-11-17：`after_message_sent` 在这套部署里一次都没触发过（重启后 90 秒内 0 次，
        期间 AstrBot 确实在群里回过话）。所以「发出去」那一步先认不下来；
        但「这条我要回了」可以在发送**前**拿到——这正是 E.4 要的「调模型前取得归属」的证据。
        钩子真触发时再补 handled，补不上就如实留 claimed。
        """
        try:
            event_id, id_source = self._ids(event)
            _append({
                "version": VERSION,
                "kind": "outcome",
                # 2026-11-17（核查 R04）：回执也要带 bot / 会话，否则消费者拼 key 拼不回
                **_identity(event, event_id, id_source),
                "normalHandling": "claimed",
                "outcome": {"stage": "decorating", "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())},
                "ts": int(time.time() * 1000),
            })
        except Exception as e:  # noqa: BLE001
            self._warn("claimed 写入失败", e)

    @filter.after_message_sent()
    async def record_outcome(self, event: AstrMessageEvent):
        """发送成功之后写一条回执。失败也写，状态写明 failed，不假装发成功。"""
        try:
            # 2026-11-17 实测：这个钩子在 AstrBot 里按 event.plugins_name 过滤，
            # 而本插件是纯旁观（不参与决策），所以**一次都不会触发**。留着是为了换部署时能自证，
            # 日志降到 debug，别刷。
            logger.debug("[inbox-record] after_message_sent 触发")
            event_id, id_source = self._ids(event)
            received_at = self._seen.get(event_id, "")
            line = {
                "version": VERSION,
                "kind": "outcome",
                **_identity(event, event_id, id_source),
                "normalHandling": "handled",
                "outcome": {
                    "stage": "sent",
                    "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
                    "receivedAt": received_at,
                    # 这一条只说明「AstrBot 自己把回复发出去了」；
                    # 平台侧真正确认（消息 ID 回执）不在这个钩子里，所以不编。
                    "detail": "after_message_sent",
                },
                "ts": int(time.time() * 1000),
            }
            _append(line)
        except Exception as e:  # noqa: BLE001
            self._warn("回执写入失败", e)
