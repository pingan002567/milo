import { useEffect, useMemo, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import {
  buildTurns, ChatComposer, ChatHeader, OfficialConversation, Suggestions, TurnList,
} from "./Conversation";

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
      <ChatHeader
        name={member}
        title={`私聊 · ${member}`}
        subtitle="调教通道：考察、立规矩、让它自改人设与档案——不设限制"
        onReset={async () => {
          if (!window.confirm("清空这个对话的历史？成员的人设与档案不受影响。")) return;
          await api.resetConversation(org, member).catch(() => {});
          setHistory([]);
        }} />

      <div className="dfmsgs secmsgs">
        <OfficialConversation>
          {turns.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-title">这是你和 {member} 的私聊</div>
              <div className="chat-empty-sub">立规矩、改人设、派活——这里不设限制。试试：</div>
              <Suggestions items={["介绍一下你自己和你的工作方式", "以后写代码注释一律用中文，写进你的人设"]} onPick={(s) => setInput(s)} />
            </div>
          )}
          <TurnList turns={turns} onRate={(eid, r) => api.feedback(org, gid, eid, r).catch(() => {})} />
        </OfficialConversation>
      </div>

      <ChatComposer
        value={input} onChange={setInput}
        onSend={send} onStop={stop}
        streaming={streaming} sending={sending}
        placeholder={`跟 ${member} 说点什么…（Enter 发送，Shift+Enter 换行）`}
        files={files} onFiles={setFiles} />
    </div>
  );
}
