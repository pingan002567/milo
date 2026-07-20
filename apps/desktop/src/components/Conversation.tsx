import { useCallback, useEffect, useRef, useState } from "react";
import type { MiloEvent } from "../lib/api";
import { Md } from "./Md";

/**
 * 会话渲染共享件——对齐 DeerFlow 官方前端（ai-elements/message + reasoning）。
 * 秘书页与成员私聊共用：无头像；用户右对齐灰气泡纯文本；助手全宽 Markdown；
 * 🧠 思考条（流式 shimmer 计时 → "思考了 N 秒"可展开）；悬停复制。
 */

export type Turn =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; reasoning: string; seconds: number | null;
      tokens?: number | null; todos?: Array<{ content: string; status: string }> }
  | { kind: "thinking"; key: string; reasoning: string; startTs: string };

/**
 * 贴底滚动（借鉴官方 ai-elements/conversation 的 StickToBottom 语义）：
 * 只在用户本来就在底部时才跟随新内容；用户向上翻看历史时**不再强行拉回**，
 * 改为浮出「回到底部」。此前是无条件 scrollIntoView——流式输出时想往上看
 * 历史会被不停拽回来。
 */
export function useStickToBottom(dep: unknown) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [dep, atBottom]);

  const scrollToBottom = useCallback(() => {
    const el = boxRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
  }, []);

  return { boxRef, atBottom, onScroll, scrollToBottom };
}

/** 空态建议（官方 suggestion 形态）：点一下即发，不用手打。 */
export function Suggestions({ items, onPick }: {
  items: string[]; onPick: (s: string) => void;
}) {
  return (
    <div className="suggests">
      {items.map((s) => (
        <button key={s} className="suggest" onClick={() => onPick(s)}>{s}</button>
      ))}
    </div>
  );
}

/** TODO 清单（harness TodoMiddleware 的 write_todos 产物）：把一团思考变成可勾选计划。 */
export function TodoPanel({ todos }: { todos: Array<{ content: string; status: string }> }) {
  const [open, setOpen] = useState(true);
  const done = todos.filter((t) => ["completed", "done"].includes(t.status)).length;
  return (
    <div className="todopanel">
      <button className="todohead" onClick={() => setOpen(!open)}>
        <span>📋 计划 {done}/{todos.length}</span>
        <span className={`reason-chevron ${open ? "open" : ""}`}>⌄</span>
      </button>
      {open && (
        <ul className="todolist">
          {todos.map((t, i) => {
            const st = ["completed", "done"].includes(t.status) ? "done"
              : ["in_progress", "running"].includes(t.status) ? "doing" : "todo";
            return (
              <li key={i} className={st}>
                <span className="tdmark">{st === "done" ? "✓" : st === "doing" ? "▸" : "○"}</span>
                {t.content}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 引用来源：成员联网检索后正文里的 [citation:标题](url) 抽成来源卡。 */
function extractCitations(text: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const re = /\[citation:([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!out.some((x) => x.url === m![2])) out.push({ label: m[1], url: m[2] });
  }
  return out;
}

/** 事件流 → 回合：回复前累积的 status（trace 流）归组为该回复的思考块。 */
export function buildTurns(events: MiloEvent[]): Turn[] {
  const turns: Turn[] = [];
  let buf = "";
  let bufStart: string | null = null;
  let todos: Array<{ content: string; status: string }> | undefined;
  let tokens: number | null | undefined;
  for (const e of events) {
    if (e.type === "system") {
      if (typeof e.payload?.tokens === "number") tokens = e.payload.tokens;
      continue;
    }
    if (e.type === "status") {
      if (e.payload?.kind === "todo" && Array.isArray(e.payload.todos)) {
        todos = e.payload.todos;   // 后到的覆盖：TODO 是状态快照不是流水
        continue;
      }
      if (e.payload?.kind === "subagent") continue;  // 子代理进度并入动作行，不入思考块
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
      turns.push({ kind: "assistant", key: e.event_id, text, reasoning: buf, seconds,
                   tokens, todos });
      buf = ""; bufStart = null; todos = undefined; tokens = undefined;
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

/** 消息级反馈：私聊调教时的最自然信号（官方 feedback 形态）。 */
export function FeedbackBtns({ onRate }: { onRate: (r: number) => void }) {
  const [rating, setRating] = useState(0);
  const click = (r: number) => { const v = rating === r ? 0 : r; setRating(v); onRate(v); };
  return (
    <>
      <button className={`msgcopy fb ${rating === 1 ? "on" : ""}`} title="好评"
              onClick={() => click(1)}>👍</button>
      <button className={`msgcopy fb ${rating === -1 ? "on" : ""}`} title="差评"
              onClick={() => click(-1)}>👎</button>
    </>
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
export function TurnList({ turns, onRate }: {
  turns: Turn[]; onRate?: (eventId: string, rating: number) => void;
}) {
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
        const cites = extractCitations(t.text);
        return (
          <div key={t.key} className="dfmsg assistant">
            {t.reasoning && (
              <ReasoningBlock reasoning={t.reasoning} seconds={t.seconds} streaming={false} />
            )}
            {t.todos && t.todos.length > 0 && <TodoPanel todos={t.todos} />}
            <div className="dfcontent">
              <Md text={t.text} />
            </div>
            {cites.length > 0 && (
              <div className="cites">
                {cites.map((c, i) => (
                  <a key={i} className="cite" href={c.url} target="_blank" rel="noreferrer"
                     title={c.url}>🔗 {c.label.slice(0, 28)}</a>
                ))}
              </div>
            )}
            <div className="dftoolbar">
              <CopyBtn text={t.text} />
              {onRate && <FeedbackBtns onRate={(r) => onRate(t.key, r)} />}
              {typeof t.tokens === "number" && (
                <span className="tokens">{t.tokens.toLocaleString()} tokens</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
