import { useCallback, useEffect, useState } from "react";
import { api, type RosterMember } from "../lib/api";

/**
 * 公司页 = 人事中心。数字员工生命周期（人事红线：每一步都只能由老板在这里发起）。
 * 前端隐喻是「一人公司」：招聘 → 入职 → 在职 → 停职/复岗 → 辞退；
 * 后端保持中性术语（member/enroll/dismiss），此处只做展示层映射：
 *
 *   市场「招聘」→ 待入职 →「入职」→ 在职（空闲/工作中）
 *                    │                  │
 *                    │「撤销录用」      │「停职」（工作中不可）→ 停职中（记忆保留）
 *                    ▼                  │「辞退」（工作中需强制确认）  │「复岗」/「辞退」
 *                  移除                 ▼                             ▼
 *                                辞退：成果归公司，过程随实例销毁
 */
type Phase = "pending" | "suspended" | "idle" | "busy" | "starting" | "error";

function phaseOf(m: RosterMember): Phase {
  if (m.error) return "error";
  if (!m.enrolled) return m.has_workspace ? "suspended" : "pending";
  if (!m.loaded) return "starting";
  return m.busy ? "busy" : "idle";
}

const PHASE_LABEL: Record<Phase, [string, string]> = {
  pending: ["待入职", ""],           // 招聘已录用，实例未分配
  suspended: ["停职中", "warn"],     // 记忆保留，可复岗
  starting: ["未运行", "warn"],      // 已入职但实例不在（如启动失败）
  idle: ["在职 · 空闲", "ok"],
  busy: ["在职 · 工作中", "warn"],
  error: ["包异常", "crit"],
};

export function OrgView({ org, onChanged }: { org: string; onChanged: () => void }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // 正在执行人事动作的员工
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await api.roster(org).catch(() => null);
    setMembers(r?.members ?? []);
  }, [org]);

  useEffect(() => { reload(); }, [reload]);

  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name); setMsg(null);
    try {
      await fn();
      setMsg(`${name} ${done}`);
    } catch (e: any) {
      setMsg(`操作失败：${String(e?.message ?? e).slice(0, 140)}`);
    } finally {
      setBusy(null);
      await reload();
      onChanged();
    }
  };

  const activate = (m: RosterMember, resumeWork: boolean) =>
    act(m.name, () => api.activate(org, m.name),
        resumeWork ? "已复岗（延续原有记忆）" : "已入职，实例运行中");

  const suspend = (m: RosterMember) =>
    act(m.name, () => api.deactivate(org, m.name), "已停职（记忆保留，可随时复岗）");

  const dismiss = (m: RosterMember) => {
    const warn = m.busy
      ? `${m.name} 正在执行任务，辞退将中断任务并销毁其工作区（已交付产物保留）。确定强制辞退？`
      : m.has_workspace
        ? `辞退 ${m.name}？其私有工作区（记忆/过程）将销毁，已交付产物归公司保留。`
        : `撤销对 ${m.name} 的录用？（尚未入职，无工作区需要清理）`;
    if (!window.confirm(warn)) return;
    act(m.name, () => api.dismiss(org, m.name, m.busy), m.busy ? "已强制辞退" : "已办理辞退");
  };

  return (
    <>
      <div className="h">公司架构</div>
      <div className="card" style={{ padding: 18, maxWidth: 680 }}>
        <div style={{ marginBottom: 12 }}>你（老板）→ 秘书长 → 数字员工</div>
        {msg && <div className="muted" style={{ marginBottom: 10 }}>{msg}</div>}

        {members.map((m) => {
          const phase = phaseOf(m);
          const [label, tone] = PHASE_LABEL[phase];
          const acting = busy === m.name;
          return (
            <div key={m.name} className="orgrow"
                 style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0",
                          borderBottom: "1px dashed var(--line)" }}>
              <div style={{ minWidth: 0 }}>
                <b>{m.name}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  {(m.capabilities ?? []).join("、") || m.error || "—"}
                </div>
              </div>
              <span className={`chip ${tone}`} style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                {label}
              </span>
              <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                {phase === "pending" && (
                  <button className="btn primary sm" disabled={acting}
                          onClick={() => activate(m, false)}>
                    {acting ? "入职中…" : "入职"}
                  </button>
                )}
                {phase === "suspended" && (
                  <button className="btn primary sm" disabled={acting}
                          onClick={() => activate(m, true)}>
                    {acting ? "复岗中…" : "复岗"}
                  </button>
                )}
                {phase === "starting" && (
                  <button className="btn sm" disabled={acting}
                          onClick={() => activate(m, true)}>拉起实例</button>
                )}
                {(phase === "idle" || phase === "busy") && (
                  <button className="btn sm" disabled={acting || phase === "busy"}
                          title={phase === "busy" ? "工作中不可停职，交付后再操作" : "停止实例，记忆保留"}
                          onClick={() => suspend(m)}>停职</button>
                )}
                {phase !== "error" && (
                  <button className="btn sm crit" disabled={acting} onClick={() => dismiss(m)}>
                    {phase === "pending" ? "撤销录用" : "辞退"}
                  </button>
                )}
                {phase === "error" && (
                  <button className="btn sm crit" disabled={acting} onClick={() => dismiss(m)}>
                    移除
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {members.length === 0 && (
          <div className="muted">还没有数字员工——到「人才市场」页招聘第一名员工。</div>
        )}

        <div className="muted" style={{ marginTop: 10 }}>
          一人公司：你 + 秘书长 + 数字员工 · 并行 ≤5 · 员工间无直连，产物经 artifact 交接。
          人事动作只能由你发起：招聘 → 入职 → 停职（可复岗）→ 辞退（成果归公司，过程随实例销毁）。
        </div>
      </div>
    </>
  );
}
