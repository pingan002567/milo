import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { buildTurns, TurnList } from "./Conversation";

/**
 * 秘书对话页——会话形态对齐 DeerFlow 官方前端（与成员私聊共用 Conversation 组件）。
 * 对话即特殊任务群（group_id=secretary）：历史走群接口，实时走 WS（App 转入）。
 */
export function SecretaryView({ org, liveEvents }: { org: string; liveEvents: MiloEvent[] }) {
  const [history, setHistory] = useState<MiloEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    setHistory([]);
    api.group(org, "secretary")
      .then((d) => setHistory(d.events))
      .catch(() => setHistory([]));
  }, [org]);

  const events = useMemo(() => {
    const seen = new Set<string>();
    const all: MiloEvent[] = [];
    for (const e of [...history, ...liveEvents]) {
      if (seen.has(e.event_id) || e.group_id !== "secretary") continue;
      seen.add(e.event_id);
      if (e.type === "chat" || e.type === "status") all.push(e);
    }
    return all;
  }, [history, liveEvents]);

  const turns = useMemo(() => buildTurns(events), [events]);
  // 末回合是 thinking = 对方正在跑：此时发送键变「停止」
  const streaming = turns.length > 0 && turns[turns.length - 1].kind === "thinking";

  const stop = async () => {
    await api.stopTurn(org).catch(() => {});
  };

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns.length,
    turns[turns.length - 1]?.kind === "thinking"
      ? (turns[turns.length - 1] as any).reasoning.length : 0]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput(""); setSending(true);
    try {
      await api.secretaryChat(org, text);
    } catch (e: any) {
      setHistory((prev) => [...prev, {
        event_id: `local-${Date.now()}`, group_id: "secretary", type: "chat",
        actor: "system", ts: new Date().toISOString(),
        payload: { text: `（发送失败：${String(e?.message ?? e).slice(0, 120)}）` },
      } as MiloEvent]);
    } finally { setSending(false); }
  };

  return (
    <div className="secpage">
      <div className="gchead" data-tauri-drag-region>
        <div>
          <b>秘书</b>
          <div className="gcsub">你的系统操作面：问团队、看进展、派活，都在这里说</div>
        </div>
      </div>

      <div className="dfmsgs secmsgs">
        {turns.length === 0 && (
          <div className="card" style={{ padding: 18, maxWidth: 640 }}>
            <div style={{ marginBottom: 6 }}>我是你的秘书，可以直接吩咐：</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              「团队现在谁在忙？」<br />
              「写一个 CSV 去重脚本，写完让评审员把关」<br />
              「市场里有哪些前端模板？帮我下载一个」<br />
              「有什么在等我拍板的事？」
            </div>
          </div>
        )}
        <TurnList turns={turns} onRate={(eid, r) => api.feedback(org, "secretary", eid, r).catch(() => {})} />
        <div ref={endRef} />
      </div>

      {files.length > 0 && (
        <div className="attachbar">
          {files.map((f, i) => (
            <span key={i} className="chip">
              📎 {f.name}
              <button className="capx" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer seccomposer"
           onDragOver={(e) => e.preventDefault()}
           onDrop={(e) => {
             e.preventDefault();
             setFiles([...files, ...Array.from(e.dataTransfer.files)]);
           }}>
        <input placeholder="跟秘书说点什么…（Enter 发送）" value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && send()} />
        {streaming ? (
          <button className="btn stopbtn" onClick={stop} title="停止当前回合">■ 停止</button>
        ) : (
          <button className="btn primary" disabled={sending || !input.trim()} onClick={send}>
            {sending ? "发送中…" : "发送"}
          </button>
        )}
      </div>
    </div>
  );
}
