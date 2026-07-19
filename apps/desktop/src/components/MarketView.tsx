import { useEffect, useState } from "react";
import { api, type PackInfo, type Permissions } from "../lib/api";

/** 质检徽章：实测（本机复跑）与自报（作者声明）分开呈现——信任来自复跑。 */
function EvalBadge({ p }: { p: PackInfo }) {
  const r = p.eval_report;
  if (r) {
    return (
      <span className={`chip ${r.meets_min ? "ok" : "warn"}`} style={{ marginLeft: "auto" }}
            title={`实测于 ${r.ran_at}${r.model ? ` · ${r.model}` : ""}`}>
        实测 {r.score}/5（{r.cases_passed}/{r.cases_total}）{r.meets_min ? "" : " · 未达自报门槛"}
      </span>
    );
  }
  if (p.eval?.min_score != null) {
    return (
      <span className="chip" style={{ marginLeft: "auto" }}
            title="作者自报，本机尚未复跑（milo eval <pack>）">
        自报 {p.eval.min_score} · 未实测
      </span>
    );
  }
  return null;
}

/** 权限摘要——包声明得越收敛，用户越少被打扰（招聘时最该看的一行）。 */
function permText(p?: Permissions): string {
  if (!p) return "未声明权限";
  const net = !p.network?.length ? "无外网"
    : p.network.includes("*") ? "外网开放" : `外网 ${p.network.length} 域名`;
  return [net, p.filesystem === "readonly" ? "文件只读" : "文件读写",
          p.python_repl ? "可执行代码（沙箱）" : "无代码执行"].join(" · ");
}

export function MarketView({ onChanged }: { onChanged: () => void }) {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const reload = () => api.market().then((r) => setPacks(r.packs)).catch(() => setPacks([]));
  useEffect(() => { reload(); }, []);

  // 市场只做"发现+验货"（§3.5）：下载入库 / 收藏记引用，招募在「团队」页
  const download = async (p: PackInfo) => {
    setBusy(p.path); setMsg(null);
    try {
      await api.download(p.path);
      setMsg(`${p.name} 已下载到 Agent 库——到「团队」页的 Agent 库招募成员`);
      await reload();
      onChanged();
    } catch (e: any) {
      setMsg(`下载失败：${String(e?.message ?? e).slice(0, 140)}`);
    } finally { setBusy(null); }
  };

  const toggleStar = async (p: PackInfo) => {
    if (!p.ref) return;
    try {
      await api.star(p.ref, !p.starred);
      await reload();
    } catch { /* 收藏失败静默，刷新即真相 */ }
  };

  const shown = packs.filter((p) =>
    !q || `${p.name}${p.description ?? ""}${(p.capabilities ?? []).map((c) => c.id).join()}`
      .toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="h">Agent 市场 · 带质检报告</div>
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
                  <EvalBadge p={p} />
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
                  <button className={`btn sm star ${p.starred ? "on" : ""}`} style={{ marginLeft: "auto" }}
                          title={p.starred ? "取消收藏" : "收藏（只记引用，不占磁盘）"}
                          onClick={() => toggleStar(p)}>
                    {p.starred ? "★ 已收藏" : "☆ 收藏"}
                  </button>
                  {p.downloaded ? (
                    <span className="chip ok" title="到「团队」页的 Agent 库招募">已在库中</span>
                  ) : (
                    <button className="btn primary sm"
                            disabled={busy === p.path} onClick={() => download(p)}>
                      {busy === p.path ? "下载中…" : "下载"}
                    </button>
                  )}
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
