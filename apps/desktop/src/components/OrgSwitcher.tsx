import { useEffect, useRef, useState } from "react";
import { api, type LibraryItem, type OrgSummary } from "../lib/api";

/**
 * 团队切换器（团队管理设计 §3.2）：下拉面板 + 跨团队待处理角标 + 新建入口。
 * 角标价值：你在 A 团队干活时，B 团队成员的请示不该失联。
 */
export function OrgSwitcher({ org, orgs, onSwitch, onCreated }: {
  org: string; orgs: OrgSummary[];
  onSwitch: (next: string) => void; onCreated: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cur = orgs.find((o) => o.org === org);
  const todo = (o: OrgSummary) => (o.pending ?? 0) + (o.review ?? 0);

  return (
    <div className="orgbox" ref={boxRef}>
      <button className="orgsel" onClick={() => setOpen(!open)} aria-label="切换团队">
        <span className={`odot ${cur?.open ? "on" : ""}`} />
        <span className="oname">{cur?.displayName ?? org}</span>
        <span className="muted" style={{ fontSize: 11 }}>{cur?.members ?? 0} 名</span>
        <span className="ochev">⌄</span>
      </button>

      {open && (
        <div className="orgmenu">
          {orgs.map((o) => (
            <button key={o.org} className={`orgitem ${o.org === org ? "on" : ""}`}
                    onClick={() => { setOpen(false); if (o.org !== org) onSwitch(o.org); }}>
              <span className={`odot ${o.open ? "on" : ""}`} />
              <span className="oname">{o.displayName ?? o.org}</span>
              <span className="muted" style={{ fontSize: 10.5 }}>{o.members} 名</span>
              {todo(o) > 0 && <span className="obdg">{todo(o)}</span>}
            </button>
          ))}
          <button className="orgitem newteam" onClick={() => { setOpen(false); setCreating(true); }}>
            ＋ 新建团队
          </button>
        </div>
      )}

      {creating && (
        <CreateTeamModal fromOrg={org} onClose={() => setCreating(false)}
                         onCreated={(slug) => { setCreating(false); onCreated(slug); }} />
      )}
    </div>
  );
}

/** 新建团队：显示名 + 模型绑定继承 + 可选首批成员（尽量少填）。 */
function CreateTeamModal({ fromOrg, onClose, onCreated }: {
  fromOrg: string; onClose: () => void; onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [lib, setLib] = useState<LibraryItem[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.library().then((r) => setLib(r.library)).catch(() => setLib([])); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // slug 自动推导（用户手改后不再覆盖）
  const autoSlug = (v: string) => {
    const s = v.trim().replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    return s || "";
  };

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.createOrg({
        displayName: name.trim(),
        slug: (slugTouched ? slug : autoSlug(name)) || undefined,
        from_org: fromOrg,
        members: picked,
      });
      onCreated(r.org);
    } catch (e: any) {
      setErr(String(e?.message ?? e).slice(0, 160));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal member-modal" role="dialog" aria-modal="true">
        <div className="settings-modal-head">
          <span className="settings-modal-title">新建团队</span>
          <button className="func-close" onClick={onClose} title="关闭 (Esc)" style={{ marginLeft: "auto" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="settings-content" style={{ padding: 18 }}>
          {err && <div className="card" style={{ padding: "8px 12px", marginBottom: 10, fontSize: 12.5, color: "var(--crit)" }}>{err}</div>}
          <div className="setting-card">
            <div className="setting-card-body" style={{ marginTop: 0, display: "grid", gap: 10 }}>
              <label>
                <span className="field-label">团队名（可用中文）</span>
                <input className="setting-input" autoFocus value={name}
                       placeholder="如：研发小队"
                       onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                <span className="field-label">
                  标识（目录名与接口路径，创建后不可改）
                </span>
                <input className="setting-input mono"
                       value={slugTouched ? slug : autoSlug(name)}
                       placeholder="dev-team"
                       onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} />
              </label>
              <div className="muted" style={{ fontSize: 11.5 }}>
                模型配置将继承当前团队（{fromOrg}），可在团队设置里单独调整。
              </div>
            </div>
          </div>

          <div className="setting-card">
            <div className="setting-card-head">
              <div className="setting-card-heading">
                <div className="setting-card-title">首批成员（可选）</div>
                <div className="setting-card-desc">从 Agent 库直接招募并入职，省去建完再招人</div>
              </div>
            </div>
            <div className="setting-card-body">
              {lib.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>Agent 库是空的——可稍后到市场下载</div>
              ) : lib.map((it) => (
                <label key={it.ref} className="pickrow">
                  <input type="checkbox" checked={picked.includes(it.ref)}
                         onChange={(e) => setPicked(e.target.checked
                           ? [...picked, it.ref] : picked.filter((x) => x !== it.ref))} />
                  <b>{it.name ?? it.ref}</b>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {(it.capabilities ?? []).join("、")}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>
            {busy ? "创建中…" : "创建并切换过去"}
          </button>
        </div>
      </div>
    </div>
  );
}
