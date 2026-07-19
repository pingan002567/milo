import { useState } from "react";
import type { EscalationPayload, MiloEvent, PlanStep, TaskRow } from "../lib/api";

const AVATAR: Record<string, string> = { owner: "长", secretariat: "秘", system: "系" };

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
  escalation: { text: "请示", up: true },
  delivery: { text: "交付" },
  acceptance: { text: "验收" },
};

/** 决策卡：按 harness 的 input_mode 契约渲染——有选项列按钮，否则纯输入框。 */
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

export function GroupView({
  title, status, events, tasks, plan, onReply, onApprove, onReject,
}: {
  title: string | null; status: string;
  events: MiloEvent[]; tasks: TaskRow[]; plan: PlanStep[] | null;
  onReply: (taskId: string, answer: string) => void;
  onApprove: () => void; onReject: () => void;
}) {
  // 只有仍处于 input_required 的任务才渲染可操作的决策卡（已答复的转为历史）
  const pending = new Set(tasks.filter((t) => t.state === "input_required").map((t) => t.task_id));

  return (
    <>
      <div className="gchead">
        <div>
          <b>{title || "任务群"}</b>
          <div className="gcsub">
            你 + 秘书长 + 数字员工 · 默认免打扰，@你 才通知
          </div>
        </div>
        <span className={`chip ${status === "waiting" ? "warn" : status === "archived" ? "" : "ok"}`}
              style={{ marginLeft: "auto", flex: "none" }}>
          {status}
        </span>
      </div>

      <div className="msgs">
        {plan && plan.length > 0 && (
          <PlanCard steps={plan} onApprove={onApprove} onReject={onReject} />
        )}

        {events.map((e) => {
          if (e.type === "system") {
            const msg = e.content || e.payload?.msg || e.payload?.error || "";
            return msg ? <div key={e.event_id} className="sys">{String(msg)}</div> : null;
          }
          const tag = TAG[e.type];
          const isEsc = e.type === "escalation";
          const esc = isEsc ? (e.payload as unknown as EscalationPayload) : null;
          const actionable = isEsc && e.task_id && pending.has(e.task_id);

          return (
            <div key={e.event_id} className="msg">
              <span className={`ava ${e.actor === "secretariat" ? "s" : e.actor === "owner" ? "o" : ""}`}>
                {AVATAR[e.actor] ?? e.actor.slice(0, 1).toUpperCase()}
              </span>
              <div className="mb">
                <div className="mh">
                  {e.actor} · {e.ts.slice(11, 19)}
                  {tag && <span className={`tag ${tag.up ? "up" : ""}`}>{tag.text}</span>}
                  {e.run_id && <span className="muted"> · run {e.run_id.slice(-4)}</span>}
                </div>
                {actionable && esc ? (
                  <DecisionCard esc={esc} onReply={(a) => onReply(e.task_id!, a)} />
                ) : (
                  <div className="mx">
                    {e.content || esc?.question || readable(e.payload)}
                    {isEsc && !actionable && (
                      <div className="muted" style={{ marginTop: 4 }}>（已处理）</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
