/**
 * 系统通知：把事件的 `reach` 等级翻译成打扰策略。
 *
 * 触达四级（编制设计 §3.5）——升级只沿链单向走，任何类型不得越级：
 *   silent  静默记录（审计）        → 不通知
 *   group   群消息（进度通道）      → 不通知，仅入会话流
 *   mention @你（阻塞通道）         → **系统通知**
 *   notify  私聊/超时提醒           → **系统通知（高优先）**
 *
 * 这是"稀缺打扰"原则的执行点：每一次不必要的通知都在透支所有通知的可信度
 * （CDSS 弹窗 90% 被 override 的教训）。
 */
import type { MiloEvent } from "./api";

type Permission = "granted" | "denied" | "default";

let tauri: {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<Permission>;
  sendNotification: (o: { title: string; body: string }) => void;
} | null = null;

let ready = false;

/** 点击通知后的导航回调（App 注册为 openGroup）。 */
let navigator: ((groupId: string) => void) | null = null;

/**
 * 待跳转目标：通知发出时窗口不在前台才记录。
 * Tauri 的通知插件在桌面端拿不到点击回调（actions 仅移动端），
 * 所以用「窗口重获焦点 + 存在近期未处理通知」近似"点击直达"：
 * 用户点通知 → 系统激活窗口 → focus 事件 → 跳到最近一次请示所在的任务群。
 * Web Notification 有真正的 onclick，则精确直达。
 */
let pendingTarget: { groupId: string; ts: number } | null = null;
const PENDING_TTL_MS = 3 * 60_000; // 太久之前的请示不再劫持导航

export function onNotificationOpen(nav: (groupId: string) => void): void {
  navigator = nav;
}

function jump(groupId: string): void {
  pendingTarget = null;
  navigator?.(groupId);
}

/** 在 Tauri 中用原生通知；浏览器里退化为 Web Notification（开发期可用）。 */
export async function initNotifications(): Promise<void> {
  if (ready) return;
  ready = true;
  // 必须显式探测 Tauri 运行时：插件在纯浏览器里也能 import 成功（内部退化为
  // Web Notification），若以 import 成败判断会把浏览器误认成 Tauri，
  // 丢掉 Web 路径的 onclick 精确直达
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const mod = await import("@tauri-apps/plugin-notification");
      tauri = mod as any;
      if (!(await mod.isPermissionGranted())) await mod.requestPermission();
    } catch {
      tauri = null;
    }
  } else if ("Notification" in window && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* 用户拒绝即静默降级 */ }
  }
  // 点击系统通知 → 窗口被激活 → 跳到该请示所在任务群（Tauri 路径的直达近似）
  window.addEventListener("focus", () => {
    if (pendingTarget && Date.now() - pendingTarget.ts <= PENDING_TTL_MS) {
      jump(pendingTarget.groupId);
    } else {
      pendingTarget = null;
    }
  });
}

function push(title: string, body: string, groupId: string): void {
  if (tauri) {
    // 桌面端插件无点击事件；记下目标，靠窗口重获焦点完成跳转
    if (!document.hasFocus()) pendingTarget = { groupId, ts: Date.now() };
    tauri.sendNotification({ title, body });
    return;
  }
  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification(title, { body });
    n.onclick = () => { window.focus(); jump(groupId); }; // Web 路径：精确直达
  }
}

/** 已通知过的事项——按 request_id 去重，成员重试澄清不会重复弹窗。 */
const notified = new Set<string>();

export function notifyForEvent(e: MiloEvent): void {
  const reach = e.reach ?? "group";
  if (reach !== "mention" && reach !== "notify") return; // 进度通道恒为免打扰

  const p = e.payload ?? {};
  // request_id 由 harness 保证稳定（重试的澄清替换而非追加），是天然幂等键
  const key = String(p.request_id ?? e.event_id);
  if (notified.has(key)) return;
  notified.add(key);

  const who = e.actor === "secretariat" ? "秘书长" : e.actor;
  const title = reach === "notify" ? `${who}：有事项等你处理` : `${who} 请示`;
  const body = String(p.question || e.content || p.msg || "点击查看详情").slice(0, 160);
  push(title, body, e.group_id);
}
