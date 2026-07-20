import { useEffect, useState } from "react";
import type { MiloEvent } from "../lib/api";
import { Md } from "./Md";

/**
 * 会话渲染共享件——对齐 DeerFlow 官方前端（ai-elements/message + reasoning）。
 * 秘书页与成员私聊共用：无头像；用户右对齐灰气泡纯文本；助手全宽 Markdown；
 * 🧠 思考条（流式 shimmer 计时 → "思考了 N 秒"可展开）；悬停复制。
 */

export type Turn =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; reasoning: string; seconds: number | null }
  | { kind: "thinking"; key: string; reasoning: string; startTs: string };

/** 事件流 → 回合：回复前累积的 status（trace 流）归组为该回复的思考块。 */
export function buildTurns(events: MiloEvent[]): Turn[] {
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
export function ReasoningBlock({ reasoning, seconds, streaming }: {
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

export function CopyBtn({ text }: { text: string }) {
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

/** 回合列表（官方 message 布局）。 */
export function TurnList({ turns }: { turns: Turn[] }) {
  return (
    <>
      {turns.map((t) => {
        if (t.kind === "user") {
          return (
            <div key={t.key} className="dfmsg user">
              <div className="dfbubble">{t.text}</div>
              <div className="dftoolbar"><CopyBtn text={t.text} /></div>
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
    </>
  );
}
