import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GroupView } from "./components/GroupView";
import { Inspector } from "./components/Inspector";
import { MarketView } from "./components/MarketView";
import { OrgView } from "./components/OrgView";
import { RosterView } from "./components/RosterView";
import { MemberChatView } from "./components/MemberChatModal";
import { SecretaryView } from "./components/SecretaryView";
import { SettingsModal } from "./components/SettingsView";
import {
  api, subscribe,
  type GroupSummary, type Member, type MiloEvent, type OrgSummary,
  type PlanStep, type TaskRow, type Todo,
} from "./lib/api";
import { initNotifications, notifyForEvent, onNotificationOpen } from "./lib/notify";

type Screen = "chat" | "todo" | "org" | "market" | "roster" | "group" | "dm";
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
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [filter, setFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const [secEvents, setSecEvents] = useState<MiloEvent[]>([]);  // 秘书对话实时流
  const [dmTarget, setDmTarget] = useState<string | null>(null);   // 私聊对象
  const [dms, setDms] = useState<{ group_id: string; member: string }[]>([]);  // 私聊会话列表
  const [inspOpen, setInspOpen] = useState(() => localStorage.getItem("milo.insp") !== "0");
  const [arcOpen, setArcOpen] = useState(() => localStorage.getItem("milo.arc") === "1");
  const [dmEvents, setDmEvents] = useState<MiloEvent[]>([]);       // 私聊实时流
  const seen = useRef(new Set<string>());

  const refreshLists = useCallback(async () => {
    const [g, t, m, d] = await Promise.all([
      api.groups(ORG).catch(() => ({ groups: [] })),
      api.todos(ORG).catch(() => ({ todos: [] })),
      api.members(ORG).catch(() => ({ members: [] })),
      api.dms(ORG).catch(() => ({ dms: [] })),
    ]);
    setGroups(g.groups); setTodos(t.todos); setMembers(m.members); setDms(d.dms);
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
    setSecEvents([]);
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
    setAcceptedAt(d.accepted_at ?? null);
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
      if (e.group_id === "secretary") setSecEvents((prev) => [...prev, e]);
      if (e.group_id.startsWith("dm-")) setDmEvents((prev) => [...prev, e]);
      refreshLists();
      // 汇报（status）是 token 级高频流，只 append 不重拉详情——
      // 否则长会话是 O(n²) 请求；状态推进类事件才需要同步任务/群状态
      if (e.group_id === gidRef.current && e.type !== "status") {
        api.group(ORG, e.group_id).then((d) => {
          setTasks(d.tasks); setGstatus(d.status); setTitle(d.title);
          setAcceptedAt(d.accepted_at ?? null);
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

  // Cmd+\ 折叠右栏检查器（状态持久化）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setInspOpen((v) => { localStorage.setItem("milo.insp", v ? "0" : "1"); return !v; });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 点击系统通知（或点击后激活窗口）→ 直达对应任务群
  useEffect(() => { onNotificationOpen(openGroup); }, [openGroup]);

  const openDM = (member: string) => {
    setDmTarget(member);
    setScreen("dm");
    refreshLists(); // 首次私聊后左栏立即出现该会话
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

  const onAccept = async () => {
    if (!gid) return;
    await api.acceptGroup(ORG, gid).catch(() => {});
    await refreshLists(); openGroup(gid);
  };

  const onArchive = async () => {
    if (!gid) return;
    await api.archiveGroup(ORG, gid).catch(() => {});
    await refreshLists(); openGroup(gid);
  };

  const onRework = async (feedback: string) => {
    if (!gid) return;
    await api.reworkGroup(ORG, gid, feedback).catch(() => {});
    await refreshLists(); openGroup(gid);
  };

  const onRetry = async () => {
    if (!gid) return;
    await api.retryPlan(ORG, gid).catch(() => {});
    await refreshLists();
    openGroup(gid);
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
  // 成功任务自动归档（全终态即 archived）——归档量会持续增长，
  // 与进行中分区展示，避免活跃任务被淹没
  const liveGroups = useMemo(
    () => shownGroups.filter((g) => g.status !== "archived"), [shownGroups]);
  const archivedGroups = useMemo(
    () => shownGroups.filter((g) => g.status === "archived"), [shownGroups]);
  const pendingTotal = todos.length;

  return (
    <div className="app">
      {/* ── 左栏：功能导航 + 任务群列表 ── */}
      <aside className="side">
        <div className="brand">Milo</div>
        <select className="orgsel" value={ORG} onChange={(e) => switchOrg(e.target.value)}
                aria-label="切换团队">
          {orgs.map((o) => (
            <option key={o.org} value={o.org}>
              {o.open ? "● " : "○ "}{o.org}（{o.members} 名成员）
            </option>
          ))}
          {!orgs.some((o) => o.org === ORG) && <option value={ORG}>{ORG}</option>}
        </select>
        <button className={`nv ${screen === "chat" ? "on" : ""}`} onClick={() => setScreen("chat")}>
          💬 秘书
        </button>
        <button className={`nv ${screen === "todo" ? "on" : ""}`} onClick={() => setScreen("todo")}>
          ✅ 待办{pendingTotal > 0 && <span className="bdg">{pendingTotal}</span>}
        </button>
        <button className={`nv ${screen === "org" ? "on" : ""}`} onClick={() => setScreen("org")}>
          👥 团队
        </button>
        <button className={`nv ${screen === "market" ? "on" : ""}`} onClick={() => setScreen("market")}>
          🛒 市场
        </button>
        <button className={`nv ${screen === "roster" ? "on" : ""}`} onClick={() => setScreen("roster")}>
          🗂 名册
        </button>
        <button className="nv" onClick={() => setSettingsOpen(true)}>
          ⚙️ 设置
        </button>

        <div className="dmsec">
          <div className="grplabel">私聊</div>
          <div className="glist" style={{ flex: "none", maxHeight: 130 }}>
            {dms.map((d) => (
              <button key={d.group_id}
                      className={`gitem ${screen === "dm" && dmTarget === d.member ? "on" : ""}`}
                      onClick={() => openDM(d.member)}>
                <span className="ava sm o">{d.member.slice(0, 1).toUpperCase()}</span>
                <span className="gt">{d.member}</span>
              </button>
            ))}
            {dms.length === 0 && <div className="foot">在「团队」页对成员发起私聊</div>}
          </div>
        </div>

        <div className="grpsec">
          <div className="grplabel">任务群</div>
          <input className="gsearch" placeholder="搜索任务群…" value={filter}
                 onChange={(e) => setFilter(e.target.value)} />
          <div className="glist grouplist">
            {liveGroups.map((g) => (
              <button key={g.group_id}
                      className={`gitem ${gid === g.group_id ? "on" : ""}`}
                      onClick={() => openGroup(g.group_id)}>
                <span className={`gdot ${g.status === "waiting" || g.status === "review" ? "waiting"
                  : g.status === "failed" ? "failed"
                  : g.status === "accepted" ? "done" : "active"}`} />
                <span className="gt">{g.title || g.group_id}</span>
                {g.pending > 0 && <span className="gbdg">@你</span>}
              </button>
            ))}
            {liveGroups.length === 0 && (
              <div className="foot">{filter ? "无匹配的进行中任务" : "没有进行中的任务"}</div>
            )}

            {archivedGroups.length > 0 && (
              <>
                <button className="arctoggle"
                        onClick={() => {
                          const v = !(arcOpen || !!filter);
                          setArcOpen(v); localStorage.setItem("milo.arc", v ? "1" : "0");
                        }}>
                  <span className={`arcchev ${(arcOpen || filter) ? "open" : ""}`}>›</span>
                  已归档 <span className="arccount">{archivedGroups.length}</span>
                </button>
                {(arcOpen || filter) && archivedGroups.map((g) => (
                  <button key={g.group_id}
                          className={`gitem archived ${gid === g.group_id ? "on" : ""}`}
                          onClick={() => openGroup(g.group_id)}>
                    <span className="gdot" />
                    <span className="gt">{g.title || g.group_id}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="foot">桌面壳 v0.1 · {members.length} 名成员</div>
      </aside>

      {/* ── 中栏：主内容 ── */}
      <main className="main">
        {screen === "chat" && <SecretaryView org={ORG} liveEvents={secEvents} />}

        {screen === "dm" && dmTarget && (
          <MemberChatView org={ORG} member={dmTarget} liveEvents={dmEvents} />
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

        {screen === "org" && <OrgView org={ORG} onChanged={refreshLists} onDM={openDM} />}

        {screen === "market" && <MarketView onChanged={refreshLists} />}

        {screen === "roster" && <RosterView org={ORG} />}

        {screen === "group" && gid && (
          <GroupView org={ORG} title={title} status={gstatus} events={events} tasks={tasks}
                     plan={plan} focusTaskId={focusTask}
                     acceptedAt={acceptedAt}
                     onReply={onReply} onApprove={onApprove} onReject={onReject}
                     onRetry={onRetry} onAccept={onAccept} onArchive={onArchive}
                     onRework={onRework} />
        )}
      </main>

      {/* ── 右栏：检查器 ── */}
      {inspOpen ? (
        <aside className="inspector">
          <button className="inspfold" title="折叠检查器 (⌘\\)"
                  onClick={() => { setInspOpen(false); localStorage.setItem("milo.insp", "0"); }}>›</button>
          <Inspector screen={screen} org={ORG} gid={gid} gstatus={gstatus} events={events}
                     tasks={tasks} secEvents={secEvents} dmTarget={dmTarget} todos={todos}
                     members={members} groups={groups}
                     onChanged={refreshLists} onOpenGroup={openGroup} />
        </aside>
      ) : (
        <button className="inspshow" title="展开检查器 (⌘\\)"
                onClick={() => { setInspOpen(true); localStorage.setItem("milo.insp", "1"); }}>‹</button>
      )}

      <SettingsModal org={ORG} open={settingsOpen} connected={conn === "open"}
                     onClose={() => setSettingsOpen(false)} />

      <div className="statusbar">
        <span className={`dot ${conn}`} />
        <span>{conn === "open" ? "已连接 milod" : conn === "connecting" ? "连接中…" : "已断开（自动重连）"}</span>
        <span>{members.length} 名成员</span>
        <span>{groups.length} 个任务群</span>
        {pendingTotal > 0 && <span style={{ color: "var(--amber)" }}>{pendingTotal} 项待你决定</span>}
      </div>
    </div>
  );
}
