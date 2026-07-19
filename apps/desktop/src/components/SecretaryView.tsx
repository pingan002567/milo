import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { Md } from "./Md";

/**
 * 秘书对话页（秘书Agent设计 §五）：完整对话流 + 常驻输入框。
 * 对话即特殊任务群（group_id=secretary）：历史走群接口，实时走 WS（App 转入）。
 * status 流合并为"正在输入"，交付/请示翻译层已折算成 chat（desk._pump）。
 */
export function SecretaryView({ org, liveEvents }: { org: string; liveEvents: MiloEvent[] }) {
  const [history, setHistory] = useState<MiloEvent[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.group(org, "secretary")
      .then((d) => setHistory(d.events))
      .catch(() => setHistory([]));
  }, [org]);

  // 历史 + 实时合流（按 event_id 去重）；只保留对话相关事件
  const events = useMemo(() => {
    const seen = new Set<string>();
    const all: MiloEvent[] = [];
    for (const e of [...history, ...liveEvents]) {
      if (seen.has(e.event_id)) continue;
      seen.add(e.event_id);
      if (e.type === "chat" || e.type === "status") all.push(e);
    }
    return all;
  }, [history, liveEvents]);

  // 末尾的连续 status = 秘书正在组织语言；其余 status 折叠不显示（过程噪音）
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
      await api.secretaryChat(org, text);
    } catch (e: any) {
      setHistory((prev) => [...prev, {
        event_id: `local-${Date.now()}`, group_id: "secretary", type: "system",
        actor: "system", ts: new Date().toISOString(),
        payload: { msg: `发送失败：${String(e?.message ?? e).slice(0, 120)}` },
      } as MiloEvent]);
    } finally { setSending(false); }
  };

  return (
    <div className="secpage">
      <div className="gchead">
        <div>
          <b>秘书</b>
          <div className="gcsub">你的系统操作面：问团队、看进展、派活，都在这里说</div>
        </div>
      </div>

      <div className="msgs secmsgs">
        {msgs.length === 0 && !typing && (
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
        {msgs.map((e) => (
          <div key={e.event_id} className="msg">
            <span className={`ava ${e.actor === "secretariat" ? "s" : "o"}`}>
              {e.actor === "secretariat" ? "秘" : "你"}
            </span>
            <div className="mb">
              <div className="mh">
                {e.actor === "secretariat" ? "秘书" : "你"} · {e.ts.slice(11, 19)}
              </div>
              <div className="mx">
                <Md text={String(e.payload?.text ?? e.content ?? "")} />
              </div>
            </div>
          </div>
        ))}
        {typing && (
          <div className="msg">
            <span className="ava s">秘</span>
            <div className="mb">
              <div className="mh">秘书 · 正在处理…</div>
              <div className="mx dim">{typing.slice(-160)}</div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer seccomposer">
        <input placeholder="跟秘书说点什么…（Enter 发送）" value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn primary" disabled={sending || !input.trim()} onClick={send}>
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}
