import { useCallback, useEffect, useState } from "react";
import { api, type Permissions } from "../lib/api";
import { useThemeMode } from "../lib/theme";

/**
 * 系统设置——照搬 stock-agent-001 的形态：
 * 居中悬浮模态（遮罩+大窗，Esc/点遮罩/关闭按钮退出）+ 左分区导航右内容 +
 * SectionCard/SettingRow 原语 + 通用设置（主题模式/工作区/锁定护栏卡）。
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

/* ---------- 通用（外观/工作区/护栏，形态照搬）---------- */

function GeneralTab({ org }: { org: string }) {
  const { themeMode, setThemeMode } = useThemeMode();
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
      <SectionCard title="外观" description="明暗主题跟随">
        <SettingRow label="主题模式" sub="跟随系统时随 macOS 自动切换">
          <div className="seg-ctl">
            {([["light", "白天"], ["dark", "夜晚"], ["system", "跟随系统"]] as const).map(([mode, label]) => (
              <button key={mode} type="button" className={themeMode === mode ? "on" : ""}
                onClick={() => setThemeMode(mode)}>{label}</button>
            ))}
          </div>
        </SettingRow>
      </SectionCard>

      <SectionCard title="成员管理红线" subtitle="V0 锁定" description="安全护栏，本版本不可关闭">
        <SettingRow label="成员变动" sub="招募 / 加入 / 停职 / 移出只能由你发起">
          <span className="tag" style={{ color: "var(--green)", background: "var(--green-soft)" }}>仅限你</span>
        </SettingRow>
        <SettingRow label="秘书权限" sub="只执行与建议，无自动成员变动">
          <span className="tag">执行者</span>
        </SettingRow>
      </SectionCard>

      <DefaultPermissionsCard />

      <SectionCard title="工作区" description="当前团队与数据目录；切换团队在左栏顶部">
        <SettingRow label="当前团队">
          <span className="mono" style={{ fontSize: 12 }}>{org}</span>
        </SettingRow>
        <SettingRow label="数据目录" sub="名册 / 事件库 / 交付产物都在这里">
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", wordBreak: "break-all", textAlign: "right" }}>
            ~/.milo/orgs/{org}
          </span>
        </SettingRow>
        <SettingRow label="成员">
          <span className="mono" style={{ fontSize: 12 }}>{members ?? "-"} / 上限 {limit ?? "-"}</span>
        </SettingRow>
      </SectionCard>
    </div>
  );
}

/** 默认权限（2026-07-20 决策：权限是本地环境的属性，不是包的属性）。 */
function DefaultPermissionsCard() {
  const [net, setNet] = useState("");
  const [fs, setFs] = useState("workspace");
  const [repl, setRepl] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getDefaults().then((r) => {
      setNet((r.permissions.network ?? []).join(", "));
      setFs(r.permissions.filesystem ?? "workspace");
      setRepl(Boolean(r.permissions.python_repl));
    }).catch(() => setMsg("读取默认权限失败"));
  }, []);

  const save = async () => {
    setMsg(null);
    try {
      const permissions: Permissions = {
        network: net.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        filesystem: fs,
        python_repl: repl,
      };
      const r = await api.putDefaults(permissions);
      setDirty(false);
      setMsg(r.note);
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 120)}`);
    }
  };

  return (
    <SectionCard title="默认权限" subtitle="新成员初始值"
      description="新招募成员的初始权限；已有成员不受影响，可在成员详情单独调整">
      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <span className="field-label">外网域名白名单（逗号分隔；留空 = 禁外网）</span>
          <input className="setting-input" value={net}
                 onChange={(e) => { setNet(e.target.value); setDirty(true); }}
                 placeholder="如 *.arxiv.org" />
        </label>
        <div className="setting-row">
          <div className="setting-row-main"><div className="setting-row-label">文件权限</div></div>
          <div className="setting-row-ctl">
            <div className="seg-ctl">
              {([["readonly", "只读"], ["workspace", "读写工作区"]] as const).map(([v, label]) => (
                <button key={v} type="button" className={fs === v ? "on" : ""}
                        onClick={() => { setFs(v); setDirty(true); }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-main">
            <div className="setting-row-label">代码执行（host bash）</div>
            <div className="setting-row-sub">实质上的总开关——默认建议保持关闭，按成员单独放开</div>
          </div>
          <div className="setting-row-ctl">
            <input type="checkbox" checked={repl}
                   onChange={(e) => { setRepl(e.target.checked); setDirty(true); }} />
          </div>
        </div>
        {dirty && (
          <div><button className="btn primary sm" onClick={save}>保存默认权限</button></div>
        )}
        {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
    </SectionCard>
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
      setMsg("读取配置失败——该团队可能缺少 bindings.yaml");
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
        description="成员与秘书共用此绑定；改动对运行中的成员需重启团队后生效">
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

/* ---------- 弹窗（照搬 SettingsModal：遮罩+大窗+左导航右内容）---------- */

type Tab = "general" | "ai";

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "general", label: "通用", icon: "⚙️" },
  { key: "ai", label: "AI 配置", icon: "🤖" },
];

export function SettingsModal({ org, open, connected, onClose }: {
  org: string; open: boolean; connected: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal" role="dialog" aria-modal="true">
        <div className="settings-modal-head">
          <span className="settings-modal-title">系统设置</span>
          <button className="func-close" onClick={onClose} title="关闭 (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="settings-modal-body">
          <div className="settings-layout">
            <nav className="settings-nav">
              {TABS.map((t) => (
                <button key={t.key} type="button"
                  className={`settings-nav-item ${tab === t.key ? "active" : ""}`}
                  onClick={() => setTab(t.key)}>
                  <span aria-hidden>{t.icon}</span>{t.label}
                </button>
              ))}
              <div className="settings-nav-gap" />
              <div className="settings-nav-foot">
                <span className={`settings-runtime-dot ${connected ? "ok" : ""}`} />
                milod · {connected ? "已连接" : "未连接"}
              </div>
            </nav>
            <div className="settings-content">
              {tab === "general" && <GeneralTab org={org} />}
              {tab === "ai" && <AiTab org={org} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
