import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GroupView } from "./components/GroupView";
import { MarketView } from "./components/MarketView";
import { OrgView } from "./components/OrgView";
import { RosterView } from "./components/RosterView";
import { SettingsModal } from "./components/SettingsView";
import {
  api, subscribe,
  type GroupSummary, type Member, type MiloEvent, type OrgSummary,
  type PlanStep, type TaskRow, type Todo,
} from "./lib/api";
import { initNotifications, notifyForEvent, onNotificationOpen } from "./lib/notify";

type Screen = "chat" | "todo" | "org" | "market" | "roster" | "group";
const LAST_ORG = "milo.lastOrg";

export default function App() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [ORG, setOrg] = useState<string>(() => localStorage.getItem(LAST_ORG) || "demo");
  const [screen, setScreen] = useState<Screen>("chat");
  const [conn, setConn] = useState<"connecting" | "open" | "closed">("connecting");
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [gid, setGid] = useState<string | null>(null);
  const [events, setEvents] = useState<MiloEvent[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [gstatus, setGstatus] = useState("active");
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [filter, setFilter] = useState("");
  const [input, setInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  const refreshLists = useCallback(async () => {
    const [g, t, m] = await Promise.all([
      api.groups(ORG).catch(() => ({ groups: [] })),
      api.todos(ORG).catch(() => ({ todos: [] })),
      api.members(ORG).catch(() => ({ members: [] })),
    ]);
    setGroups(g.groups); setTodos(t.todos); setMembers(m.members);
  }, [ORG]);

  // 组织列表（顶栏切换用）
  useEffect(() => {
    api.orgs().then((r) => {
      setOrgs(r.orgs);
      // 上次选的组织若已不存在，回落到第一个
      if (r.orgs.length && !r.orgs.some((o) => o.org === ORG)) switchOrg(r.orgs[0].org);
    }).catch(() => setOrgs([]));
  }, []);

  const switchOrg = (next: string) => {
    localStorage.setItem(LAST_ORG, next);
    setOrg(next);
    setScreen("chat"); setGid(null); setEvents([]); setTasks([]); setPlan(null);
    seen.current.clear();
  };

  const loadPlan = useCallback(async (id: string, status?: string) => {
    // 只在群"待批准"时才取计划——否则每次事件都打一次必然 404 的请求
    if (status && status !== "waiting") { setPlan(null); return; }
    setPlan(await api.plan(ORG, id).then((p) => p.steps).catch(() => null));
  }, [ORG]);

  const openGroup = useCallback(async (id: string, focusTask?: string) => {
    setGid(id); setScreen("group"); seen.current.clear();
    setFocusTask(focusTask ?? null);
    const d = await api.group(ORG, id);
    setEvents(d.events); setTasks(d.tasks); setTitle(d.title); setGstatus(d.status);
    d.events.forEach((e) => seen.current.add(e.event_id));
    await loadPlan(id, d.status);
  }, [loadPlan, ORG]);

  // WS：实时事件入流 + 列表刷新（断线自动按 seq 水位重连补发）
  useEffect(() => {
    refreshLists();
    initNotifications();
    return subscribe(ORG, (e) => {
      if (seen.current.has(e.event_id)) return; // 补发与实时可能重叠
      seen.current.add(e.event_id);
      // 只有 mention/notify 会打扰用户；补发的历史事件不再重复通知
      if (!e.replay) notifyForEvent(e);
      setEvents((prev) => (e.group_id === gidRef.current ? [...prev, e] : prev));
      refreshLists();
      // 汇报（status）是 token 级高频流，只 append 不重拉详情——
      // 否则长会话是 O(n²) 请求；状态推进类事件才需要同步任务/群状态
      if (e.group_id === gidRef.current && e.type !== "status") {
        api.group(ORG, e.group_id).then((d) => {
          setTasks(d.tasks); setGstatus(d.status); setTitle(d.title);
          // 分解要几十秒——计划卡不能只在打开群时拉一次；
          // 群转 waiting 即表示计划已就绪待批
          if (d.status === "waiting") loadPlan(e.group_id, d.status);
          else setPlan(null);
        }).catch(() => {});
      }
    }, setConn);
  }, [refreshLists, loadPlan, ORG]);

  // 用 ref 让 WS 回调读到最新选中的群
  const gidRef = useRef<string | null>(null);
  useEffect(() => { gidRef.current = gid; }, [gid]);

  // 点击系统通知（或点击后激活窗口）→ 直达对应任务群
  useEffect(() => { onNotificationOpen(openGroup); }, [openGroup]);

  const submitRequest = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const { group_id } = await api.run(ORG, text, false); // 走计划批准回合
    await refreshLists();
    await openGroup(group_id); // 立即进群看"分解中"，计划卡随事件到达
  };

  const onReply = async (taskId: string, answer: string) => {
    await api.reply(ORG, taskId, answer);
    await refreshLists();
    if (gid) openGroup(gid);
  };

  const onApprove = async () => {
    if (!gid) return;
    await api.approve(ORG, gid);
    setPlan(null);
  };

  const onReject = async () => {
    if (!gid) return;
    await api.reject(ORG, gid, "暂不执行");
    setPlan(null); await refreshLists();
  };

  const shownGroups = useMemo(
    () => groups.filter((g) => !filter ||
      (g.title ?? g.group_id).toLowerCase().includes(filter.toLowerCase())),
    [groups, filter],
  );
  const pendingTotal = todos.length;

  return (
    <div className="app">
      {/* ── 左栏：功能导航 + 任务群列表 ── */}
      <aside className="side">
        <div className="brand">Milo</div>
        <select className="orgsel" value={ORG} onChange={(e) => switchOrg(e.target.value)}
                aria-label="切换公司">
          {orgs.map((o) => (
            <option key={o.org} value={o.org}>
              {o.open ? "● " : "○ "}{o.org}（{o.members} 名员工）
            </option>
          ))}
          {!orgs.some((o) => o.org === ORG) && <option value={ORG}>{ORG}</option>}
        </select>
        <button className={`nv ${screen === "chat" ? "on" : ""}`} onClick={() => setScreen("chat")}>
          💬 秘书长
        </button>
        <button className={`nv ${screen === "todo" ? "on" : ""}`} onClick={() => setScreen("todo")}>
          ✅ 待办{pendingTotal > 0 && <span className="bdg">{pendingTotal}</span>}
        </button>
        <button className={`nv ${screen === "org" ? "on" : ""}`} onClick={() => setScreen("org")}>
          🏛 公司
        </button>
        <button className={`nv ${screen === "market" ? "on" : ""}`} onClick={() => setScreen("market")}>
          🛒 市场
        </button>
        <button className={`nv ${screen === "roster" ? "on" : ""}`} onClick={() => setScreen("roster")}>
          🗂 花名册
        </button>
        <button className="nv" onClick={() => setSettingsOpen(true)}>
          ⚙️ 设置
        </button>

        <div className="grpsec">
          <div className="grplabel">任务群</div>
          <input className="gsearch" placeholder="搜索任务群…" value={filter}
                 onChange={(e) => setFilter(e.target.value)} />
          <div className="glist">
            {shownGroups.map((g) => (
              <button key={g.group_id}
                      className={`gitem ${gid === g.group_id ? "on" : ""} ${g.status === "archived" ? "archived" : ""}`}
                      onClick={() => openGroup(g.group_id)}>
                <span className={`gdot ${g.status === "waiting" ? "waiting" : g.status === "active" ? "active" : ""}`} />
                <span className="gt">{g.title || g.group_id}</span>
                {g.pending > 0 && <span className="gbdg">@你</span>}
              </button>
            ))}
            {shownGroups.length === 0 && <div className="foot">暂无任务群</div>}
          </div>
        </div>
        <div className="foot">桌面壳 v0.1 · {members.length} 名数字员工</div>
      </aside>

      {/* ── 中栏：主内容 ── */}
      <main className="main">
        {screen === "chat" && (
          <>
            <div className="h">向秘书长下达任务</div>
            <div className="muted" style={{ maxWidth: 620, marginBottom: 14 }}>
              秘书长会把需求分解成计划交你批准，然后派给数字员工；只有需要你拍板的事才会打扰你。
            </div>
            <div className="composer">
              <input placeholder="例如：整理三条大模型应用场景要点…" value={input}
                     onChange={(e) => setInput(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && submitRequest()} />
              <button className="btn primary" onClick={submitRequest}>发送</button>
            </div>
          </>
        )}

        {screen === "todo" && (
          <>
            <div className="h">待你决定 · 跨群聚合</div>
            {todos.map((t) => (
              <div key={t.task_id} className="card todo crit"
                   onClick={() => openGroup(t.group_id, t.task_id)}>
                <div className="who">
                  <span>{t.member} · 任务群 {t.group_id}</span>
                  <span className="ghint">点击进入任务群处理 →</span>
                </div>
                <div className="q">{t.escalation?.question?.slice(0, 120) || "需要你决定"}</div>
                <div className="muted">{t.escalation?.policy}</div>
              </div>
            ))}
            {todos.length === 0 && <div className="card" style={{ padding: 24, textAlign: "center" }}>
              <span className="muted">没有需要你决定的事项</span></div>}
          </>
        )}

        {screen === "org" && <OrgView org={ORG} onChanged={refreshLists} />}

        {screen === "market" && <MarketView onChanged={refreshLists} />}

        {screen === "roster" && <RosterView org={ORG} />}

        {screen === "group" && gid && (
          <GroupView org={ORG} title={title} status={gstatus} events={events} tasks={tasks}
                     plan={plan} focusTaskId={focusTask}
                     onReply={onReply} onApprove={onApprove} onReject={onReject} />
        )}
      </main>

      {/* ── 右栏：检查器 ── */}
      <aside className="inspector">
        {screen === "group" && gid ? (
          <>
            <div className="ihead">任务群</div>
            <dl className="ikv">
              <dt>ID</dt><dd>{gid}</dd>
              <dt>状态</dt><dd>{gstatus}</dd>
              <dt>事件</dt><dd>{events.length}</dd>
            </dl>
            <div className="ihead">任务</div>
            {tasks.map((t) => (
              <div key={t.task_id} style={{ fontSize: 12.5, padding: "5px 0", borderBottom: "1px dashed var(--line)" }}>
                <div>{t.task_id} <span className={`chip ${t.state === "input_required" ? "warn" : t.state === "accepted" ? "ok" : ""}`}>{t.state}</span></div>
                <div className="muted">{t.member} · {t.attempts} 轮执行{t.stop_reason ? ` · ${t.stop_reason}` : ""}</div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="ihead">数字员工</div>
            {members.map((m) => (
              <div key={m.name} style={{ fontSize: 12.5, padding: "5px 0" }}>
                <b>{m.name}</b>
                <div className="muted">{m.capabilities.join("、")}</div>
              </div>
            ))}
            <div className="ihead">说明</div>
            <div className="muted">
              秘书长是系统角色（≈办公室主任），不是员工：分解任务、按能力派单、汇总汇报、
              只在需要拍板时打扰你。人事决定权只属于你。
            </div>
          </>
        )}
      </aside>

      <SettingsModal org={ORG} open={settingsOpen} connected={conn === "open"}
                     onClose={() => setSettingsOpen(false)} />

      <div className="statusbar">
        <span className={`dot ${conn}`} />
        <span>{conn === "open" ? "已连接 milod" : conn === "connecting" ? "连接中…" : "已断开（自动重连）"}</span>
        <span>{members.length} 名数字员工</span>
        <span>{groups.length} 个任务群</span>
        {pendingTotal > 0 && <span style={{ color: "var(--amber)" }}>{pendingTotal} 项待你决定</span>}
      </div>
    </div>
  );
}
