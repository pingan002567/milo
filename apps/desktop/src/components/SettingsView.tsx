import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * 设置页——形态对齐 stock-agent-001 Settings：
 * Tab 分区 + SectionCard/SettingRow 原语 + 密钥不回显 + 测试连接 + 改动才出现保存钮。
 * 事实源不变：org 的 bindings.yaml + OS 钥匙串；此页只是编辑器。
 */

function SectionCard({ title, subtitle, description, icon, children }: {
  title: string;
  subtitle?: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-card">
      <div className="setting-card-head">
        {icon && <div className="setting-icon-box">{icon}</div>}
        <div className="setting-card-heading">
          <div className="setting-card-title">{title}</div>
          {description && <div className="setting-card-desc">{description}</div>}
        </div>
        {subtitle && <span className="setting-card-badge">{subtitle}</span>}
      </div>
      <div className="setting-card-body">{children}</div>
    </div>
  );
}

function SettingRow({ label, sub, children }: {
  label: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-main">
        <div className="setting-row-label">{label}</div>
        {sub && <div className="setting-row-sub">{sub}</div>}
      </div>
      <div className="setting-row-ctl">{children}</div>
    </div>
  );
}

/* ---------- 通用 ---------- */

function GeneralTab({ org }: { org: string }) {
  const [members, setMembers] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    api.roster(org).then((r) => {
      setMembers(r.members.length);
      setLimit(r.limits?.maxParallelMembers ?? 5);
    }).catch(() => { setMembers(null); setLimit(null); });
  }, [org]);

  return (
    <div className="settings-stack">
      <SectionCard icon="🏛" title="工作区" description="当前公司与数据目录；切换公司在左栏顶部">
        <SettingRow label="当前公司">
          <span className="mono" style={{ fontSize: 12 }}>{org}</span>
        </SettingRow>
        <SettingRow label="数据目录" sub="花名册 / 事件库 / 交付产物都在这里">
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", wordBreak: "break-all", textAlign: "right" }}>
            ~/.milo/orgs/{org}
          </span>
        </SettingRow>
        <SettingRow label="数字员工">
          <span className="mono" style={{ fontSize: 12 }}>{members ?? "-"} / 上限 {limit ?? "-"}</span>
        </SettingRow>
      </SectionCard>

      <SectionCard icon="🔒" title="人事红线" subtitle="锁定" description="安全护栏，本版本不可关闭">
        <SettingRow label="人事变动" sub="招聘 / 入职 / 停职 / 辞退只能由你发起">
          <span className="tag" style={{ color: "var(--green)", background: "var(--green-soft)" }}>仅限老板</span>
        </SettingRow>
        <SettingRow label="秘书长权限" sub="只执行与建议，无自动人事动作">
          <span className="tag">执行者</span>
        </SettingRow>
      </SectionCard>
    </div>
  );
}

/* ---------- AI 配置 ---------- */

function AiTab({ org }: { org: string }) {
  const [apiBase, setApiBase] = useState("");
  const [model, setModel] = useState("");
  const [secretEnv, setSecretEnv] = useState("");
  const [secretPresent, setSecretPresent] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; model?: string; latency_ms?: number; error?: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const b = await api.bindings(org);
      setApiBase(b.model.api_base ?? "");
      setModel(b.model.model ?? "");
      setSecretEnv(b.model.secret_env ?? "");
      setSecretPresent(b.secret_present);
      setDirty(false);
      setApiKey("");
    } catch {
      setMsg("读取配置失败——该公司可能缺少 bindings.yaml");
    }
  }, [org]);

  useEffect(() => { reload(); }, [reload]);

  const markDirty = () => { if (!dirty) setDirty(true); };

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      if (apiKey.trim() && secretEnv) {
        await api.putSecret(secretEnv, apiKey.trim());
        setSecretPresent(true);
      }
      const r = await api.updateBindings(org, { api_base: apiBase.trim(), model: model.trim() });
      setApiKey(""); setDirty(false);
      setMsg(r.note);
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 140)}`);
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      setTestResult(await api.testBindings(org));
    } catch (e: any) {
      setTestResult({ ok: false, error: String(e?.message ?? e).slice(0, 140) });
    } finally { setTesting(false); }
  };

  return (
    <div className="settings-stack">
      <SectionCard icon="🤖" title="模型接入" subtitle="API Key / 模型 / 连接"
        description="数字员工与秘书长共用此绑定；改动对运行中的员工需重启公司后生效">
        <div style={{ display: "grid", gap: 12 }}>
          <label>
            <span className="field-label">
              API Key（{secretEnv || "未设定"}）
              {secretPresent && (
                <span style={{ marginLeft: 8, color: "var(--green)", fontSize: 11 }}>
                  ✓ 已配置（存 OS 钥匙串，不回显；留空则沿用已保存的 Key）
                </span>
              )}
            </span>
            <input type="password" className="setting-input"
              placeholder={secretPresent ? "已保存，留空则不修改" : "sk-…"}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); markDirty(); }} />
          </label>
          <label>
            <span className="field-label">Base URL</span>
            <input type="text" className="setting-input" placeholder="https://api.example.com/v1"
              value={apiBase}
              onChange={(e) => { setApiBase(e.target.value); markDirty(); }} />
          </label>
          <label>
            <span className="field-label">模型</span>
            <input type="text" className="setting-input" placeholder="model-name"
              value={model}
              onChange={(e) => { setModel(e.target.value); markDirty(); }} />
          </label>

          {dirty && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn primary" disabled={saving} type="button" onClick={handleSave}>
                {saving ? "保存中…" : "保存 AI 配置"}
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn ghost" disabled={testing} type="button" onClick={handleTest}
              style={{ fontSize: 12 }}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            {testResult && (
              <span style={{ fontSize: 12, color: testResult.ok ? "var(--green)" : "var(--crit)" }}>
                {testResult.ok
                  ? `连接成功 · ${testResult.model ?? ""} · ${testResult.latency_ms ?? ""}ms`
                  : `连接失败：${testResult.error}`}
              </span>
            )}
          </div>
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </SectionCard>
    </div>
  );
}

/* ---------- 页面 ---------- */

type Tab = "general" | "ai";

export function SettingsView({ org }: { org: string }) {
  const [tab, setTab] = useState<Tab>("ai");
  return (
    <>
      <div className="h">设置</div>
      <div className="seg-ctl" style={{ marginBottom: 16 }}>
        {([["general", "通用"], ["ai", "AI 配置"]] as const).map(([t, label]) => (
          <button key={t} type="button" className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === "general" && <GeneralTab org={org} />}
      {tab === "ai" && <AiTab org={org} />}
    </>
  );
}
