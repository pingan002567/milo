"""SQLite 存储 schema。

设计借鉴 DeerFlow 的会话实现（RunEventRow / ThreadMetaRow）：
- **content（文本）与 metadata（结构化）分离**：群聊渲染直读 content，全文检索可建 FTS，
  结构化字段仍在 metadata 供决策卡使用。
- **category 与 type 两级分类**：UI 可按粗类过滤（只看消息 / 只看错误），无需枚举细类型。
- **run_id**：一次执行的边界。同一任务中断后 resume 属于新 run，可区分尝试次数、只回放最后一次。
- **群元数据独立成表**：标题/状态/时间不再从事件表 GROUP BY 推算。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
PRAGMA journal_mode=WAL;

-- 任务群元数据（对应 DeerFlow 的 ThreadMetaRow）
CREATE TABLE IF NOT EXISTS groups (
    group_id    TEXT PRIMARY KEY,
    title       TEXT,                      -- 显示名；缺省时 UI 回退到 group_id
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','waiting','review','accepted','archived','failed')),
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_updated ON groups(updated_at DESC);

-- 事件：append-only，任务群渲染/审计/回放同源
CREATE TABLE IF NOT EXISTS events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL UNIQUE,
    group_id   TEXT NOT NULL,
    task_id    TEXT,
    run_id     TEXT,                        -- 一次执行的边界（assign / resume 各开一个）
    type       TEXT NOT NULL CHECK (type IN
               ('envelope','status','escalation','delivery','acceptance','system','chat')),
    category   TEXT NOT NULL DEFAULT 'message' CHECK (category IN
               ('message','status','decision','outputs','error','trace')),
    actor      TEXT NOT NULL,
    ts         TEXT NOT NULL,
    reach      TEXT,
    content    TEXT NOT NULL DEFAULT '',    -- 人类可读文本（群聊直接渲染这一列）
    metadata   TEXT NOT NULL DEFAULT '{}'   -- 结构化负载（决策卡、artifact 引用等）
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE INDEX IF NOT EXISTS idx_events_group ON events(group_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_group_cat ON events(group_id, category, seq);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);

-- 待批准的计划：批准前的信封暂存。落盘而非内存——milod 重启不丢
-- （实测教训：内存暂存重启后群悬置成"僵尸待批"）
CREATE TABLE IF NOT EXISTS pending_plans (
    group_id   TEXT PRIMARY KEY,
    envelopes  TEXT NOT NULL,               -- TaskEnvelope JSON 数组
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id     TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL,
    parent_task TEXT,
    context_id  TEXT,
    member      TEXT,
    state       TEXT NOT NULL CHECK (state IN
                ('queued','assigned','working','input_required','delivered',
                 'accepted','rejected','failed','canceled')),
    run_id      TEXT,                       -- 当前 run
    attempts    INTEGER NOT NULL DEFAULT 0, -- 已执行次数（首派 + resume 累加）
    stop_reason TEXT,                       -- 中断原因（借鉴 RunRow.stop_reason）
    envelope    TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn
