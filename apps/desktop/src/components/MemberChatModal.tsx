import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { buildTurns, Suggestions, TurnList, useStickToBottom } from "./Conversation";

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
  const [files, setFiles] = useState<File[]>([]);
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
  // 末回合是 thinking = 对方正在跑：此时发送键变「停止」
  const streaming = turns.length > 0 && turns[turns.length - 1].kind === "thinking";

  const stop = async () => {
    await api.stopTurn(org, member).catch(() => {});
  };

  // 贴底滚动：用户向上翻看历史时不再被强行拉回（官方 StickToBottom 语义）
  const { boxRef, atBottom, onScroll, scrollToBottom } = useStickToBottom(
    `${turns.length}:${turns[turns.length - 1]?.kind === "thinking"
      ? (turns[turns.length - 1] as any).reasoning.length : 0}`);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput(""); setSending(true);
    try {
      let atts: Array<{ name: string; uri: string }> = [];
      if (files.length) {
        atts = await Promise.all(files.map((f) => api.uploadFile(org, f)));
        setFiles([]);
      }
      await api.memberDM(org, member, text, atts.length ? atts : undefined);
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
      <div className="gchead" data-tauri-drag-region>
        <div>
          <b>私聊 · {member}</b>
          <div className="gcsub">调教通道：考察、立规矩、让它自改人设与档案——不设限制</div>
        </div>
      </div>

      <div className="dfmsgs secmsgs" ref={boxRef} onScroll={onScroll}>
        {turns.length === 0 && (
          <div className="card" style={{ padding: 18, maxWidth: 640 }}>
            <div style={{ marginBottom: 6 }}>这是你和 {member} 的私聊：</div>
            <Suggestions items={["介绍一下你自己和你的工作方式", "以后写代码注释一律用中文，写进你的人设"]} onPick={(s) => setInput(s)} />
          </div>
        )}
        <TurnList turns={turns} onRate={(eid, r) => api.feedback(org, gid, eid, r).catch(() => {})} />
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
      {!atBottom && (
        <button className="tobottom" onClick={scrollToBottom} title="回到底部">↓ 最新</button>
      )}
      <div className="composer seccomposer"
           onDragOver={(e) => e.preventDefault()}
           onDrop={(e) => {
             e.preventDefault();
             setFiles([...files, ...Array.from(e.dataTransfer.files)]);
           }}>
        <textarea className="composer-ta" rows={1}
               placeholder={`跟 ${member} 说点什么…（Enter 发送，Shift+Enter 换行）`} value={input}
               onChange={(e) => {
                 setInput(e.target.value);
                 const el = e.currentTarget;
                 el.style.height = "auto";
                 el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
               }}
               onKeyDown={(e) => {
                 // 官方键位：Enter 发送、Shift+Enter 换行；输入法组字中不拦截
                 if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                   e.preventDefault(); send();
                 }
               }} />
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
