import { useState } from "react";
import type { MiloEvent } from "../lib/api";
import {
  Conversation as DFConversation, ConversationContent, ConversationScrollButton,
} from "./ai-elements/conversation";
import {
  ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep,
} from "./ai-elements/chain-of-thought";
import { Message, MessageContent, MessageToolbar } from "./ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai-elements/reasoning";
import { Sources, SourcesContent, SourcesTrigger, Source } from "./ai-elements/sources";
import { ChevronDownIcon } from "lucide-react";
import { Md } from "./Md";

/**
 * 会话渲染共享件——**代码级复用 DeerFlow 官方 ai-elements 组件**
 * （Message / Reasoning / Conversation，MIT License，见 /NOTICE）。
 * 秘书页与成员私聊共用；Milo 扩展（TODO/引用/用量/反馈）挂在官方组件上。
 */

export type Turn =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; reasoning: string; seconds: number | null;
      tokens?: number | null; todos?: Array<{ content: string; status: string }> }
  | { kind: "thinking"; key: string; reasoning: string; startTs: string };

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

/**
 * TODO 计划（harness write_todos 产物）——用官方 ChainOfThought 思维链组件渲染：
 * 每个 TODO 项 = 一个 Step，状态映射 completed→complete / in_progress→active /
 * pending→pending（与官方 Step 的三态语义一致）。
 */
export function TodoPanel({ todos }: { todos: Array<{ content: string; status: string }> }) {
  const done = todos.filter((t) => ["completed", "done"].includes(t.status)).length;
  const stepStatus = (s: string): "complete" | "active" | "pending" =>
    ["completed", "done"].includes(s) ? "complete"
      : ["in_progress", "running"].includes(s) ? "active" : "pending";
  return (
    <ChainOfThought defaultOpen className="mb-2">
      <ChainOfThoughtHeader>计划 {done}/{todos.length}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {todos.map((t, i) => (
          <ChainOfThoughtStep key={i} label={t.content} status={stepStatus(t.status)} />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
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

/**
 * 思考块——直接用官方 Reasoning/ReasoningTrigger/ReasoningContent 组件
 * （流式默认展开、完成后 1s 自动收起、LiveTimer 计时全由官方组件实现）。
 */
export function ReasoningBlock({ reasoning, seconds, streaming }: {
  reasoning: string; seconds: number | null; streaming: boolean;
}) {
  return (
    <Reasoning isStreaming={streaming} duration={seconds ?? undefined}
               className="text-sm">
      <ReasoningTrigger hasContent={!!reasoning} />
      {reasoning && <ReasoningContent>{reasoning.slice(-2000)}</ReasoningContent>}
    </Reasoning>
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

/** 回合列表——用官方 Message/MessageContent 原语，Milo 扩展挂在其上。 */
export function TurnList({ turns, onRate }: {
  turns: Turn[]; onRate?: (eventId: string, rating: number) => void;
}) {
  return (
    <>
      {turns.map((t) => {
        if (t.kind === "user") {
          return (
            <Message key={t.key} from="user" className="group/msg">
              <MessageContent>{t.text}</MessageContent>
              <MessageToolbar className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <CopyBtn text={t.text} />
              </MessageToolbar>
            </Message>
          );
        }
        if (t.kind === "thinking") {
          return (
            <Message key={t.key} from="assistant">
              <MessageContent>
                <ReasoningBlock reasoning={t.reasoning} seconds={null} streaming />
              </MessageContent>
            </Message>
          );
        }
        const cites = extractCitations(t.text);
        return (
          <Message key={t.key} from="assistant" className="group/msg">
            <MessageContent>
              {t.reasoning && (
                <ReasoningBlock reasoning={t.reasoning} seconds={t.seconds} streaming={false} />
              )}
              {t.todos && t.todos.length > 0 && <TodoPanel todos={t.todos} />}
              <div className="dfcontent">
                <Md text={t.text} />
              </div>
              {cites.length > 0 && (
                <Sources>
                  <SourcesTrigger count={cites.length}>
                    <p className="font-medium">引用来源 {cites.length}</p>
                    <ChevronDownIcon className="h-4 w-4" />
                  </SourcesTrigger>
                  <SourcesContent>
                    {cites.map((c, i) => (
                      <Source key={i} href={c.url} title={c.label.slice(0, 40)} />
                    ))}
                  </SourcesContent>
                </Sources>
              )}
              <MessageToolbar className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <div className="flex gap-1 items-center">
                  <CopyBtn text={t.text} />
                  {onRate && <FeedbackBtns onRate={(r) => onRate(t.key, r)} />}
                  {typeof t.tokens === "number" && (
                    <span className="tokens">{t.tokens.toLocaleString()} tokens</span>
                  )}
                </div>
              </MessageToolbar>
            </MessageContent>
          </Message>
        );
      })}
    </>
  );
}

/**
 * 官方会话容器：Conversation（StickToBottom 贴底）+ 内容 + 回到底部按钮。
 * 两个会话页共用；替代此前自写的 useStickToBottom + 手动滚动。
 */
export function OfficialConversation({ children }: { children: React.ReactNode }) {
  return (
    <DFConversation className="flex-1">
      <ConversationContent className="!gap-7 !p-0 max-w-3xl mx-auto w-full">
        {children}
      </ConversationContent>
      <ConversationScrollButton />
    </DFConversation>
  );
}
