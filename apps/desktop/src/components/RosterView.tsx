import { useEffect, useState } from "react";
import { api, type RosterMember } from "../lib/api";

/** 花名册页：org.yaml 的可视化（spec = 期望花名册，由老板签署；秘书长只执行）。 */
export function RosterView({ org }: { org: string }) {
  const [data, setData] = useState<{
    apiVersion: string; members: RosterMember[]; limits: Record<string, number>;
  } | null>(null);

  useEffect(() => { api.roster(org).then(setData).catch(() => setData(null)); }, [org]);

  if (!data) return <div className="muted">读取花名册中…</div>;

  return (
    <>
      <div className="h">花名册 · org.yaml</div>
      <div className="muted" style={{ maxWidth: 620, marginBottom: 12 }}>
        花名册是公司的期望状态，由你（老板）签署；秘书长按它执行入职/辞退，无权自行变动。
        <span className="mono"> {data.apiVersion}</span>
      </div>

      {data.members.map((m) => (
        <div key={m.name} className="card" style={{ padding: "12px 16px", marginBottom: 10, maxWidth: 760 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <b>{m.name}</b>
            <span className={`chip ${m.enrolled === false ? "warn" : m.loaded ? "ok" : ""}`}>
              {m.enrolled === false ? (m.has_workspace ? "停职中" : "待入职")
                : m.loaded ? (m.busy ? "在职 · 工作中" : "在职") : "未运行"}
            </span>
            {m.version && <span className="muted">v{m.version}</span>}
            {m.author && <span className="muted">· {m.author}</span>}
            {m.model_requirements?.min_tier && (
              <span className="chip" style={{ marginLeft: "auto" }}>
                需 {m.model_requirements.min_tier} 档
              </span>
            )}
          </div>
          {m.error ? (
            <div className="muted" style={{ color: "var(--crit)" }}>包异常：{m.error}</div>
          ) : (
            <>
              <div className="muted" style={{ margin: "4px 0" }}>{m.description}</div>
              <div style={{ margin: "6px 0" }}>
                {(m.capabilities ?? []).map((c) => (
                  <span key={c} className="chip" style={{ marginRight: 5 }}>{c}</span>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11.5 }}>
                权限：{!m.permissions?.network?.length ? "无外网" : `外网 ${m.permissions.network.join("、")}`}
                {" · "}{m.permissions?.filesystem === "readonly" ? "文件只读" : "文件读写"}
                {" · "}{m.permissions?.python_repl ? "可执行代码" : "无代码执行"}
              </div>
              <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
                {m.agent ? `模板 ${m.agent}（Agent 库）` : m.pack}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="h">限额（护栏）</div>
      <div className="card" style={{ padding: "12px 16px", maxWidth: 760 }}>
        <dl className="ikv">
          <dt>并行员工上限</dt><dd>{data.limits.maxParallelMembers ?? 5}（监督幅度证据：人有效监督约 5 个对象）</dd>
          <dt>待批队列背压</dt><dd>{data.limits.pendingQueueBackpressure ?? 3}</dd>
        </dl>
        <div className="muted" style={{ fontSize: 11.5 }}>
          一人公司（v0）：单层结构 · 员工间无直连 · 产物经 artifact 交接。
          部门与自定义路由为后续版本。
        </div>
      </div>
    </>
  );
}
