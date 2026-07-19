import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { Md } from "./Md";

/**
 * 成员私聊——左栏常驻会话，主区对话形态（与秘书页一致）。
 * 全权调教通道（用户决策：私聊里不设任何限制）：你在这里的指示，
 * 成员可据此修改自己的人设/描述/能力/权限（自改工具带线程门禁，
 * 只在私聊线程可用——任务中被注入也无法自改）。
 * 会话即特殊群 dm-<name>：历史走群接口，实时走 WS（App 转入）。
 */
export function MemberChatView({ org, member, liveEvents }: {
  org: string; member: string; liveEvents: MiloEvent[];
}) {
  const [history, setHistory] = useState<MiloEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const gid = `dm-${member}`;

  useEffect(() => {
    setHistory([]);
    api.group(org, gid).then((d) => setHistory(d.events)).catch(() => setHistory([]));
  }, [org, gid]);

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
    <div className="secpage">
      <div className="gchead">
        <div>
          <b>私聊 · {member}</b>
          <div className="gcsub">调教通道：考察、立规矩、让它自改人设与档案——不设限制</div>
        </div>
      </div>

      <div className="msgs secmsgs">
        {msgs.length === 0 && !typing && (
          <div className="card" style={{ padding: 18, maxWidth: 640 }}>
            <div style={{ marginBottom: 6 }}>这是你和 {member} 的私聊：</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              「介绍一下你自己和你的工作方式」<br />
              「以后写代码注释一律用中文，把这条写进你的人设」<br />
              「把你的描述改成'专注数据管道的后端'」
            </div>
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

      <div className="composer seccomposer">
        <input placeholder={`跟 ${member} 说点什么…（Enter 发送）`} value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn primary" disabled={sending || !input.trim()} onClick={send}>
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
