import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { Md } from "./Md";

/**
 * 成员私聊弹窗——全权调教通道（用户决策：私聊里不设任何限制）。
 * 你在这里说的指示，成员可据此修改自己的人设/描述/能力/权限
 * （自改工具带线程门禁：只在私聊线程可用，任务中被注入也无法自改）。
 * 会话即特殊群 dm-<name>：历史走群接口，实时走 WS（App 转入）。
 */
export function MemberChatModal({ org, member, liveEvents, onClose }: {
  org: string; member: string; liveEvents: MiloEvent[]; onClose: () => void;
}) {
  const [history, setHistory] = useState<MiloEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const gid = `dm-${member}`;

  useEffect(() => {
    api.group(org, gid).then((d) => setHistory(d.events)).catch(() => setHistory([]));
  }, [org, gid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const events = useMemo(() => {
    const seen = new Set<string>();
    const all: MiloEvent[] = [];
    for (const e of [...history, ...liveEvents]) {
      if (seen.has(e.event_id) || e.group_id !== gid) continue;
      seen.add(e.event_id);
      if (e.type === "chat" || e.type === "status") all.push(e);
    }
    return all;
  }, [history, liveEvents, gid]);

  const { msgs, typing } = useMemo(() => {
    const msgs = events.filter((e) => e.type === "chat");
    let typing = "";
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "chat") break;
      if (e.type === "status") typing = String(e.payload?.doing ?? e.content ?? "") + typing;
    }
    return { msgs, typing };
  }, [events]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); },
    [msgs.length, typing.length > 0]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput(""); setSending(true);
    try {
      await api.memberDM(org, member, text);
    } catch (e: any) {
      setHistory((prev) => [...prev, {
        event_id: `local-${Date.now()}`, group_id: gid, type: "system",
        actor: "system", ts: new Date().toISOString(),
        payload: { msg: `发送失败：${String(e?.message ?? e).slice(0, 120)}` },
      } as MiloEvent]);
    } finally { setSending(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal member-modal dmmodal" role="dialog" aria-modal="true">
        <div className="settings-modal-head">
          <span className="settings-modal-title">私聊 · {member}</span>
          <span className="setting-card-badge" style={{ marginLeft: 10 }}>调教通道 · 可让其自改人设/档案</span>
          <button className="func-close" onClick={onClose} title="关闭 (Esc)" style={{ marginLeft: "auto" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="dmbody">
          <div className="msgs dmmsgs">
            {msgs.length === 0 && !typing && (
              <div className="muted" style={{ padding: 16, fontSize: 12.5, lineHeight: 1.9 }}>
                这是你和 {member} 的私聊——考察它、给它立规矩，都在这里说：<br />
                「介绍一下你自己和你的工作方式」<br />
                「以后写代码注释一律用中文，把这条写进你的人设」<br />
                「把你的描述改成'专注数据管道的后端'」
              </div>
            )}
            {msgs.map((e) => (
              <div key={e.event_id} className="msg">
                <span className={`ava ${e.actor === "owner" ? "o" : ""}`}>
                  {e.actor === "owner" ? "你" : member.slice(0, 1).toUpperCase()}
                </span>
                <div className="mb">
                  <div className="mh">{e.actor === "owner" ? "你" : member} · {e.ts.slice(11, 19)}</div>
                  <div className="mx"><Md text={String(e.payload?.text ?? e.content ?? "")} /></div>
                </div>
              </div>
            ))}
            {typing && (
              <div className="msg">
                <span className="ava">{member.slice(0, 1).toUpperCase()}</span>
                <div className="mb">
                  <div className="mh">{member} · 正在输入…</div>
                  <div className="mx dim">{typing.slice(-160)}</div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="composer dmcomposer">
            <input placeholder={`跟 ${member} 说点什么…（Enter 发送）`} value={input}
                   onChange={(e) => setInput(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="btn primary" disabled={sending || !input.trim()} onClick={send}>
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
