import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * 设置页 = AI 配置的编辑器（文件是事实源：org 的 bindings.yaml + OS 钥匙串）。
 * 密钥只写不读：入钥匙串后界面只显示"已配置"，永不回显。
 */
export function SettingsView({ org }: { org: string }) {
  const [apiBase, setApiBase] = useState("");
  const [model, setModel] = useState("");
  const [secretEnv, setSecretEnv] = useState("");
  const [secretPresent, setSecretPresent] = useState(false);
  const [secretInput, setSecretInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const b = await api.bindings(org);
      setApiBase(b.model.api_base ?? "");
      setModel(b.model.model ?? "");
      setSecretEnv(b.model.secret_env ?? "");
      setSecretPresent(b.secret_present);
    } catch {
      setMsg("读取配置失败——该公司可能缺少 bindings.yaml");
    }
  }, [org]);

  useEffect(() => { reload(); }, [reload]);

  const saveModel = async () => {
    setMsg(null);
    try {
      const r = await api.updateBindings(org, { api_base: apiBase.trim(), model: model.trim() });
      setMsg(r.note);
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 120)}`);
    }
  };

  const saveSecret = async () => {
    const v = secretInput.trim();
    if (!v || !secretEnv) return;
    setMsg(null);
    try {
      await api.putSecret(secretEnv, v);
      setSecretInput("");
      setSecretPresent(true);
      setMsg("密钥已存入系统钥匙串（不落盘、不回显）");
    } catch (e: any) {
      setMsg(`密钥保存失败：${String(e?.message ?? e).slice(0, 120)}`);
    }
  };

  return (
    <>
      <div className="h">设置 · AI 配置</div>
      <div className="muted" style={{ maxWidth: 620, marginBottom: 12 }}>
        当前公司（{org}）的模型绑定。配置以文件为事实源（bindings.yaml），
        密钥存系统钥匙串；改动对运行中的员工需重启公司后生效。
      </div>
      {msg && <div className="card" style={{ padding: "10px 14px", marginBottom: 10, maxWidth: 620 }}>{msg}</div>}

      <div className="card" style={{ padding: 16, maxWidth: 620 }}>
        <div className="ihead">模型服务</div>
        <label className="muted" style={{ fontSize: 12 }}>API 地址</label>
        <input className="inline-input" style={{ width: "100%", marginBottom: 8 }}
               value={apiBase} onChange={(e) => setApiBase(e.target.value)}
               placeholder="https://api.example.com/v1" />
        <label className="muted" style={{ fontSize: 12 }}>模型</label>
        <input className="inline-input" style={{ width: "100%", marginBottom: 10 }}
               value={model} onChange={(e) => setModel(e.target.value)}
               placeholder="model-name" />
        <button className="btn primary sm" onClick={saveModel}>保存模型配置</button>
      </div>

      <div className="card" style={{ padding: 16, maxWidth: 620, marginTop: 12 }}>
        <div className="ihead">
          密钥（{secretEnv || "未设定"}）{" "}
          <span className={`chip ${secretPresent ? "ok" : "warn"}`}>
            {secretPresent ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
          存入 OS 钥匙串后此处只显示状态，永不回显密钥内容。
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="inline-input" style={{ flex: 1 }} type="password"
                 value={secretInput} onChange={(e) => setSecretInput(e.target.value)}
                 placeholder={secretPresent ? "粘贴新密钥以更换…" : "粘贴密钥…"} />
          <button className="btn primary sm" disabled={!secretInput.trim()} onClick={saveSecret}>
            存入钥匙串
          </button>
        </div>
      </div>
    </>
  );
}
