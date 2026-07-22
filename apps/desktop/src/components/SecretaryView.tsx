import { useEffect, useMemo, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import {
  buildTurns, ChatComposer, ChatHeader, OfficialConversation, Suggestions, TurnList,
} from "./Conversation";

/**
 * 秘书对话页——会话形态对齐 DeerFlow 官方前端（与成员私聊共用 Conversation 组件）。
 * 对话即特殊任务群（group_id=secretary）：历史走群接口，实时走 WS（App 转入）。
 */
export function SecretaryView({ org, liveEvents }: { org: string; liveEvents: MiloEvent[] }) {
  const [history, setHistory] = useState<MiloEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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
  const streaming = turns.length > 0 && turns[turns.length - 1].kind === "streaming";

  const stop = async () => {
    await api.stopTurn(org).catch(() => {});
  };

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
      <ChatHeader
        name="秘书" accent
        title="秘书"
        subtitle="你的系统操作面：问团队、看进展、派活，都在这里说"
        onReset={async () => {
          if (!window.confirm("清空这个对话的历史？成员的人设与档案不受影响。")) return;
          await api.resetConversation(org).catch(() => {});
          setHistory([]);
        }} />

      <div className="dfmsgs secmsgs">
        <OfficialConversation>
          {turns.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-title">我是你的秘书</div>
              <div className="chat-empty-sub">问团队、看进展、派活，直接吩咐。试试：</div>
              <Suggestions items={["团队现在谁在忙？", "有什么在等我拍板的事？", "市场里有哪些模板？"]} onPick={(s) => setInput(s)} />
            </div>
          )}
          <TurnList turns={turns} assistantName="秘书" assistantAccent
                    onRate={(eid, r) => api.feedback(org, "secretary", eid, r).catch(() => {})} />
        </OfficialConversation>
      </div>

      <ChatComposer
        value={input} onChange={setInput}
        onSend={send} onStop={stop}
        streaming={streaming} sending={sending}
        placeholder="跟秘书说点什么…（Enter 发送，Shift+Enter 换行）"
        files={files} onFiles={setFiles} />
    </div>
  );
}
