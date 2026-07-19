import { useEffect, useMemo, useRef, useState } from "react";
import { api, type EscalationPayload, type MiloEvent, type PlanStep, type TaskRow } from "../lib/api";
import { Md } from "./Md";

const AVATAR: Record<string, string> = { owner: "你", secretariat: "秘", system: "系" };
const ACTOR_ZH: Record<string, string> = { owner: "你", secretariat: "秘书", system: "系统" };
const who = (a: string) => ACTOR_ZH[a] ?? a;

const STATE_ZH: Record<string, string> = {
  queued: "排队", assigned: "已派单", working: "工作中", input_required: "等你拍板",
  delivered: "已交付", accepted: "已验收", rejected: "已退回", failed: "失败", canceled: "已取消",
};
const GROUP_ZH: Record<string, [string, string]> = {
  active: ["进行中", "ok"], waiting: ["待你拍板", "warn"],
  archived: ["已归档", ""], failed: ["失败", "crit"],
};

/** content 缺失时的兜底：挑出可读字段，绝不把原始 JSON 甩给用户。 */
function readable(payload: Record<string, any>): string {
  for (const k of ["text", "objective", "doing", "question", "summary", "verdict", "msg", "error"]) {
    const v = payload?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "（无文本内容）";
}

const TAG: Partial<Record<string, { text: string; up?: boolean }>> = {
  envelope: { text: "派单" },
  status: { text: "汇报" },
  trace: { text: "思考过程" },
  escalation: { text: "请示", up: true },
  delivery: { text: "交付" },
  acceptance: { text: "验收" },
};

/* ---------- 事件流预处理：分节 + 连续汇报合并 ---------- */

type Item =
  | { kind: "section"; key: string; n: number; member: string; objective: string; taskId: string }
  | { kind: "status-run"; key: string; actor: string; runId: string | null; text: string; count: number; last: boolean }
  | { kind: "event"; key: string; e: MiloEvent };

function buildItems(events: MiloEvent[]): Item[] {
  const items: Item[] = [];
  let stepNo = 0;
  const seenSteps = new Set<string>();

  for (const e of events) {
    // 步骤分节：派单信封即步骤起点
    if (e.type === "envelope" && e.task_id && !seenSteps.has(e.task_id)) {
      seenSteps.add(e.task_id);
      stepNo += 1;
      items.push({
        kind: "section", key: `sec-${e.task_id}`, n: stepNo,
        member: String(e.payload?.member ?? ""),
        objective: String(e.payload?.objective ?? ""), taskId: e.task_id,
      });
    }
    if (e.type === "status") {
      // 汇报（结构化 report，如工具调用）独立成行；思考过程（trace/旧数据）合并成块
      if (e.payload?.kind === "report") {
        items.push({ kind: "event", key: e.event_id, e });
        continue;
      }
      const prev = items[items.length - 1];
      const text = e.content || String(e.payload?.doing ?? "");
      if (prev && prev.kind === "status-run" && prev.actor === e.actor
          && prev.runId === (e.run_id ?? null)) {
        prev.text += text;
        prev.count += 1;
        continue;
      }
      items.push({
        kind: "status-run", key: `st-${e.event_id}`, actor: e.actor,
        runId: e.run_id ?? null, text, count: 1, last: false,
      });
      continue;
    }
    items.push({ kind: "event", key: e.event_id, e });
  }
  // 标记最后一个汇报块（进行中的群默认展开它，给"正在干活"的实感）
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "status-run") { it.last = true; break; }
  }
  return items;
}

/* ---------- 合并汇报块 ---------- */

function StatusRun({ item, live, mode }: { item: Extract<Item, { kind: "status-run" }>; live: boolean; mode: Mode }) {
  // 关键节点模式默认折叠；全部模式默认展开；进行中的最新块始终展开
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (live || mode === "all");
  return (
    <div className="msg">
      <span className="ava">{AVATAR[item.actor] ?? item.actor.slice(0, 1).toUpperCase()}</span>
      <div className="mb">
        <div className="mh">
          {who(item.actor)}
          <span className="tag">思考过程</span>
          {item.runId && <span className="muted"> · run {item.runId.slice(-4)}</span>}
          <button className="stoggle" onClick={() => setOpen(!expanded)}>
            {expanded ? "收起" : `展开（${item.text.length} 字）`}
          </button>
        </div>
        {expanded ? (
          <div className="mx"><Md text={item.text} /></div>
        ) : (
          <div className="mx dim" onClick={() => setOpen(true)}>
            {live ? "⋯ 思考中" : "思考过程（审计可查）"} · 已输出 {item.text.length} 字 · 点击展开
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- 产物卡 ---------- */

function ArtifactCard({ org, taskId, name }: { org: string; taskId: string; name: string }) {
  const [preview, setPreview] = useState<{ content: string; size: number; truncated: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!preview) {
      try {
        setPreview(await api.artifact(org, taskId, name));
      } catch (e: any) {
        setErr(String(e?.message ?? e).slice(0, 80));
      }
    }
  };

  return (
    <div className="artifact">
      <div className="arthead">
        <span className="articon">📄</span>
        <span className="artname mono">{name}</span>
        {preview && <span className="muted">{(preview.size / 1024).toFixed(1)} KB</span>}
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={toggle}>
          {open ? "收起" : "预览"}
        </button>
      </div>
      {open && (
        err ? <div className="muted" style={{ padding: "6px 10px" }}>读取失败：{err}</div>
        : !preview ? <div className="muted" style={{ padding: "6px 10px" }}>加载中…</div>
        : (
          <pre className="artpre">{preview.content}{preview.truncated ? "\n…（已截断）" : ""}</pre>
        )
      )}
    </div>
  );
}

/* ---------- 决策卡 ---------- */

function DecisionCard({
  esc, onReply,
}: { esc: EscalationPayload; onReply: (t: string) => void }) {
  const [text, setText] = useState("");
  const submit = (v: string) => { if (v.trim()) onReply(v.trim()); };

  return (
    <div className="esc">
      <div className="eh">⚠ 需要你决定 · {esc.policy}</div>
      <div className="eb">
        {esc.context && <div className="muted" style={{ marginBottom: 6 }}>背景：{esc.context}</div>}
        {esc.question || esc.fallback_text || "（无问题正文）"}
      </div>
      <div className="ef">
        {esc.input_mode === "choice_with_other" && esc.options.length > 0 ? (
          <>
            {esc.options.map((o) => (
              <button key={o.id} className="btn primary sm" onClick={() => submit(o.value)}>
                {o.label}
              </button>
            ))}
            <input
              placeholder="或输入其他答复…" value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(text)}
            />
          </>
        ) : (
          <>
            <input
              placeholder="输入你的答复…" value={text} autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(text)}
            />
            <button className="btn primary sm" onClick={() => submit(text)}>提交</button>
          </>
        )}
      </div>
    </div>
  );
}

/** 计划卡：批准即授权执行到里程碑（可拒绝）。 */
function PlanCard({
  steps, onApprove, onReject,
}: { steps: PlanStep[]; onApprove: () => void; onReject: () => void }) {
  return (
    <div className="plan">
      <div className="ph">执行计划 · 待你批准</div>
      <ol>
        {steps.map((s) => (
          <li key={s.task_id}>
            <b>[{s.capability}]</b> {s.objective}
            {s.artifacts.length > 0 && <small>产物：{s.artifacts.join("、")}</small>}
          </li>
        ))}
      </ol>
      <div className="pf">
        <button className="btn primary sm" onClick={onApprove}>批准执行</button>
        <button className="btn sm" onClick={onReject}>不批准</button>
        <span className="muted" style={{ marginLeft: "auto" }}>批准即授权到里程碑，偏离会重新上报</span>
      </div>
    </div>
  );
}

/* ---------- 页面 ---------- */

type Mode = "key" | "all" | "esc";

export function GroupView({
  org, title, status, events, tasks, plan, focusTaskId, onReply, onApprove, onReject,
}: {
  org: string; title: string | null; status: string;
  events: MiloEvent[]; tasks: TaskRow[]; plan: PlanStep[] | null;
  focusTaskId?: string | null;
  onReply: (taskId: string, answer: string) => void;
  onApprove: () => void; onReject: () => void;
}) {
  const [mode, setMode] = useState<Mode>("key");
  const pending = new Set(tasks.filter((t) => t.state === "input_required").map((t) => t.task_id));
  const items = useMemo(() => buildItems(events), [events]);
  const stateByTask = useMemo(
    () => Object.fromEntries(tasks.map((t) => [t.task_id, t.state])), [tasks]);
  const done = tasks.filter((t) => t.state === "accepted").length;
  const [zh, tone] = GROUP_ZH[status] ?? [status, ""];

  // 从待办/通知跳进来：定位并高亮对应决策卡；否则新事件时贴底
  const endRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  useEffect(() => {
    if (focusTaskId) {
      const el = document.getElementById(`esc-${focusTaskId}`);
      if (el) {
        el.scrollIntoView({ block: "center" });
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 1600);
        lastCount.current = events.length;
        return;
      }
    }
    if (events.length !== lastCount.current) {
      lastCount.current = events.length;
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [events.length, focusTaskId]);

  const visible = items.filter((it) => {
    if (mode !== "esc") return true;
    if (it.kind === "section") return true;
    if (it.kind === "status-run") return false;
    return it.e.type === "escalation" || (it.e.type === "chat" && it.e.actor === "owner");
  });

  return (
    <>
      <div className="gchead">
        <div>
          <b>{title || "任务群"}</b>
          <div className="gcsub">
            你 + 秘书 + 成员 · 默认免打扰，@你 才通知
            {tasks.length > 0 && ` · ${done}/${tasks.length} 已验收`}
          </div>
        </div>
        <div className="gfilters">
          {([["key", "关键节点"], ["all", "全部"], ["esc", "只看请示"]] as const).map(([m, label]) => (
            <button key={m} className={`fchip ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <span className={`chip ${tone}`} style={{ flex: "none" }}>{zh}</span>
      </div>

      <div className="msgs">
        {plan && plan.length > 0 && (
          <PlanCard steps={plan} onApprove={onApprove} onReject={onReject} />
        )}

        {visible.map((it) => {
          if (it.kind === "section") {
            const st = stateByTask[it.taskId];
            return (
              <div key={it.key} className="sechead">
                <span className="secno">步骤 {it.n}</span>
                <b>{it.member}</b>
                <span className="secobj">{it.objective.slice(0, 60)}{it.objective.length > 60 ? "…" : ""}</span>
                {st && (
                  <span className={`chip ${st === "accepted" ? "ok" : st === "input_required" ? "warn" : st === "rejected" || st === "failed" ? "crit" : ""}`}>
                    {STATE_ZH[st] ?? st}
                  </span>
                )}
              </div>
            );
          }

          if (it.kind === "status-run") {
            return <StatusRun key={it.key} item={it} mode={mode}
                              live={it.last && (status === "active")} />;
          }

          const e = it.e;
          if (e.type === "status" && e.payload?.kind === "report") {
            return (
              <div key={it.key} className="actline">
                ⚙ <b>{who(e.actor)}</b> {String(e.content || e.payload?.doing || "")}
              </div>
            );
          }
          if (e.type === "system") {
            const msg = e.content || e.payload?.msg || e.payload?.error || "";
            return msg ? <div key={it.key} className="sys">{String(msg)}</div> : null;
          }
          const tag = TAG[e.type];
          const isEsc = e.type === "escalation";
          const esc = isEsc ? (e.payload as unknown as EscalationPayload) : null;
          const actionable = isEsc && e.task_id && pending.has(e.task_id);
          const arts: Array<{ name: string }> = Array.isArray(e.payload?.artifacts)
            ? e.payload.artifacts.filter((a: any) => a?.name && a?.uri) : [];

          return (
            <div key={it.key} className="msg" id={isEsc && e.task_id ? `esc-${e.task_id}` : undefined}>
              <span className={`ava ${e.actor === "secretariat" ? "s" : e.actor === "owner" ? "o" : ""}`}>
                {AVATAR[e.actor] ?? e.actor.slice(0, 1).toUpperCase()}
              </span>
              <div className="mb">
                <div className="mh">
                  {who(e.actor)} · {e.ts.slice(11, 19)}
                  {tag && <span className={`tag ${tag.up ? "up" : ""}`}>{tag.text}</span>}
                  {e.run_id && <span className="muted"> · run {e.run_id.slice(-4)}</span>}
                </div>
                {actionable && esc ? (
                  <DecisionCard esc={esc} onReply={(a) => onReply(e.task_id!, a)} />
                ) : (
                  <div className="mx">
                    <Md text={e.content || esc?.question || readable(e.payload)} />
                    {isEsc && !actionable && (
                      <div className="muted" style={{ marginTop: 4 }}>（已处理）</div>
                    )}
                  </div>
                )}
                {arts.length > 0 && e.task_id && arts.map((a) => (
                  <ArtifactCard key={a.name} org={org} taskId={e.task_id!} name={a.name} />
                ))}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </>
  );
}
