import { useState } from "react";
import { ArrowUp, Check, Paperclip, RotateCcw, Square, Wrench } from "lucide-react";
import type { MiloEvent } from "../lib/api";
import {
  Conversation as DFConversation, ConversationContent, ConversationScrollButton,
} from "./ai-elements/conversation";
import {
  ChainOfThought, ChainOfThoughtContent, ChainOfThoughtHeader, ChainOfThoughtStep,
} from "./ai-elements/chain-of-thought";
import { Message, MessageContent, MessageToolbar } from "./ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./ai-elements/reasoning";
import { Shimmer } from "./ai-elements/shimmer";
import { Sources, SourcesContent, SourcesTrigger, Source } from "./ai-elements/sources";
import { ChevronDownIcon } from "lucide-react";
import { Md } from "./Md";

/**
 * 会话渲染共享件——**代码级复用 DeerFlow 官方 ai-elements 组件**
 * （Message / Reasoning / Conversation，MIT License，见 /NOTICE）。
 * 秘书页与成员私聊共用；Milo 扩展（TODO/引用/用量/反馈）挂在官方组件上。
 */

/** 工具调用步骤（report 事件）——渲染成时间线卡（对齐 stock-agent 的 AI Copilot）。 */
export type ToolStep = { tool: string; snippet?: string };

export type Turn =
  | { kind: "user"; key: string; text: string; ts: string }
  | { kind: "assistant"; key: string; text: string; reasoning: string; seconds: number | null;
      ts: string; tools: ToolStep[]; confidence?: "high" | "medium" | "low";
      tokens?: number | null; todos?: Array<{ content: string; status: string }> }
  // 实时回合：answer=答案流式预览（trace/content），reasoning=思维链（reasoning_content）
  | { kind: "streaming"; key: string; answer: string; reasoning: string; startTs: string | null;
      tools: ToolStep[] };

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

/**
 * 事件流 → 回合。两条流严格分开（编制设计 · 思考块语义）：
 *   status/kind=thinking（reasoning_content）→ think：真思维链，进"思考块"
 *   status/kind=trace|report（content 流）    → answer：答案的流式预览
 * 回复（chat）到达即定稿：正文取 chat 文本，思考块取累积的 think；
 * answer 只是流式期间的实时预览，定稿时丢弃（不再和答案重复）。
 */
export function buildTurns(events: MiloEvent[]): Turn[] {
  const turns: Turn[] = [];
  let think = "";
  let thinkStart: string | null = null;
  let answer = "";
  let tools: ToolStep[] = [];
  let todos: Array<{ content: string; status: string }> | undefined;
  let tokens: number | null | undefined;
  const reset = () => { think = ""; thinkStart = null; answer = ""; tools = []; };
  for (const e of events) {
    if (e.type === "system") {
      if (typeof e.payload?.tokens === "number") tokens = e.payload.tokens;
      continue;
    }
    if (e.type === "status") {
      const kind = e.payload?.kind;
      if (kind === "todo" && Array.isArray(e.payload.todos)) {
        todos = e.payload.todos;   // 后到的覆盖：TODO 是状态快照不是流水
        continue;
      }
      if (kind === "subagent") continue;  // 子代理进度并入动作行
      if (kind === "report") {            // 工具调用 → 时间线步骤（不进答案）
        const tool = String(e.payload?.tool ?? "").trim();
        const doing = String(e.payload?.doing ?? "");
        const snippet = doing.includes("：") ? doing.split("：").slice(1).join("：") : "";
        if (tool) tools.push({ tool, snippet: snippet || undefined });
        continue;
      }
      const chunk = String(e.payload?.doing ?? e.content ?? "");
      if (kind === "thinking") {
        if (!think) thinkStart = e.ts;
        think += chunk;            // 思维链 → 思考块
      } else {
        answer += chunk;           // trace → 答案流式预览
      }
      continue;
    }
    if (e.type !== "chat") continue;
    const text = String(e.payload?.text ?? e.content ?? "");
    if (e.actor === "owner") {
      reset(); // 用户发言重置缓冲
      turns.push({ kind: "user", key: e.event_id, text, ts: e.ts });
    } else {
      const seconds = thinkStart
        ? Math.max(1, Math.round((Date.parse(e.ts) - Date.parse(thinkStart)) / 1000))
        : null;
      const confidence = e.payload?.confidence as ("high" | "medium" | "low" | undefined);
      turns.push({ kind: "assistant", key: e.event_id, text, reasoning: think, seconds,
                   ts: e.ts, tools, confidence, tokens, todos });
      reset(); todos = undefined; tokens = undefined;
    }
  }
  if (answer || think || tools.length) {
    turns.push({ kind: "streaming", key: "live", answer, reasoning: think,
                 startTs: thinkStart, tools });
  }
  return turns;
}

/**
 * 思考块——直接用官方 Reasoning/ReasoningTrigger/ReasoningContent 组件
 * （流式默认展开、完成后 1s 自动收起、LiveTimer 计时全由官方组件实现）。
 */
/** 思考条文案中文化——用官方预留的 getThinkingMessage 扩展点，不改组件本体。 */
function zhThinking(isStreaming: boolean, duration?: number): React.ReactNode {
  if (isStreaming) return <Shimmer duration={1}>思考中…</Shimmer>;
  if (duration === undefined) return <span>思考了一会儿</span>;
  return <span>思考了 {duration} 秒</span>;
}

export function ReasoningBlock({ reasoning, seconds, streaming }: {
  reasoning: string; seconds: number | null; streaming: boolean;
}) {
  return (
    <Reasoning isStreaming={streaming} duration={seconds ?? undefined}
               className="text-sm">
      <ReasoningTrigger hasContent={!!reasoning} getThinkingMessage={zhThinking} />
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

/** ISO 时间戳 → HH:MM:SS（对齐 stock-agent 的消息时间显示）。 */
function formatTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 常见工具名 → 中文动作名（对齐截图的「草案列表 list_rebalance_drafts」双标签）。 */
const TOOL_LABELS: Record<string, string> = {
  write_todos: "更新计划", todo_write: "更新计划",
  read_file: "读取文件", write_file: "写入文件", str_replace: "编辑文件",
  edit_file: "编辑文件", create_file: "创建文件", list_dir: "浏览目录",
  bash: "执行命令", run_command: "执行命令", python_repl: "运行代码",
  web_search: "联网检索", fetch_url: "抓取网页", get_artifact: "读取产物",
  ask_clarification: "发起请示",
};
function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/**
 * 工具调用时间线卡——对齐 stock-agent 的 AI Copilot：每步 🔧 图标 + 中文动作名 +
 * 工具名(mono) + ✓；步骤多时可「收起早期步骤」。数据来自 report 事件（工具执行完成）。
 */
export function ToolTimeline({ tools, live }: { tools: ToolStep[]; live?: boolean }) {
  const [showEarly, setShowEarly] = useState(true);  // 默认展开（对齐参考：按钮为「收起早期步骤」）
  if (tools.length === 0) return null;
  const KEEP = 3;
  const canCollapse = tools.length > KEEP + 1;
  const hidden = canCollapse && !showEarly ? tools.length - KEEP : 0;
  const shown = hidden > 0 ? tools.slice(hidden) : tools;
  return (
    <div className={`tool-timeline ${live ? "live" : ""}`}>
      {canCollapse && (
        <button className="tool-collapse" onClick={() => setShowEarly((v) => !v)}>
          {showEarly ? "收起早期步骤" : `展开早期 ${hidden} 步`}
        </button>
      )}
      {shown.map((s, i) => {
        const label = toolLabel(s.tool);
        const dup = label === s.tool;   // 无中文映射时不重复展示
        return (
          <div key={i} className="tool-row" title={s.snippet}>
            <span className="tool-ico"><Wrench size={13} /></span>
            <span className="tool-label">{label}</span>
            {!dup && <span className="tool-name">{s.tool}</span>}
            <Check className="tool-check" size={16} />
          </div>
        );
      })}
    </div>
  );
}

/** 信心度徽章（对齐 stock-agent 的「信心度 中」）——只显示成员自评值，无则不渲染。 */
export function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const label = { high: "高", medium: "中", low: "低" }[level];
  return <span className={`conf-badge conf-${level}`}>信心度 {label}</span>;
}

/** 消息署名行：头像 + 名字 + 时间戳（对齐 stock-agent 的 "AI Copilot 01:31:53"）。 */
export function MessageHeader({ name, accent, ts }: {
  name: string; accent?: boolean; ts?: string;
}) {
  const style = accent
    ? undefined
    : { background: `hsl(${avatarHue(name)} 42% 46%)`, color: "#fff" };
  return (
    <div className="msg-head">
      <span className={`mh-ava ${accent ? "accent" : ""}`} style={style}>{avatarText(name)}</span>
      <span className="mh-name">{name}</span>
      {ts && <span className="mh-ts">{formatTime(ts)}</span>}
    </div>
  );
}

/** 回合列表——用官方 Message/MessageContent 原语，Milo 扩展挂在其上。 */
export function TurnList({ turns, onRate, assistantName = "助手", assistantAccent }: {
  turns: Turn[]; onRate?: (eventId: string, rating: number) => void;
  assistantName?: string; assistantAccent?: boolean;
}) {
  return (
    <>
      {turns.map((t) => {
        if (t.kind === "user") {
          return (
            <Message key={t.key} from="user" className="group/msg relative">
              <MessageContent>
                {t.text}
                {t.ts && <span className="bubble-ts">{formatTime(t.ts)}</span>}
              </MessageContent>
              {/* 工具条绝对定位、不占流内高度：否则每条消息后都留一段空带，
                  非悬停时看着像空隙、悬停时又冒出一个孤零零的「复制」。 */}
              <MessageToolbar className="!mt-0 absolute top-full right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10">
                <CopyBtn text={t.text} />
              </MessageToolbar>
            </Message>
          );
        }
        if (t.kind === "streaming") {
          return (
            <Message key={t.key} from="assistant">
              <MessageHeader name={assistantName} accent={assistantAccent} />
              <MessageContent>
                {/* 思考块：仅在有思维链时显示；答案未开始前维持"思考中…" */}
                {t.reasoning && (
                  <ReasoningBlock reasoning={t.reasoning} seconds={null} streaming={!t.answer} />
                )}
                {t.tools.length > 0 && <ToolTimeline tools={t.tools} live />}
                {t.answer ? (
                  <div className="dfcontent"><Md text={t.answer} /></div>
                ) : (
                  !t.reasoning && !t.tools.length && <Shimmer duration={1}>正在输入…</Shimmer>
                )}
              </MessageContent>
            </Message>
          );
        }
        const cites = extractCitations(t.text);
        return (
          <Message key={t.key} from="assistant" className="group/msg">
            <MessageHeader name={assistantName} accent={assistantAccent} ts={t.ts} />
            <MessageContent className="relative">
              {t.reasoning && (
                <ReasoningBlock reasoning={t.reasoning} seconds={t.seconds} streaming={false} />
              )}
              {t.tools.length > 0 && <ToolTimeline tools={t.tools} />}
              {t.todos && t.todos.length > 0 && <TodoPanel todos={t.todos} />}
              <div className="dfcontent">
                <Md text={t.text} />
              </div>
              {(t.confidence || cites.length > 0) && (
                <div className="msg-footer">
                  {t.confidence && <ConfidenceBadge level={t.confidence} />}
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
                </div>
              )}
              {/* 工具条绝对定位、不占流内高度（见上「用户消息」注释）。 */}
              <MessageToolbar className="!mt-0 absolute top-full left-0 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10">
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

/** 头像文字：中文取末字（辨识名），其余取首字母大写。 */
function avatarText(name: string): string {
  const t = (name || "").trim();
  if (!t) return "?";
  return /[一-鿿]/.test(t) ? t.slice(-1) : t.slice(0, 1).toUpperCase();
}
/** 头像色相：名字决定，让每个成员有稳定的视觉身份。 */
function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** 会话头部：头像 + 标题/副标题 + 重置。私聊与秘书共用。 */
export function ChatHeader({ name, title, subtitle, accent, onReset }: {
  name: string; title: string; subtitle: string;
  accent?: boolean;  // 秘书用主色实心头像，成员用名字色相
  onReset: () => void;
}) {
  const style = accent
    ? undefined
    : { background: `hsl(${avatarHue(name)} 42% 46%)`, color: "#fff" };
  return (
    <div className="chat-head" data-tauri-drag-region>
      <div className={`chat-ava ${accent ? "accent" : ""}`} style={style}>
        {avatarText(name)}
      </div>
      <div className="chat-id">
        <div className="chat-title">{title}</div>
        <div className="chat-sub">{subtitle}</div>
      </div>
      <button className="chat-reset" title="重置对话（清空历史，人设不变）" onClick={onReset}>
        <RotateCcw size={14} /> 重置
      </button>
    </div>
  );
}

/** 会话输入：输入框与操作同处一张圆角卡面（focus 高亮环）；附件、Enter 发送、拖拽。 */
export function ChatComposer({
  value, onChange, onSend, onStop, streaming, sending, placeholder,
  files, onFiles, allowFiles = true,
}: {
  value: string; onChange: (v: string) => void;
  onSend: () => void; onStop: () => void;
  streaming: boolean; sending: boolean; placeholder: string;
  files: File[]; onFiles: (f: File[]) => void; allowFiles?: boolean;
}) {
  const canSend = !sending && !!value.trim();
  return (
    <div className="chat-input"
         onDragOver={allowFiles ? (e) => e.preventDefault() : undefined}
         onDrop={allowFiles ? (e) => {
           e.preventDefault();
           onFiles([...files, ...Array.from(e.dataTransfer.files)]);
         } : undefined}>
      {files.length > 0 && (
        <div className="chat-attach">
          {files.map((f, i) => (
            <span key={i} className="chip">
              <Paperclip size={11} /> {f.name}
              <button className="capx" title="移除"
                      onClick={() => onFiles(files.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <textarea className="chat-ta" rows={1} placeholder={placeholder} value={value}
          onChange={(e) => {
            onChange(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault(); if (canSend) onSend();
            }
          }} />
        <div className="chat-actions">
          {allowFiles && (
            <label className="chat-attach-btn" title="添加附件">
              <Paperclip size={16} />
              <input type="file" multiple hidden
                     onChange={(e) => {
                       onFiles([...files, ...Array.from(e.target.files ?? [])]);
                       e.currentTarget.value = "";
                     }} />
            </label>
          )}
          {streaming ? (
            <button className="chat-send stop" onClick={onStop} title="停止当前回合">
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button className="chat-send" disabled={!canSend} onClick={onSend} title="发送（Enter）">
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
