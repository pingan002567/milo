import { QueryClient, useQuery } from "@tanstack/react-query";
import {
  api,
  type OrgSummary, type GroupSummary, type Member, type Todo,
} from "./api";

export type DmSummary = GroupSummary & { member: string };

/**
 * react-query 数据层（借鉴 DeerFlow 官方前端的 @tanstack/react-query 用法）。
 * 首个落地：团队列表——跨团队待办角标需要定时轮询，refetchInterval 一行替代
 * 手写 setInterval + 清理。缓存键统一在此集中，便于后续按域迁移与失效。
 */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 桌面端本地守护进程，网络极快：失败快速重试一次即可
      retry: 1,
      // 窗口切回时刷新（官方默认），保证多窗口/久置后数据新鲜
      refetchOnWindowFocus: true,
      staleTime: 5_000,
    },
  },
});

export const qk = {
  orgs: ["orgs"] as const,
  groups: (org: string) => ["groups", org] as const,
  todos: (org: string) => ["todos", org] as const,
  members: (org: string) => ["members", org] as const,
  dms: (org: string) => ["dms", org] as const,
};

/** 团队列表：30s 轮询（跨团队待办角标）。替代 App 里手写的 setInterval。
    不设 initialData——否则 staleTime 内挂载不会首拉，团队列表会空白几秒。 */
export function useOrgs() {
  return useQuery<OrgSummary[]>({
    queryKey: qk.orgs,
    queryFn: () => api.orgs().then((r) => r.orgs),
    refetchInterval: 30_000,
  });
}

/** 任务群列表（左栏）。WS 事件到达时由 App 触发 invalidate 增量刷新。 */
export function useGroups(org: string) {
  return useQuery<GroupSummary[]>({
    queryKey: qk.groups(org),
    queryFn: () => api.groups(org).then((r) => r.groups),
  });
}

/** 待办（请示）列表——待办角标与待办页共用。 */
export function useTodos(org: string) {
  return useQuery<Todo[]>({
    queryKey: qk.todos(org),
    queryFn: () => api.todos(org).then((r) => r.todos),
  });
}

/** 成员列表。 */
export function useMembers(org: string) {
  return useQuery<Member[]>({
    queryKey: qk.members(org),
    queryFn: () => api.members(org).then((r) => r.members),
  });
}

/** 私聊会话列表（左栏）。 */
export function useDms(org: string) {
  return useQuery<DmSummary[]>({
    queryKey: qk.dms(org),
    queryFn: () => api.dms(org).then((r) => r.dms),
  });
}

/** 一次性失效某团队的四张列表——替代命令式 refreshLists()。
    返回 Promise，保留 `await refreshLists()` 的"等刷新完成"语义。 */
export function invalidateTeamLists(org: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.groups(org) }),
    queryClient.invalidateQueries({ queryKey: qk.todos(org) }),
    queryClient.invalidateQueries({ queryKey: qk.members(org) }),
    queryClient.invalidateQueries({ queryKey: qk.dms(org) }),
  ]);
}
