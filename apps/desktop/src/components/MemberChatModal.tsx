import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MiloEvent } from "../lib/api";
import { Md } from "./Md";

/**
 * 成员私聊——会话形态对齐 DeerFlow 官方前端（ai-elements/message + reasoning）：
 * 无头像；用户消息右对齐灰气泡、纯文本 verbatim（官方注释：输入不是 Markdown，
 * 按 MD 解析会毁掉粘贴的代码/日志）；成员消息全宽 Markdown 文档流；
 * 思考过程 = 🧠 折叠条（流式时 "思考中…(Ns)" 计时，完成后 "思考了 N 秒"可展开）；
 * 悬停浮出复制按钮。
 *
 * 数据映射：owner chat → user；member chat → assistant；
 * 回复前累积的 status（trace 流）→ 该回复的 reasoning 块。
 */

type Turn =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; reasoning: string; seconds: number | null }
  | { kind: "thinking"; key: string; reasoning: string; startTs: string };

function buildTurns(events: MiloEvent[]): Turn[] {
  const turns: Turn[] = [];
  let buf = "";
  let bufStart: string | null = null;
  for (const e of events) {
    if (e.type === "status") {
      if (!buf) bufStart = e.ts;
      buf += String(e.payload?.doing ?? e.content ?? "");
      continue;
    }
    if (e.type !== "chat") continue;
    const text = String(e.payload?.text ?? e.content ?? "");
    if (e.actor === "owner") {
      buf = ""; bufStart = null; // 用户发言重置思考缓冲
      turns.push({ kind: "user", key: e.event_id, text });
    } else {
      const seconds = bufStart
        ? Math.max(1, Math.round((Date.parse(e.ts) - Date.parse(bufStart)) / 1000))
        : null;
      turns.push({ kind: "assistant", key: e.event_id, text, reasoning: buf, seconds });
      buf = ""; bufStart = null;
    }
  }
  if (buf) {
    turns.push({ kind: "thinking", key: "live", reasoning: buf, startTs: bufStart! });
  }
  return turns;
}

/** 🧠 思考条：官方 Reasoning 形态（trigger + 可折叠 muted 正文）。 */
function ReasoningBlock({ reasoning, seconds, streaming }: {
  reasoning: string; seconds: number | null; streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [streaming]);

  return (
    <div className="reason">
      <button className="reason-trigger" onClick={() => reasoning && setOpen(!open)}>
        <span className="reason-brain">🧠</span>
        {streaming ? (
          <span className="shimmer">思考中…（{elapsed}s）</span>
        ) : (
          <span>思考了 {seconds ?? "几"} 秒</span>
        )}
        {reasoning && <span className={`reason-chevron ${open ? "open" : ""}`}>⌄</span>}
      </button>
      {(open || streaming) && reasoning && (
        <div className="reason-content">{reasoning.slice(-2000)}</div>
      )}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="msgcopy" title="复制"
            onClick={() => {
              navigator.clipboard?.writeText(text).then(() => {
                setDone(true); setTimeout(() => setDone(false), 1200);
              });
            }}>
      {done ? "✓ 已复制" : "复制"}
    </button>
  );
}

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
    turns[turns.length - 1]?.kind === "thinking" ? (turns[turns.length - 1] as any).reasoning.length : 0]);

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
        {turns.map((t) => {
          if (t.kind === "user") {
            return (
              <div key={t.key} className="dfmsg user">
                <div className="dfbubble">{t.text}</div>
              </div>
            );
          }
          if (t.kind === "thinking") {
            return (
              <div key={t.key} className="dfmsg assistant">
                <ReasoningBlock reasoning={t.reasoning} seconds={null} streaming />
              </div>
            );
          }
          return (
            <div key={t.key} className="dfmsg assistant">
              {t.reasoning && (
                <ReasoningBlock reasoning={t.reasoning} seconds={t.seconds} streaming={false} />
              )}
              <div className="dfcontent">
                <Md text={t.text} />
              </div>
              <div className="dftoolbar"><CopyBtn text={t.text} /></div>
            </div>
          );
        })}
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
