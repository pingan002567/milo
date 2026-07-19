import { useCallback, useEffect, useState } from "react";
import { api, type LibraryItem, type RosterMember } from "../lib/api";

/**
 * 公司页 = 人事中心。三层模型（§3.5）：Agent 模板（库，全局资产）→ 聘用起名
 * new 出具名实例 → 数字员工生命周期（人事红线：每一步只能由老板发起）：
 *
 *   Agent 库「聘用」（起名+可选立即入职）→ 待入职 →「入职」→ 在职（空闲/工作中）
 *                        │                             │
 *                        │「撤销录用」                 │「停职」（工作中不可）→ 停职中（记忆保留）
 *                        ▼                             │「辞退」（工作中需强制确认）│「复岗」/「辞退」
 *                      移除                            ▼                            ▼
 *                                          辞退：成果归公司，过程随实例销毁；模板留在库中
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

/** 聘用表单：模板 new 实例必须起名（§3.5：名字属于这个人，不是岗位）。 */
function HireForm({ suggested, busy, onHire, onCancel }: {
  suggested: string; busy: boolean;
  onHire: (name: string, activate: boolean) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(suggested);
  const [activate, setActivate] = useState(true);
  return (
    <div className="hireform">
      <input className="setting-input" style={{ flex: 1, height: 30 }} autoFocus
             placeholder="实例名（公司内唯一）" value={name}
             onChange={(e) => setName(e.target.value)}
             onKeyDown={(e) => e.key === "Enter" && name.trim() && onHire(name.trim(), activate)} />
      <label className="muted" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        立即入职
      </label>
      <button className="btn primary sm" disabled={busy || !name.trim()}
              onClick={() => onHire(name.trim(), activate)}>
        {busy ? "聘用中…" : "确认聘用"}
      </button>
      <button className="btn sm" onClick={onCancel}>取消</button>
    </div>
  );
}

export function OrgView({ org, onChanged }: { org: string; onChanged: () => void }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [hiring, setHiring] = useState<string | null>(null);  // 正在填聘用表单的模板 ref
  const [busy, setBusy] = useState<string | null>(null); // 正在执行人事动作的员工
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [r, l] = await Promise.all([
      api.roster(org).catch(() => null),
      api.library().catch(() => null),
    ]);
    setMembers(r?.members ?? []);
    setLibrary(l?.library ?? []);
  }, [org]);

  useEffect(() => { reload(); }, [reload]);

  /** 默认实例名：模板名 或 模板名-N（同模板第 N 个实例）。 */
  const suggestName = (item: LibraryItem) => {
    const base = item.name ?? item.ref.split("@")[0];
    const taken = new Set(members.map((m) => m.name));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-x`;
  };

  const hire = async (item: LibraryItem, name: string, activate: boolean) => {
    setBusy(item.ref); setMsg(null);
    try {
      const r = await api.hire(org, item.ref, name, activate);
      setMsg(`已聘用 ${r.name}（${item.name ?? item.ref}）——${activate ? "已入职，实例运行中" : "待入职"}`);
      setHiring(null);
    } catch (e: any) {
      setMsg(`聘用失败：${String(e?.message ?? e).slice(0, 140)}`);
    } finally {
      setBusy(null);
      await reload();
      onChanged();
    }
  };

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
                {m.agent && <span className="mono muted" style={{ fontSize: 10.5, marginLeft: 6 }}>{m.agent}</span>}
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
          <div className="muted">还没有数字员工——从下方 Agent 库聘用，或先到「Agent 市场」下载模板。</div>
        )}

        <div className="muted" style={{ marginTop: 10 }}>
          一人公司：你 + 秘书长 + 数字员工 · 并行 ≤5 · 员工间无直连，产物经 artifact 交接。
          人事动作只能由你发起：聘用（起名）→ 入职 → 停职（可复岗）→ 辞退（成果归公司，过程随实例销毁）。
        </div>
      </div>

      <div className="h">Agent 库 · 可聘用的模板（全局资产，跨公司共享）</div>
      <div className="card" style={{ padding: 18, maxWidth: 680 }}>
        {library.map((item) => (
          <div key={item.ref} style={{ padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <b>{item.name ?? item.ref}</b>
                <span className="mono muted" style={{ fontSize: 10.5, marginLeft: 6 }}>{item.ref}</span>
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.error ? `模板损坏：${item.error}` : (item.capabilities ?? []).join("、") || item.description || "—"}
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                {(item.used_by ?? []).length > 0 && (
                  <span className="chip" title={`被引用：${(item.used_by ?? []).join("、")}`}>
                    {(item.used_by ?? []).length} 实例在用
                  </span>
                )}
                {!item.error && hiring !== item.ref && (
                  <button className="btn primary sm" onClick={() => setHiring(item.ref)}>聘用</button>
                )}
                <button className="btn sm crit" disabled={(item.used_by ?? []).length > 0}
                        title={(item.used_by ?? []).length > 0 ? "被实例引用的模板不能移除" : "从库中移除下载"}
                        onClick={async () => {
                          if (!window.confirm(`从 Agent 库移除 ${item.ref}？`)) return;
                          try { await api.removeFromLibrary(item.ref); } catch (e: any) {
                            setMsg(`移除失败：${String(e?.message ?? e).slice(0, 120)}`);
                          }
                          await reload();
                        }}>移除</button>
              </div>
            </div>
            {hiring === item.ref && (
              <HireForm suggested={suggestName(item)} busy={busy === item.ref}
                        onHire={(n, a) => hire(item, n, a)} onCancel={() => setHiring(null)} />
            )}
          </div>
        ))}
        {library.length === 0 && (
          <div className="muted">库是空的——到「Agent 市场」下载模板后即可在此聘用。</div>
        )}
      </div>
    </>
  );
}
