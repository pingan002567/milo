import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * 调教秘书：改它的人设。
 *
 * 秘书是**可塑不可换**的——人设归你（挡驾标准、汇报口径、说话方式本就该按人调），
 * 但工具面与权限由系统固定，也不能从市场换或辞退。
 *
 * 出厂基线只读：职责、信任边界、不可代答请示这些是制度不是偏好。
 * 你的指示追加在基线之后，保存即重启秘书生效（对话记忆保留）。
 */
export function SecretaryPersonaModal({ org, onClose, onReset }: {
  org: string; onClose: () => void; onReset?: () => void;
}) {
  const [baseline, setBaseline] = useState("");
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBase, setShowBase] = useState(false);
  // 默认勾选：实测不清历史时模型会照着前几轮的输出继续，新人设看不出效果
  const [resetToo, setResetToo] = useState(true);

  useEffect(() => {
    api.secretaryPersona(org)
      .then((d) => { setBaseline(d.baseline); setText(d.instructions); })
      .catch((e) => setMsg(`读取失败：${String(e?.message ?? e).slice(0, 120)}`))
      .finally(() => setLoaded(true));
  }, [org]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await api.saveSecretaryPersona(org, text, resetToo);
      setMsg(r.note);
      setDirty(false);
      if (r.reset) onReset?.();
    } catch (e: any) {
      setMsg(`保存失败：${String(e?.message ?? e).slice(0, 160)}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal member-modal" role="dialog" aria-modal="true">
        <div className="settings-modal-head">
          <span className="settings-modal-title">调教秘书</span>
          <span className="setting-card-badge" style={{ marginLeft: 10 }}>可塑不可换</span>
          <button className="func-close" onClick={onClose} title="关闭 (Esc)" style={{ marginLeft: "auto" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="settings-content" style={{ padding: 18 }}>
          {msg && <div className="card" style={{ padding: "8px 12px", marginBottom: 12, fontSize: 12.5 }}>{msg}</div>}

          <div className="setting-card">
            <div className="setting-card-head">
              <div className="setting-card-heading">
                <div className="setting-card-title">你的指示</div>
                <div className="setting-card-desc">
                  想让秘书怎么工作，直接写。什么时候该打扰你、汇报多细、说话风格、
                  你的偏好与禁忌——都会追加到它的人设里长期生效。
                </div>
              </div>
            </div>
            <div className="setting-card-body">
              <textarea
                className="setting-input" rows={12}
                style={{ width: "100%", resize: "vertical", lineHeight: 1.7, fontSize: 13 }}
                placeholder={"例如：\n- 汇报先给结论，细节我要问了再展开。\n- 只有真正要我拍板的才通知我，能自己查清的别问。\n- 派活前先把验收标准跟我确认一遍。"}
                value={text} disabled={!loaded}
                onChange={(e) => { setText(e.target.value); setDirty(true); }} />
            </div>
          </div>

          <div className="setting-card">
            <div className="setting-card-head">
              <div className="setting-card-heading">
                <div className="setting-card-title">出厂基线（只读）</div>
                <div className="setting-card-desc">
                  职责、信任边界、"成员请示只能你答"这些是制度不是偏好，改不了；
                  你的指示写在它之后。
                </div>
              </div>
              <button className="btn sm" onClick={() => setShowBase(!showBase)}>
                {showBase ? "收起" : "查看"}
              </button>
            </div>
            {showBase && (
              <div className="setting-card-body">
                <pre style={{
                  margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  fontSize: 12, lineHeight: 1.65, color: "var(--ink-3)",
                  maxHeight: 260, overflowY: "auto",
                }}>{baseline}</pre>
              </div>
            )}
          </div>

          <div className="muted" style={{ marginBottom: 14 }}>
            秘书自己没有改人设的工具——它要读市场描述、成员汇报这些不可信内容，
            自写人设会让一次注入变成长期污染。它可以建议，写入由你点。
          </div>

          <label className="rf" style={{ marginBottom: 10, cursor: "pointer", gap: 8 }}>
            <input type="checkbox" checked={resetToo}
                   onChange={(e) => { setResetToo(e.target.checked); setDirty(true); }} />
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              同时清空当前对话（建议）
              <span className="muted" style={{ marginLeft: 6 }}>
                不清的话它会照着前几轮的口径继续说，新人设看不出效果
              </span>
            </span>
          </label>

          <div className="rf">
            <button className="btn primary" disabled={!dirty || saving || !loaded} onClick={save}>
              {saving ? "保存中…" : "保存并让秘书重新上岗"}
            </button>
            <span className="muted">人设归你，工具面与权限由系统固定</span>
          </div>
        </div>
      </div>
    </div>
  );
}
