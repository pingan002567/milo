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

/** 团队信息（团队设置）：显示名、编制上限、数据目录、用量。 */
function TeamInfoTab({ org, onOrgChanged }: { org: string; onOrgChanged?: () => void }) {
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(5);
  const [members, setMembers] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.orgs().then((r) => {
      const me = r.orgs.find((o) => o.org === org);
      setName(me?.displayName ?? org);
    }).catch(() => setName(org));
    api.roster(org).then((r) => {
      setMembers(r.members.length);
      setLimit(r.limits?.maxParallelMembers ?? 5);
    }).catch(() => setMembers(null));
  }, [org]);

  const save = async () => {
    setMsg(null);
    try {
      await api.patchOrg(org, { displayName: name.trim(), maxParallelMembers: limit });
      setDirty(false); setMsg("已保存");
      onOrgChanged?.();
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 120)}`);
    }
  };

  return (
    <div className="settings-stack">
      <SectionCard icon="👥" title="团队信息" subtitle={org}
        description="显示名可改；标识（目录名与接口路径）创建后固定">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            <span className="field-label">团队名</span>
            <input className="setting-input" value={name}
                   onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          </label>
          <SettingRow label="编制上限" sub="监督幅度护栏：人能有效监督的对象约 5 个">
            <input className="setting-input mono" type="number" min={1} max={20}
                   style={{ width: 80, height: 30, textAlign: "center" }}
                   value={limit}
                   onChange={(e) => { setLimit(Number(e.target.value)); setDirty(true); }} />
          </SettingRow>
          <SettingRow label="当前成员">
            <span className="mono" style={{ fontSize: 12 }}>{members ?? "-"} / {limit}</span>
          </SettingRow>
          <SettingRow label="数据目录" sub="名册 / 事件库 / 交付产物 / 成员工作区">
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", wordBreak: "break-all", textAlign: "right" }}>
              ~/.milo/orgs/{org}
            </span>
          </SettingRow>
          {dirty && <div><button className="btn primary sm" onClick={save}>保存</button></div>}
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </SectionCard>
    </div>
  );
}

/** 通用（系统设置）：外观 + 全局红线。 */
function GeneralTab() {
  const { themeMode, setThemeMode } = useThemeMode();
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

      <SectionCard title="关于" subtitle="v0.1">
        <SettingRow label="Milo" sub="AI 团队指挥台 · 本地优先，数据全在 ~/.milo">
          <span className="mono" style={{ fontSize: 11.5 }}>桌面壳 v0.1</span>
        </SettingRow>
      </SectionCard>
    </div>
  );
}

/* ---------- 权限（2026-07-20 决策：权限是本地环境的属性）---------- */

/** 权限值的紧凑摘要（成员总览用）。 */
function permSummary(p?: Permissions | null): { net: string; fs: string; repl: boolean } {
  return {
    net: !p?.network?.length ? "禁网" : `${p.network.length} 域名`,
    fs: p?.filesystem === "readonly" ? "只读" : "读写",
    repl: Boolean(p?.python_repl),
  };
}

function PermissionsTab({ org }: { org: string }) {
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [fs, setFs] = useState("workspace");
  const [repl, setRepl] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [members, setMembers] = useState<Array<{
    name: string; agent?: string | null; loaded?: boolean; permissions?: Permissions;
  }>>([]);

  useEffect(() => {
    api.getDefaults().then((r) => {
      setDomains(r.permissions.network ?? []);
      setFs(r.permissions.filesystem ?? "workspace");
      setRepl(Boolean(r.permissions.python_repl));
    }).catch(() => setMsg("读取默认权限失败"));
    api.roster(org).then((r) => setMembers(r.members)).catch(() => setMembers([]));
  }, [org]);

  const addDomain = () => {
    const v = domainInput.trim();
    if (v && !domains.includes(v)) { setDomains([...domains, v]); setDirty(true); }
    setDomainInput("");
  };

  const save = async () => {
    setMsg(null);
    try {
      const r = await api.putDefaults({ network: domains, filesystem: fs, python_repl: repl });
      setDirty(false);
      setMsg(r.note);
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 120)}`);
    }
  };

  const defaults = { network: domains, filesystem: fs, python_repl: repl };
  const differs = (p?: Permissions | null) => {
    if (!p) return false;
    const a = permSummary(p), b = permSummary(defaults);
    return a.net !== b.net || a.fs !== b.fs || a.repl !== b.repl;
  };

  return (
    <div className="settings-stack">
      <SectionCard icon="🛡️" title="默认权限" subtitle="新成员初始值"
        description="新招募成员的初始权限；已有成员不受影响，可在成员详情单独调整">
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <span className="field-label">
              外网访问{domains.length === 0 && <span className="chip" style={{ marginLeft: 8 }}>当前：禁网</span>}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
              {domains.map((d) => (
                <span key={d} className="chip mono" style={{ fontSize: 11 }}>
                  {d}
                  <button className="capx" title="移除域名"
                          onClick={() => { setDomains(domains.filter((x) => x !== d)); setDirty(true); }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="setting-input" style={{ flex: 1 }} value={domainInput}
                     placeholder="添加允许访问的域名，如 *.arxiv.org（回车添加）"
                     onChange={(e) => setDomainInput(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && addDomain()} />
              <button className="btn sm" onClick={addDomain} disabled={!domainInput.trim()}>添加</button>
            </div>
            <div className="perm-hint">白名单非空时注入 web_search 检索工具；v0 粒度为"有无"，域名级过滤在路线图上</div>
          </div>

          <div className="setting-row">
            <div className="setting-row-main">
              <div className="setting-row-label">文件权限</div>
              <div className="setting-row-sub">
                {fs === "readonly" ? "注入 ls、read_file——可读不可写，无法交付产物文件"
                  : "注入 ls、read_file、write_file、str_replace——可产出交付物（路径锁在成员私有沙箱目录内）"}
              </div>
            </div>
            <div className="setting-row-ctl">
              <div className="seg-ctl">
                {([["readonly", "只读"], ["workspace", "读写工作区"]] as const).map(([v, label]) => (
                  <button key={v} type="button" className={fs === v ? "on" : ""}
                          onClick={() => { setFs(v); setDirty(true); }}>{label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className={`replbox ${repl ? "danger" : ""}`}>
            <div className="setting-row" style={{ border: "none", minHeight: 0, padding: 0 }}>
              <div className="setting-row-main">
                <div className="setting-row-label">代码执行（host bash）</div>
                <div className="setting-row-sub">在你的电脑上执行任意命令</div>
              </div>
              <div className="setting-row-ctl">
                <input type="checkbox" checked={repl}
                       onChange={(e) => { setRepl(e.target.checked); setDirty(true); }} />
              </div>
            </div>
            {repl && (
              <div className="perm-warn">
                ⚠ 这是实质上的总开关：有了 bash 就能联网（绕过禁网）、能读写任意文件（绕过只读）。
                harness 官方注明本地沙箱"不是安全边界"。强烈建议默认关闭，只对完全信任的成员单独放开。
              </div>
            )}
          </div>

          {dirty && (
            <div><button className="btn primary sm" onClick={save}>保存默认权限</button></div>
          )}
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </SectionCard>

      <SectionCard title="权限如何生效" subtitle="fail-closed"
        description="权限 = 注入什么工具，而不是拦截什么行为——不注入的能力对成员而言不存在">
        <SettingRow label="生效时机" sub="改动落名册即存档；对运行中的成员需停职 → 复岗重渲染后生效">
          <span className="tag">复岗生效</span>
        </SettingRow>
        <SettingRow label="调整入口" sub="「团队」页成员详情编辑，或私聊里让成员自改（仅私聊线程可用）">
          <span className="tag">按成员</span>
        </SettingRow>
        <SettingRow label="秘书" sub="系统组件权限固定（只读/禁网/无 bash），不随默认设置走">
          <span className="tag">固定</span>
        </SettingRow>
      </SectionCard>

      <SectionCard title={`成员权限总览 · ${org}`} subtitle={`${members.length} 名`}
        description="当前团队每名成员的实际权限；与默认不同的行有标记">
        {members.length === 0 ? (
          <div className="muted">当前团队还没有成员</div>
        ) : (
          <table className="perm-table">
            <thead>
              <tr><th>成员</th><th>外网</th><th>文件</th><th>代码执行</th><th></th></tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const s = permSummary(m.permissions);
                return (
                  <tr key={m.name}>
                    <td><b>{m.name}</b>{m.agent && <span className="mono muted" style={{ fontSize: 10, marginLeft: 5 }}>{m.agent}</span>}</td>
                    <td>{s.net}</td>
                    <td>{s.fs}</td>
                    <td>{s.repl
                      ? <span className="chip crit">开</span>
                      : <span className="muted">关</span>}</td>
                    <td>{differs(m.permissions) && <span className="chip warn" title="与默认权限不同">已定制</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="perm-hint" style={{ marginTop: 8 }}>
          调整某名成员：到「团队」页点击该成员打开详情编辑
        </div>
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

type Tab = "team" | "ai" | "general" | "perms";

const TEAM_TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "team", label: "团队信息", icon: "👥" },
  { key: "ai", label: "AI 配置", icon: "🤖" },
];
const SYSTEM_TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "general", label: "通用", icon: "⚙️" },
  { key: "perms", label: "权限", icon: "🛡️" },
];

/** 设置主体（左导航 + 右内容）——弹窗与中间栏内联页共用。 */
function SettingsBody({ org, connected, scope, onOrgChanged }: {
  org: string; connected: boolean; scope: "team" | "system"; onOrgChanged?: () => void;
}) {
  const tabs = scope === "team" ? TEAM_TABS : SYSTEM_TABS;
  const [tab, setTab] = useState<Tab>(tabs[0].key);
  useEffect(() => { setTab(tabs[0].key); }, [scope]);
  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {tabs.map((t) => (
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
        {tab === "team" && <TeamInfoTab org={org} onOrgChanged={onOrgChanged} />}
        {tab === "general" && <GeneralTab />}
        {tab === "perms" && <PermissionsTab org={org} />}
        {tab === "ai" && <AiTab org={org} />}
      </div>
    </div>
  );
}

/** 团队设置：内联在中间栏（与聊天/组织/市场等同级页面），带页头。 */
export function SettingsPanel({ org, connected, onOrgChanged }: {
  org: string; connected: boolean; onOrgChanged?: () => void;
}) {
  return (
    <div className="settings-page">
      <div className="gchead" data-tauri-drag-region>
        <div>
          <b>团队设置 · {org}</b>
          <div className="gcsub">团队信息与 AI 配置——只作用于当前团队</div>
        </div>
      </div>
      <SettingsBody org={org} connected={connected} scope="team" onOrgChanged={onOrgChanged} />
    </div>
  );
}

/** 系统设置：仍为弹窗（左栏底部固定入口触发）。 */
export function SettingsModal({ org, open, connected, scope, onClose, onOrgChanged }: {
  org: string; open: boolean; connected: boolean;
  scope: "team" | "system";
  onClose: () => void; onOrgChanged?: () => void;
}) {
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
          <span className="settings-modal-title">{scope === "team" ? `团队设置 · ${org}` : "系统设置"}</span>
          <button className="func-close" onClick={onClose} title="关闭 (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="settings-modal-body">
          <SettingsBody org={org} connected={connected} scope={scope} onOrgChanged={onOrgChanged} />
        </div>
      </div>
    </div>
  );
}
