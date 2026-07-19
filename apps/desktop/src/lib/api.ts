/** milod 客户端：REST + WS。类型对齐 packages/schemas 与 milod.models。 */

export type EventType =
  | "envelope" | "status" | "escalation" | "delivery" | "acceptance" | "system" | "chat";
export type Reach = "silent" | "group" | "mention" | "notify";
export type Category = "message" | "status" | "decision" | "outputs" | "error" | "trace";

export interface ChoiceOption { id: string; label: string; value: string }

/** 升级请求负载，字段对齐 harness 的 human_input_request 契约。 */
export interface EscalationPayload {
  question: string;
  policy: string;
  context?: string | null;
  /** free_text = 纯输入框；choice_with_other = 选项按钮 + 其他 */
  input_mode: "free_text" | "choice_with_other";
  options: ChoiceOption[];
  request_id?: string | null;
  fallback_text?: string | null;
}

export interface MiloEvent {
  seq?: number | null;
  event_id: string;
  group_id: string;
  task_id?: string | null;
  run_id?: string | null;
  type: EventType;
  category?: Category;
  actor: string;
  ts: string;
  reach?: Reach;
  content?: string;
  payload: Record<string, any>;
  replay?: boolean;
}

export interface GroupSummary {
  group_id: string;
  title: string | null;
  status: "active" | "waiting" | "archived" | "failed";
  events: number;
  pending: number;
  created_at: string;
  updated_at: string;
}

export interface Member { name: string; capabilities: string[]; busy: boolean }
export interface TaskRow {
  task_id: string; group_id: string; member: string | null; state: string;
  attempts: number; stop_reason: string | null; run_id: string | null;
}
export interface Todo {
  task_id: string; group_id: string; member: string; updated_at: string;
  escalation: EscalationPayload | null;
}
export interface PlanStep {
  task_id: string; capability: string; objective: string;
  format: string; artifacts: string[]; constraints: string[];
}
export interface OrgSummary { org: string; title: string; members: number; open: boolean }
export interface Permissions { network?: string[]; filesystem?: string; python_repl?: boolean }
export interface PackInfo {
  path: string; name: string; version?: string; author?: string; description?: string;
  capabilities?: { id: string; description: string }[];
  permissions?: Permissions; model_requirements?: { min_tier?: string; context_window?: string };
  eval?: { suite?: string; min_score?: number };
  /** 本机实测报告（milo eval）；null/缺失 = 未实测，只有作者自报门槛 */
  eval_report?: {
    score: number; cases_total: number; cases_passed: number;
    meets_min: boolean; ran_at: string; model?: string;
  } | null;
  error?: string;
}
export interface RosterMember {
  name: string; pack: string; version?: string; author?: string; description?: string;
  capabilities?: string[]; permissions?: Permissions;
  model_requirements?: { min_tier?: string }; error?: string;
  /** false = 待加入或已停职（组织页点「加入组织/复岗」后才分配实例运行） */
  enrolled?: boolean;
  /** 实例是否已在 milod 中运行 */
  loaded?: boolean;
  /** 正在执行任务（工作中不可停职，请离需强制确认） */
  busy?: boolean;
  /** 报到过（有私有工作区）——区分「待加入」与「停职中（记忆保留）」 */
  has_workspace?: boolean;
}

const j = async (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

export const api = {
  orgs: (): Promise<{ orgs: OrgSummary[] }> => fetch(`/api/orgs`).then(j),

  members: (org: string): Promise<{ members: Member[] }> =>
    fetch(`/api/orgs/${org}/members`).then(j),

  roster: (org: string): Promise<{
    org: string; apiVersion: string; members: RosterMember[];
    limits: Record<string, number>;
  }> => fetch(`/api/orgs/${org}/roster`).then(j),

  market: (): Promise<{ packs: PackInfo[] }> => fetch(`/api/market`).then(j),

  enroll: (org: string, pack: string, name?: string) =>
    fetch(`/api/orgs/${org}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack, name: name ?? null }),
    }).then(j) as Promise<{ name: string; capabilities: string[]; note: string }>,

  activate: (org: string, name: string) =>
    fetch(`/api/orgs/${org}/members/${name}/activate`, { method: "POST" })
      .then(j) as Promise<{ name: string; capabilities: string[]; status: string }>,

  deactivate: (org: string, name: string) =>
    fetch(`/api/orgs/${org}/members/${name}/deactivate`, { method: "POST" })
      .then(j) as Promise<{ name: string; status: string }>,

  dismiss: (org: string, name: string, force = false) =>
    fetch(`/api/orgs/${org}/members/${name}${force ? "?force=true" : ""}`, { method: "DELETE" })
      .then(j) as Promise<{ name: string; status: string }>,

  groups: (org: string): Promise<{ groups: GroupSummary[] }> =>
    fetch(`/api/orgs/${org}/groups`).then(j),

  group: (org: string, gid: string, opts?: { category?: Category; run_id?: string }) => {
    const q = new URLSearchParams();
    if (opts?.category) q.set("category", opts.category);
    if (opts?.run_id) q.set("run_id", opts.run_id);
    const qs = q.toString();
    return fetch(`/api/orgs/${org}/groups/${gid}${qs ? "?" + qs : ""}`).then(j) as Promise<{
      group_id: string; title: string | null; status: string;
      events: MiloEvent[]; tasks: TaskRow[];
    }>;
  },

  todos: (org: string): Promise<{ todos: Todo[] }> =>
    fetch(`/api/orgs/${org}/todos`).then(j),

  run: (org: string, request: string, auto_approve = false) =>
    fetch(`/api/orgs/${org}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request, auto_approve }),
    }).then(j) as Promise<{ group_id: string }>,

  plan: (org: string, gid: string): Promise<{ steps: PlanStep[] }> =>
    fetch(`/api/orgs/${org}/groups/${gid}/plan`).then(j),

  approve: (org: string, gid: string, edits?: Record<string, any>) =>
    fetch(`/api/orgs/${org}/groups/${gid}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits: edits ?? null }),
    }).then(j),

  reject: (org: string, gid: string, reason = "") =>
    fetch(`/api/orgs/${org}/groups/${gid}/reject`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).then(j),

  reply: (org: string, taskId: string, answer: string) =>
    fetch(`/api/orgs/${org}/tasks/${taskId}/reply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    }).then(j),
};

/**
 * 事件流订阅：断线自动重连，按 seq 水位补发（对应后端 `?since=`）。
 * 补发帧与实时帧可能重叠，调用方按 event_id 去重。
 */
export function subscribe(
  org: string,
  onEvent: (e: MiloEvent) => void,
  onState?: (s: "connecting" | "open" | "closed") => void,
): () => void {
  let seq = 0;
  let ws: WebSocket | null = null;
  let timer: number | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return;
    onState?.("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/${org}${seq ? `?since=${seq}` : ""}`);

    ws.onopen = () => onState?.("open");
    ws.onmessage = (m) => {
      const f = JSON.parse(m.data);
      if (f.type === "_sync") return; // 补发结束标记
      if (typeof f.seq === "number" && f.seq > seq) seq = f.seq;
      onEvent(f as MiloEvent);
    };
    ws.onclose = () => {
      onState?.("closed");
      if (!closed) timer = window.setTimeout(connect, 1500); // 退避重连，带水位续上
    };
    ws.onerror = () => ws?.close();
  };

  connect();
  return () => { closed = true; clearTimeout(timer); ws?.close(); };
}
