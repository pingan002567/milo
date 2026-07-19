import { useEffect, useState } from "react";
import { api, type PackInfo, type Permissions } from "../lib/api";

/** 权限摘要——包声明得越收敛，用户越少被打扰（招聘时最该看的一行）。 */
function permText(p?: Permissions): string {
  if (!p) return "未声明权限";
  const net = !p.network?.length ? "无外网"
    : p.network.includes("*") ? "外网开放" : `外网 ${p.network.length} 域名`;
  return [net, p.filesystem === "readonly" ? "文件只读" : "文件读写",
          p.python_repl ? "可执行代码（沙箱）" : "无代码执行"].join(" · ");
}

export function MarketView({ org, onEnrolled }: { org: string; onEnrolled: () => void }) {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => { api.market().then((r) => setPacks(r.packs)).catch(() => setPacks([])); }, []);

  const enroll = async (p: PackInfo) => {
    setBusy(p.path); setMsg(null);
    try {
      const r = await api.enroll(org, p.path);
      // 后端 note 是中性术语（成员/编制），展示层统一成公司隐喻，不透传
      setMsg(`已录用 ${r.name}（${r.capabilities.join("、")}）——到「公司」页为其办理入职后开始工作`);
      onEnrolled();
    } catch (e: any) {
      setMsg(`招聘失败：${String(e?.message ?? e).slice(0, 140)}`);
    } finally { setBusy(null); }
  };

  const shown = packs.filter((p) =>
    !q || `${p.name}${p.description ?? ""}${(p.capabilities ?? []).map((c) => c.id).join()}`
      .toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="h">人才市场 · 带质检报告的数字员工</div>
      <input className="inline-input" placeholder="搜索能力、作者…"
             value={q} onChange={(e) => setQ(e.target.value)} />
      {msg && <div className="card" style={{ padding: "10px 14px", margin: "10px 0" }}>{msg}</div>}

      <div className="packs">
        {shown.map((p) => (
          <div key={p.path} className="card pack">
            {p.error ? (
              <>
                <b>{p.name}</b>
                <div className="muted">包损坏：{p.error}</div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <b style={{ fontSize: 14 }}>{p.name}</b>
                  <span className="muted">v{p.version}</span>
                  {p.eval?.min_score != null && (
                    <span className="chip ok" style={{ marginLeft: "auto" }}>
                      质检门槛 {p.eval.min_score}
                    </span>
                  )}
                </div>
                <div style={{ margin: "6px 0" }}>
                  {(p.capabilities ?? []).map((c) => (
                    <span key={c.id} className="chip" style={{ marginRight: 5 }}>{c.id}</span>
                  ))}
                </div>
                <div className="muted" style={{ minHeight: 34 }}>{p.description}</div>
                <div className="qc">
                  🔒 {permText(p.permissions)}
                  {p.model_requirements?.min_tier && ` · 需 ${p.model_requirements.min_tier} 档模型`}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <span className="muted">{p.author}</span>
                  <button className="btn primary sm" style={{ marginLeft: "auto" }}
                          disabled={busy === p.path} onClick={() => enroll(p)}>
                    {busy === p.path ? "录用中…" : "招聘"}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {packs.length === 0 && (
        <div className="card" style={{ padding: 20, maxWidth: 620 }}>
          <div className="muted">
            没有发现可用的 Agent 包。把 MiloPack 目录放到 <code>~/.milo/packs/</code>，
            或用环境变量 <code>MILO_PACKS</code> 指定目录（冒号分隔）。
          </div>
        </div>
      )}
    </>
  );
}
