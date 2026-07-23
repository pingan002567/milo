"""事件与任务的持久化。events 是 append-only——任务群渲染/审计/回放同源。"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from milod.models import EventType, MiloEvent, TaskEnvelope, TaskState
from milod.store.db import connect

#: type → category（粗分类，供 UI 过滤"只看消息/只看决策/只看错误"）
CATEGORY = {
    EventType.CHAT: "message",
    EventType.ENVELOPE: "message",
    EventType.STATUS: "status",
    EventType.ESCALATION: "decision",
    EventType.ACCEPTANCE: "decision",
    EventType.DELIVERY: "outputs",
    EventType.SYSTEM: "trace",
}

#: 各类事件用哪个字段作为人类可读文本（其余留在 metadata）
_TEXT_KEYS = ("text", "objective", "doing", "question", "summary", "verdict", "msg", "error")


def _split_payload(ev: MiloEvent) -> tuple[str, dict[str, Any]]:
    """把 payload 拆成 content（文本）+ metadata（结构化）——借鉴 DeerFlow RunEventRow。"""
    payload = dict(ev.payload)
    content = ""
    for k in _TEXT_KEYS:
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            content = v
            break
    if not content and ev.type == EventType.ESCALATION:
        content = str(payload.get("fallback_text") or "")
    category = "error" if payload.get("error") else CATEGORY.get(ev.type, "message")
    # 思考过程（token 级 trace 流）与汇报（结构化 report）在粗分类上分开：
    # 审计过滤"只看 trace"、秘书/工具"排除 trace"都靠它
    if ev.type == EventType.STATUS and payload.get("kind") == "trace":
        category = "trace"
    return content, {"category": category, **payload}


class Store:
    def __init__(self, path: Path) -> None:
        self._conn: sqlite3.Connection = connect(path)
        self._conn.row_factory = sqlite3.Row

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    # ---- events ---------------------------------------------------------
    def append(self, event: MiloEvent, *, run_id: str | None = None) -> int:
        """落库并回填 seq（单调序号，供客户端记录水位）。"""
        content, meta = _split_payload(event)
        category = meta.pop("category")
        event.content = content  # 回填，供 WS 实时帧直接使用（与补发帧同源）
        cur = self._conn.execute(
            "INSERT OR IGNORE INTO events"
            "(event_id,group_id,task_id,run_id,type,category,actor,ts,reach,content,metadata)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                event.event_id, event.group_id, event.task_id, run_id,
                event.type.value, category, event.actor, event.ts.isoformat(),
                event.effective_reach().value, content,
                json.dumps(meta, ensure_ascii=False, default=str),
            ),
        )
        self._touch_group(event.group_id)
        self._conn.commit()
        if cur.lastrowid:
            event.seq = cur.lastrowid
        else:  # OR IGNORE 命中（重复 event_id）：取已有行的 seq
            row = self._conn.execute(
                "SELECT seq FROM events WHERE event_id=?", (event.event_id,)
            ).fetchone()
            event.seq = int(row["seq"]) if row else None
        return event.seq or 0

    def group_events(
        self, group_id: str, *, category: str | None = None, run_id: str | None = None
    ) -> list[dict]:
        sql = "SELECT * FROM events WHERE group_id=?"
        args: list[Any] = [group_id]
        if category:
            sql += " AND category=?"
            args.append(category)
        if run_id:
            sql += " AND run_id=?"
            args.append(run_id)
        rows = self._conn.execute(sql + " ORDER BY seq", args).fetchall()
        return [
            dict(r) | {"metadata": json.loads(r["metadata"]),
                       "payload": json.loads(r["metadata"])}  # payload 保留兼容旧调用
            for r in rows
        ]

    def events_since(self, seq: int, *, limit: int = 500) -> list[dict]:
        """断线重连补发：取 seq 之后的全部事件（跨群，按序）。

        events 是 append-only 且 seq 单调递增——客户端只需记住最后收到的 seq，
        重连时带上即可无缝续上（对应 Gateway SSE 的 Last-Event-ID 语义）。
        """
        rows = self._conn.execute(
            "SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?", (seq, limit)
        ).fetchall()
        return [dict(r) | {"metadata": json.loads(r["metadata"]),
                           "payload": json.loads(r["metadata"])} for r in rows]

    def latest_seq(self) -> int:
        row = self._conn.execute("SELECT COALESCE(MAX(seq), 0) AS s FROM events").fetchone()
        return int(row["s"])

    # ---- groups ---------------------------------------------------------
    def ensure_group(self, group_id: str, *, title: str | None = None) -> None:
        now = self._now()
        self._conn.execute(
            "INSERT INTO groups(group_id,title,created_at,updated_at) VALUES(?,?,?,?)"
            " ON CONFLICT(group_id) DO UPDATE SET"
            " title=COALESCE(excluded.title, groups.title), updated_at=excluded.updated_at",
            (group_id, title, now, now),
        )
        self._conn.commit()

    def set_group_title(self, group_id: str, title: str) -> None:
        self._conn.execute(
            "UPDATE groups SET title=?, updated_at=? WHERE group_id=?",
            (title, self._now(), group_id),
        )
        self._conn.commit()

    def set_group_status(self, group_id: str, status: str) -> None:
        self._conn.execute(
            "UPDATE groups SET status=?, updated_at=? WHERE group_id=?",
            (status, self._now(), group_id),
        )
        self._conn.commit()

    # ---- 待确认（review 态）--------------------------------------------
    def enter_review(self, group_id: str) -> None:
        """转入待你确认。**不设自动归档倒计时**——验收是你的判断，
        系统不能替你决定；未确认的任务永远等着（验收与返工设计 §一修正）。"""
        meta = self._group_meta(group_id)
        meta["review_since"] = self._now()
        meta.pop("accepted_at", None)  # 返工后重新待确认：清掉上一轮的验收时间
        self._conn.execute(
            "UPDATE groups SET status='review', metadata=?, updated_at=? WHERE group_id=?",
            (json.dumps(meta, ensure_ascii=False), self._now(), group_id))
        self._conn.commit()

    def mark_accepted(self, group_id: str) -> None:
        """验收通过（≠归档）：任务留在视野里可继续用/继续提要求；
        自动归档倒计时从此刻起算。"""
        meta = self._group_meta(group_id)
        meta["accepted_at"] = self._now()
        self._conn.execute(
            "UPDATE groups SET status='accepted', metadata=?, updated_at=? WHERE group_id=?",
            (json.dumps(meta, ensure_ascii=False), self._now(), group_id))
        self._conn.commit()

    def accepted_at(self, group_id: str) -> str | None:
        return self._group_meta(group_id).get("accepted_at")

    def _group_meta(self, group_id: str) -> dict:
        row = self._conn.execute(
            "SELECT metadata FROM groups WHERE group_id=?", (group_id,)).fetchone()
        try:
            return json.loads(row[0]) if row and row[0] else {}
        except Exception:  # noqa: BLE001
            return {}

    def review_since(self, group_id: str) -> str | None:
        return self._group_meta(group_id).get("review_since")

    def due_archives(self, hours: float) -> list[str]:
        """**已验收**且超过保留时长的群 → 自动归档。

        只扫 accepted 态：未确认的群不在此列（不替用户做验收决定）。
        """
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        out = []
        for r in self._conn.execute(
                "SELECT group_id, metadata FROM groups WHERE status='accepted'").fetchall():
            try:
                at = json.loads(r[1] or "{}").get("accepted_at")
                if at and datetime.fromisoformat(at) <= cutoff:
                    out.append(r[0])
            except Exception:  # noqa: BLE001
                continue
        return out

    # ---- 待批计划（落盘，milod 重启不丢）--------------------------------
    def save_pending_plan(self, group_id: str, envelopes: list[TaskEnvelope]) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO pending_plans(group_id,envelopes,created_at)"
            " VALUES(?,?,?)",
            (group_id,
             json.dumps([e.model_dump(mode="json") for e in envelopes], ensure_ascii=False),
             self._now()),
        )
        self._conn.commit()

    def pending_plan(self, group_id: str) -> list[TaskEnvelope] | None:
        row = self._conn.execute(
            "SELECT envelopes FROM pending_plans WHERE group_id=?", (group_id,)
        ).fetchone()
        if not row:
            return None
        return [TaskEnvelope.model_validate(d) for d in json.loads(row[0])]

    def delete_pending_plan(self, group_id: str) -> None:
        self._conn.execute("DELETE FROM pending_plans WHERE group_id=?", (group_id,))
        self._conn.commit()

    # ---- 执行中计划的剩余步骤 -------------------------------------------
    def save_plan_progress(self, group_id: str, envelopes: list[TaskEnvelope]) -> None:
        """停在请示那一步时记下剩余步骤（含当前步）——答复后凭它续跑。"""
        self._conn.execute(
            "INSERT OR REPLACE INTO plan_progress(group_id,envelopes,created_at)"
            " VALUES(?,?,?)",
            (group_id,
             json.dumps([e.model_dump(mode="json") for e in envelopes], ensure_ascii=False),
             self._now()),
        )
        self._conn.commit()

    def plan_progress(self, group_id: str) -> list[TaskEnvelope] | None:
        row = self._conn.execute(
            "SELECT envelopes FROM plan_progress WHERE group_id=?", (group_id,)
        ).fetchone()
        if not row:
            return None
        return [TaskEnvelope.model_validate(d) for d in json.loads(row[0])]

    def delete_plan_progress(self, group_id: str) -> None:
        self._conn.execute("DELETE FROM plan_progress WHERE group_id=?", (group_id,))
        self._conn.commit()

    def _touch_group(self, group_id: str) -> None:
        now = self._now()
        self._conn.execute(
            "INSERT INTO groups(group_id,created_at,updated_at) VALUES(?,?,?)"
            " ON CONFLICT(group_id) DO UPDATE SET updated_at=excluded.updated_at",
            (group_id, now, now),
        )

    def groups(self) -> list[dict]:
        """左边栏列表：标题/状态/待决数/事件数，一次查询搞定（不再 GROUP BY 推算）。"""
        rows = self._conn.execute(
            "SELECT g.group_id, g.title, g.status, g.created_at, g.updated_at,"
            " (SELECT COUNT(*) FROM events e WHERE e.group_id=g.group_id) AS events,"
            " (SELECT COUNT(*) FROM tasks t WHERE t.group_id=g.group_id"
            "   AND t.state='input_required') AS pending"
            " FROM groups g ORDER BY g.updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    # ---- tasks ----------------------------------------------------------
    def upsert_task(
        self, env: TaskEnvelope, *, group_id: str, member: str | None, state: TaskState,
        run_id: str | None = None,
    ) -> None:
        self._conn.execute(
            "INSERT INTO tasks(task_id,group_id,parent_task,context_id,member,state,run_id,"
            "attempts,envelope,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)"
            " ON CONFLICT(task_id) DO UPDATE SET state=excluded.state, member=excluded.member,"
            " run_id=excluded.run_id, attempts=tasks.attempts+1, updated_at=excluded.updated_at",
            (
                env.task_id, group_id, env.parent_task, env.context_id, member, state.value,
                run_id, env.model_dump_json(), self._now(),
            ),
        )
        self._touch_group(group_id)
        self._conn.commit()

    def set_state(self, task_id: str, state: TaskState, *, run_id: str | None = None) -> None:
        if run_id:
            self._conn.execute(
                "UPDATE tasks SET state=?, run_id=?, attempts=attempts+1, updated_at=?"
                " WHERE task_id=?", (state.value, run_id, self._now(), task_id))
        else:
            self._conn.execute(
                "UPDATE tasks SET state=?, updated_at=? WHERE task_id=?",
                (state.value, self._now(), task_id))
        self._conn.commit()

    def set_stop_reason(self, task_id: str, reason: str) -> None:
        self._conn.execute(
            "UPDATE tasks SET stop_reason=?, updated_at=? WHERE task_id=?",
            (reason, self._now(), task_id),
        )
        self._conn.commit()

    def orphan_tasks(self) -> list[dict]:
        """进程重启后仍标记为运行中的任务——上次运行崩溃/被强退留下的孤儿。

        成员侧的 checkpointer 已保住上下文，只需重新连上并接续（编制设计 §断点续跑）。
        """
        rows = self._conn.execute(
            "SELECT * FROM tasks WHERE state IN ('assigned','working') ORDER BY updated_at"
        ).fetchall()
        return [dict(r) for r in rows]

    def task(self, task_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return dict(row) if row else None

    def task_activity(self, task_id: str) -> int:
        """该任务最后一条事件的 seq —— 成员的"脉搏"。

        等待任务落定不能只看墙上时钟：一个还在稳定输出 trace/report 的成员
        是活着的，凭绝对时长腰斩它等于惩罚长任务；反过来久无事件才是真卡死。
        """
        row = self._conn.execute(
            "SELECT COALESCE(MAX(seq), 0) AS s FROM events WHERE task_id=?", (task_id,)
        ).fetchone()
        return int(row["s"])

    def tasks(self, group_id: str | None = None) -> list[dict]:
        sql = "SELECT * FROM tasks"
        args: tuple = ()
        if group_id:
            sql += " WHERE group_id=?"
            args = (group_id,)
        return [dict(r) for r in self._conn.execute(sql + " ORDER BY updated_at", args)]
