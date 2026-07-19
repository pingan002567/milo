import { useState } from "react";
import { api, type Permissions, type RosterMember } from "../lib/api";

/**
 * 成员详情弹窗（§3.5 修正：实例化后与模板脱钩，配置归实例所有可编辑）。
 * 可编辑：名字（仅未运行）、描述、能力、权限；模板来源只是履历（只读）。
 * 能力/权限改动对运行中实例需停职→复岗生效（后端 note 会提示）。
 */
export function MemberModal({ org, member, onClose, onSaved }: {
  org: string; member: RosterMember; onClose: () => void; onSaved: () => void;
}) {
  const m = member;
  const [name, setName] = useState(m.name);
  const [desc, setDesc] = useState(m.description ?? "");
  const [caps, setCaps] = useState<string[]>(m.capabilities ?? []);
  const [capInput, setCapInput] = useState("");
  const [net, setNet] = useState((m.permissions?.network ?? []).join(", "));
  const [fs, setFs] = useState<string>(m.permissions?.filesystem ?? "workspace");
  const [repl, setRepl] = useState(Boolean(m.permissions?.python_repl));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const addCap = () => {
    const v = capInput.trim();
    if (v && !caps.includes(v)) setCaps([...caps, v]);
    setCapInput("");
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const permissions: Permissions = {
        network: net.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        filesystem: fs,
        python_repl: repl,
      };
      const patch: any = { description: desc, capabilities: caps, permissions };
      if (name.trim() !== m.name) patch.new_name = name.trim();
      const r = await api.updateMember(org, m.name, patch);
      setMsg(r.note);
      onSaved();
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 140)}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal member-modal" role="dialog" aria-modal="true">
        <div className="settings-modal-head">
          <span className="settings-modal-title">成员 · {m.name}</span>
          {m.agent && <span className="setting-card-badge" style={{ marginLeft: 10 }}>出厂模板 {m.agent}</span>}
          <button className="func-close" onClick={onClose} title="关闭 (Esc)" style={{ marginLeft: "auto" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="settings-content" style={{ padding: 18 }}>
          {msg && <div className="card" style={{ padding: "8px 12px", marginBottom: 12, fontSize: 12.5 }}>{msg}</div>}

          <div className="setting-card">
            <div className="setting-card-head">
              <div className="setting-card-heading">
                <div className="setting-card-title">基本信息</div>
                <div className="setting-card-desc">实例化后配置归成员本人所有；模板只是出厂来源</div>
              </div>
            </div>
            <div className="setting-card-body" style={{ display: "grid", gap: 10 }}>
              <label>
                <span className="field-label">
                  名字{m.loaded && <span className="muted">（运行中不可改名，先停职）</span>}
                </span>
                <input className="setting-input" value={name} disabled={Boolean(m.loaded)}
                       onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                <span className="field-label">描述 / 岗位说明（秘书派活时会参考）</span>
                <input className="setting-input" value={desc}
                       onChange={(e) => setDesc(e.target.value)} placeholder="这名成员负责什么…" />
              </label>
            </div>
          </div>

          <div className="setting-card">
            <div className="setting-card-head">
              <div className="setting-card-heading">
                <div className="setting-card-title">能力</div>
                <div className="setting-card-desc">派单路由的依据——秘书按能力精确匹配成员</div>
              </div>
            </div>
            <div className="setting-card-body">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {caps.map((c) => (
                  <span key={c} className="chip">
                    {c}
                    <button className="capx" title="移除能力"
                            onClick={() => setCaps(caps.filter((x) => x !== c))}>×</button>
                  </span>
                ))}
                {caps.length === 0 && <span className="muted">没有能力声明——将无法被派单</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="setting-input" style={{ flex: 1 }} value={capInput}
                       placeholder="新增能力 ID，如 data-analysis"
                       onChange={(e) => setCapInput(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && addCap()} />
                <button className="btn sm" onClick={addCap} disabled={!capInput.trim()}>添加</button>
              </div>
            </div>
          </div>

          <div className="setting-card">
            <div className="setting-card-head">
              <div className="setting-card-heading">
                <div className="setting-card-title">权限</div>
                <div className="setting-card-desc">运行时硬边界：不注入的工具，成员想越权也执行不了</div>
              </div>
            </div>
            <div className="setting-card-body" style={{ display: "grid", gap: 10 }}>
              <label>
                <span className="field-label">外网域名白名单（逗号分隔；留空 = 禁外网）</span>
                <input className="setting-input" value={net}
                       onChange={(e) => setNet(e.target.value)} placeholder="如 *.arxiv.org" />
              </label>
              <div className="setting-row">
                <div className="setting-row-main"><div className="setting-row-label">文件权限</div></div>
                <div className="setting-row-ctl">
                  <div className="seg-ctl">
                    {([["readonly", "只读"], ["workspace", "读写工作区"]] as const).map(([v, label]) => (
                      <button key={v} type="button" className={fs === v ? "on" : ""}
                              onClick={() => setFs(v)}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="setting-row">
                <div className="setting-row-main">
                  <div className="setting-row-label">代码执行（host bash）</div>
                  <div className="setting-row-sub">在本机执行命令——只给完全信任的成员</div>
                </div>
                <div className="setting-row-ctl">
                  <input type="checkbox" checked={repl} onChange={(e) => setRepl(e.target.checked)} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn primary" disabled={saving} onClick={save}>
              {saving ? "保存中…" : "保存"}
            </button>
            {m.loaded && <span className="muted" style={{ fontSize: 12 }}>能力/权限改动需停职→复岗生效</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
