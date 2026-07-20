import { useEffect, useState } from "react";
import {
  api, type GroupSummary, type Member, type MiloEvent, type PackInfo,
  type RosterMember, type TaskRow, type Todo,
} from "../lib/api";

/**
 * 右栏检查器（milo-右栏检查器设计.md）：当前对象的档案 → 相关物 → 快捷动作。
 * 纪律：不做导航、不重复主区、每屏强相关；无对象时给一句话说明不留白板。
 */

function Head({ children }: { children: React.ReactNode }) {
  return <div className="ihead">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="muted" style={{ fontSize: 12 }}>{children}</div>;
}

/* ---------- 秘书：定位 + 工具面 + 本次会话动作 ---------- */

const SEC_TOOLS: Array<[string, string[]]> = [
  ["只读查询", ["团队状态", "任务群列表", "任务群详情", "待你拍板事项", "浏览市场", "Agent 库"]],
  ["可执行", ["创建任务群（走计划批准）", "下载模板入库"]],
];

function SecretaryInspector({ events, onOpenGroup }: {
  events: MiloEvent[]; onOpenGroup: (gid: string) => void;
}) {
  // 秘书回复里提到的任务群号 = 本次会话的动作痕迹（工具调用记录的近似）
  const gids = Array.from(new Set(
    events.filter((e) => e.type === "chat" && e.actor === "secretariat")
      .flatMap((e) => String(e.payload?.text ?? e.content ?? "").match(/g-[0-9a-f]{6}/g) ?? []),
  )).slice(-6);

  return (
    <>
      <Head>秘书</Head>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
        系统操作面：你用自然语言说事，它查询系统或替你派活。它不是成员——不接任务、
        不产出交付物；人事只能建议，决定权在你。
      </div>
      <Head>它能做什么</Head>
      {SEC_TOOLS.map(([group, items]) => (
        <div key={group} style={{ marginBottom: 8 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>{group}</div>
          <div>{items.map((i) => (
            <span key={i} className="chip" style={{ marginRight: 4, marginBottom: 4, fontSize: 10.5 }}>{i}</span>
          ))}</div>
        </div>
      ))}
      <Head>本次会话创建的任务群</Head>
      {gids.length === 0 ? <Empty>还没有。让它派活试试。</Empty> : gids.map((g) => (
        <button key={g} className="ilink mono" onClick={() => onOpenGroup(g)}>⚙ {g} →</button>
      ))}
    </>
  );
}

/* ---------- 私聊：成员名片 + 名下任务 + 快捷动作 ---------- */

function MemberInspector({ org, member, onChanged, onOpenGroup }: {
  org: string; member: string; onChanged: () => void; onOpenGroup: (gid: string) => void;
}) {
  const [m, setM] = useState<RosterMember | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [busyAct, setBusyAct] = useState(false);

  const reload = () => {
    api.roster(org).then((r) => setM(r.members.find((x) => x.name === member) ?? null))
      .catch(() => setM(null));
    api.tasksOf(org, member).then((r) => setTasks(r.tasks)).catch(() => setTasks([]));
  };
  useEffect(reload, [org, member]);

  if (!m) return <><Head>成员</Head><Empty>读取档案中…</Empty></>;

  const phase = !m.enrolled ? (m.has_workspace ? ["停职中", "warn"] : ["待加入", ""])
    : !m.loaded ? ["未运行", "warn"] : m.busy ? ["在岗 · 工作中", "warn"] : ["在岗 · 空闲", "ok"];
  const act = async (fn: () => Promise<unknown>) => {
    setBusyAct(true);
    try { await fn(); } finally { setBusyAct(false); reload(); onChanged(); }
  };

  return (
    <>
      <Head>成员名片</Head>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <b style={{ fontSize: 14 }}>{m.name}</b>
        <span className={`chip ${phase[1]}`}>{phase[0]}</span>
      </div>
      {m.agent && <div className="muted mono" style={{ fontSize: 10.5, marginBottom: 6 }}>出厂模板 {m.agent}</div>}
      {m.description && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{m.description}</div>}
      <div style={{ marginBottom: 8 }}>
        {(m.capabilities ?? []).map((c) => (
          <span key={c} className="chip" style={{ marginRight: 4, marginBottom: 4 }}>{c}</span>
        ))}
      </div>
      <dl className="ikv">
        <dt>外网</dt><dd>{!m.permissions?.network?.length ? "禁网" : m.permissions.network.join("、")}</dd>
        <dt>文件</dt><dd>{m.permissions?.filesystem === "readonly" ? "只读" : "读写工作区"}</dd>
        <dt>代码执行</dt><dd>{m.permissions?.python_repl
          ? <span className="chip crit">已开启</span> : "关闭"}</dd>
      </dl>

      <Head>名下任务</Head>
      {tasks.length === 0 ? <Empty>还没有接过任务</Empty> : tasks.slice(0, 6).map((t) => (
        <button key={t.task_id} className="ilink" onClick={() => onOpenGroup(t.group_id)}>
          <span className={`chip ${t.state === "accepted" ? "ok" : t.state === "input_required" ? "warn" : ""}`}
                style={{ fontSize: 10 }}>{t.state}</span>
          <span className="mono" style={{ fontSize: 11, marginLeft: 5 }}>{t.task_id}</span> →
        </button>
      ))}

      <Head>快捷动作</Head>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {m.enrolled && m.loaded && (
          <button className="btn sm" disabled={busyAct || m.busy}
                  title={m.busy ? "工作中不可停职" : "停止实例，记忆保留"}
                  onClick={() => act(() => api.deactivate(org, m.name))}>停职</button>
        )}
        {!m.enrolled && (
          <button className="btn primary sm" disabled={busyAct}
                  onClick={() => act(() => api.activate(org, m.name))}>
            {m.has_workspace ? "复岗" : "加入"}
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        改能力/权限：到「团队」页点该成员，或直接在私聊里吩咐它自改
      </div>
    </>
  );
}

/* ---------- 任务群：进度 → 产物 → 参与成员 → 元数据 ---------- */

const STATE_ZH: Record<string, string> = {
  queued: "排队", assigned: "已派单", working: "工作中", input_required: "等你拍板",
  delivered: "已交付", accepted: "已验收", rejected: "已退回", failed: "失败", canceled: "已取消",
};

function GroupInspector({ org, gid, gstatus, events, tasks }: {
  org: string; gid: string; gstatus: string; events: MiloEvent[]; tasks: TaskRow[];
}) {
  const arts: Array<{ taskId: string; name: string }> = [];
  for (const e of events) {
    if (!Array.isArray(e.payload?.artifacts) || !e.task_id) continue;
    for (const a of e.payload.artifacts) {
      if (a?.name && a?.uri && !arts.some((x) => x.name === a.name && x.taskId === e.task_id)) {
        arts.push({ taskId: e.task_id, name: a.name });
      }
    }
  }
  const request = events.find((e) => e.type === "chat" && e.actor === "owner");
  const members = Array.from(new Set(tasks.map((t) => t.member).filter(Boolean))) as string[];
  const done = tasks.filter((t) => t.state === "accepted").length;

  return (
    <>
      <Head>进度 · {done}/{tasks.length} 已验收</Head>
      {tasks.length === 0 ? <Empty>秘书正在分解计划…</Empty> : tasks.map((t, i) => (
        <div key={t.task_id} className="tl">
          <span className={`tldot ${t.state === "accepted" ? "ok"
            : t.state === "input_required" ? "warn"
            : ["rejected", "failed"].includes(t.state) ? "crit" : ""}`} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5 }}>步骤 {i + 1} · {t.member}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {STATE_ZH[t.state] ?? t.state}{t.attempts > 1 ? ` · ${t.attempts} 轮` : ""}
              {t.stop_reason ? ` · ${t.stop_reason}` : ""}
            </div>
          </div>
        </div>
      ))}

      <Head>交付产物</Head>
      {arts.length === 0 ? <Empty>尚无产物</Empty> : arts.map((a) => (
        <ArtifactRow key={`${a.taskId}-${a.name}`} org={org} taskId={a.taskId} name={a.name} />
      ))}

      <Head>参与成员</Head>
      {members.length === 0 ? <Empty>尚未派单</Empty> : (
        <div>{members.map((n) => <span key={n} className="chip" style={{ marginRight: 4 }}>{n}</span>)}</div>
      )}

      {request && (
        <>
          <Head>原始需求</Head>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {String(request.payload?.text ?? request.content ?? "").slice(0, 240)}
          </div>
        </>
      )}

      <Head>元数据</Head>
      <dl className="ikv">
        <dt>群 ID</dt><dd>{gid}</dd>
        <dt>状态</dt><dd>{gstatus}</dd>
        <dt>事件</dt><dd>{events.length}</dd>
      </dl>
    </>
  );
}

function ArtifactRow({ org, taskId, name }: { org: string; taskId: string; name: string }) {
  const [size, setSize] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string>("");
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!content) {
      try {
        const r = await api.artifact(org, taskId, name);
        setContent(r.content); setSize(r.size);
      } catch { setContent("（读取失败）"); }
    }
  };
  return (
    <div className="iart">
      <button className="ilink" onClick={toggle}>
        📄 <span className="mono" style={{ fontSize: 11.5 }}>{name}</span>
        {size != null && <span className="muted"> {(size / 1024).toFixed(1)} KB</span>}
      </button>
      {open && <pre className="iartpre">{content.slice(0, 4000)}</pre>}
    </div>
  );
}

/* ---------- 团队：健康度 + 权限告警 ---------- */

function TeamInspector({ org }: { org: string }) {
  const [ms, setMs] = useState<RosterMember[]>([]);
  const [limit, setLimit] = useState(5);
  useEffect(() => {
    api.roster(org).then((r) => { setMs(r.members); setLimit(r.limits?.maxParallelMembers ?? 5); })
      .catch(() => setMs([]));
  }, [org]);

  const onDuty = ms.filter((m) => m.enrolled && m.loaded);
  const busy = onDuty.filter((m) => m.busy);
  const suspended = ms.filter((m) => !m.enrolled && m.has_workspace);
  const pending = ms.filter((m) => !m.enrolled && !m.has_workspace);
  const risky = ms.filter((m) => m.permissions?.python_repl);
  const netOpen = ms.filter((m) => (m.permissions?.network ?? []).length > 0);

  return (
    <>
      <Head>团队健康度</Head>
      <dl className="ikv">
        <dt>在岗</dt><dd>{onDuty.length} 名{busy.length > 0 && `（${busy.length} 忙碌）`}</dd>
        <dt>停职中</dt><dd>{suspended.length} 名</dd>
        <dt>待加入</dt><dd>{pending.length} 名</dd>
        <dt>编制余量</dt><dd>{ms.length}/{limit}{ms.length >= limit && " · 已满"}</dd>
      </dl>
      {busy.length > 0 && (
        <>
          <Head>正在干活</Head>
          <div>{busy.map((m) => <span key={m.name} className="chip warn" style={{ marginRight: 4 }}>{m.name}</span>)}</div>
        </>
      )}
      <Head>权限告警</Head>
      {risky.length === 0 && netOpen.length === 0 ? (
        <Empty>无异常：全员禁网、无代码执行</Empty>
      ) : (
        <>
          {risky.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span className="chip crit">代码执行</span>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                {risky.map((m) => m.name).join("、")} 可在本机执行命令——这是实质总开关
              </div>
            </div>
          )}
          {netOpen.length > 0 && (
            <div>
              <span className="chip warn">外网</span>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                {netOpen.map((m) => m.name).join("、")} 可联网检索
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ---------- 市场 / 名册 / 待办 ---------- */

function MarketInspector() {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [lib, setLib] = useState<number>(0);
  useEffect(() => {
    api.market().then((r) => setPacks(r.packs)).catch(() => setPacks([]));
    api.library().then((r) => setLib(r.library.length)).catch(() => setLib(0));
  }, []);
  const starred = packs.filter((p) => p.starred).length;
  const untested = packs.filter((p) => !p.eval_report).length;
  return (
    <>
      <Head>库存概览</Head>
      <dl className="ikv">
        <dt>市场模板</dt><dd>{packs.length} 个</dd>
        <dt>已下载</dt><dd>{lib} 个（Agent 库）</dd>
        <dt>已收藏</dt><dd>{starred} 个</dd>
        <dt>未实测</dt><dd>{untested} 个</dd>
      </dl>
      <Head>验货说明</Head>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        「自报」是模板作者声明的门槛，「实测」是本机复跑的结果——信任来自复跑。
        跑一次：<span className="mono">milo eval &lt;pack&gt;</span>
      </div>
      <Head>权限</Head>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        模板不再声明权限。成员权限统一取「设置 → 权限」的本地默认，招募后可逐个调整。
      </div>
    </>
  );
}

function RosterInspector({ org }: { org: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    api.orgYaml(org).then((r) => setText(r.content)).catch(() => setText(""));
  }, [org]);
  return (
    <>
      <Head>org.yaml 原文</Head>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        文件是事实源，界面只是编辑器
      </div>
      {text ? (
        <>
          <pre className="iartpre" style={{ maxHeight: 420 }}>{text}</pre>
          <button className="btn sm" style={{ marginTop: 8 }}
                  onClick={() => navigator.clipboard?.writeText(text)}>复制原文</button>
        </>
      ) : <Empty>读取中…</Empty>}
    </>
  );
}

function TodoInspector({ todos, onOpenGroup }: {
  todos: Todo[]; onOpenGroup: (gid: string, taskId?: string) => void;
}) {
  const byMember = todos.reduce<Record<string, number>>((acc, t) => {
    acc[t.member] = (acc[t.member] ?? 0) + 1; return acc;
  }, {});
  const oldest = [...todos].sort((a, b) => a.updated_at.localeCompare(b.updated_at))[0];
  return (
    <>
      <Head>待办分布</Head>
      {todos.length === 0 ? <Empty>没有需要你决定的事项</Empty> : (
        <dl className="ikv">
          {Object.entries(byMember).map(([m, n]) => (
            <div key={m} style={{ display: "contents" }}><dt>{m}</dt><dd>{n} 项</dd></div>
          ))}
        </dl>
      )}
      {oldest && (
        <>
          <Head>等得最久</Head>
          <button className="ilink" onClick={() => onOpenGroup(oldest.group_id, oldest.task_id)}>
            {oldest.member} · {oldest.updated_at.slice(5, 16).replace("T", " ")} →
          </button>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {oldest.escalation?.question?.slice(0, 80)}
          </div>
        </>
      )}
      <Head>说明</Head>
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        成员请示只能由你答复——秘书可以转述与建议，但无代答工具。
      </div>
    </>
  );
}

/* ---------- 出口 ---------- */

export type InspectorProps = {
  screen: string;
  org: string;
  gid: string | null;
  gstatus: string;
  events: MiloEvent[];
  tasks: TaskRow[];
  secEvents: MiloEvent[];
  dmTarget: string | null;
  todos: Todo[];
  members: Member[];
  groups: GroupSummary[];
  onChanged: () => void;
  onOpenGroup: (gid: string, taskId?: string) => void;
};

export function Inspector(p: InspectorProps) {
  const { screen } = p;
  if (screen === "group" && p.gid) {
    return <GroupInspector org={p.org} gid={p.gid} gstatus={p.gstatus}
                           events={p.events} tasks={p.tasks} />;
  }
  if (screen === "dm" && p.dmTarget) {
    return <MemberInspector org={p.org} member={p.dmTarget}
                            onChanged={p.onChanged} onOpenGroup={p.onOpenGroup} />;
  }
  if (screen === "chat") {
    return <SecretaryInspector events={p.secEvents} onOpenGroup={p.onOpenGroup} />;
  }
  if (screen === "org") return <TeamInspector org={p.org} />;
  if (screen === "market") return <MarketInspector />;
  if (screen === "roster") return <RosterInspector org={p.org} />;
  if (screen === "todo") return <TodoInspector todos={p.todos} onOpenGroup={p.onOpenGroup} />;
  return <Empty>选择左栏的会话或页面查看详情</Empty>;
}
