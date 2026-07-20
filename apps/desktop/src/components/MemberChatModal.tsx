import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { buildTurns, TurnList } from "./Conversation";

/**
 * 成员私聊——全权调教通道（用户决策：私聊里不设任何限制）。
 * 会话形态对齐 DeerFlow 官方前端（与秘书页共用 Conversation 组件）。
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

  const turns = useMemo(() => buildTurns(events), [events]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns.length,
    turns[turns.length - 1]?.kind === "thinking"
      ? (turns[turns.length - 1] as any).reasoning.length : 0]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput(""); setSending(true);
    try {
      await api.memberDM(org, member, text);
    } catch (e: any) {
      setHistory((prev) => [...prev, {
        event_id: `local-${Date.now()}`, group_id: gid, type: "chat",
        actor: "system", ts: new Date().toISOString(),
        payload: { text: `（发送失败：${String(e?.message ?? e).slice(0, 120)}）` },
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

      <div className="dfmsgs secmsgs">
        {turns.length === 0 && (
          <div className="card" style={{ padding: 18, maxWidth: 640 }}>
            <div style={{ marginBottom: 6 }}>这是你和 {member} 的私聊：</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              「介绍一下你自己和你的工作方式」<br />
              「以后写代码注释一律用中文，把这条写进你的人设」<br />
              「把你的描述改成'专注数据管道的后端'」
            </div>
          </div>
        )}
        <TurnList turns={turns} />
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
