"""成员子进程入口：一个进程 = 一个成员 = 一个 DeerFlowClient。

由 SubprocessAdapter 以 `python -m milod.adapter.worker` 启动，
环境变量 DEER_FLOW_CONFIG_PATH / DEER_FLOW_HOME 已指向该成员的私有工作区
（每成员独立，规避 harness 的进程级全局配置单例问题——见 SPIKE-02 报告）。

读 stdin 的 JSON-RPC 请求，把 harness 事件归一化后按行写 stdout。
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

from milod.adapter.normalize import iter_normalized
from milod.adapter.protocol import EventFrame, Request, Response, decode_line, encode


#: 对话通道（秘书 chat / 私聊 dm）不开 plan_mode，任务通道（t-xxx）才开
def _is_task(task_id: str) -> bool:
    return task_id not in ("chat", "dm")


def _emit(obj) -> None:
    sys.stdout.write(encode(obj) + "\n")
    sys.stdout.flush()


class Worker:
    def __init__(self) -> None:
        self._client: Any = None
        self._member: str = ""   # 显示名（可中文，用于事件 actor）
        self._agent: str = ""    # harness 运行名（ASCII slug）
        self._threads: dict[str, str] = {}
        self._cancelled: set[str] = set()

    # ---- 方法 ----------------------------------------------------------
    def enroll(self, params: dict) -> dict:
        from deerflow.client import DeerFlowClient  # 延迟导入：加速非 enroll 路径

        self._member = params["member"]
        # harness agent 名须 ASCII（^[A-Za-z0-9-]+$）；显示名（可中文）只用于事件 actor。
        # 线程 id 也用 slug——它会进文件路径与校验，不冒中文的险
        self._agent = params.get("agent_name") or self._member
        workdir = Path(params["workdir"])
        checkpointer = self._make_checkpointer(workdir)
        self._client = DeerFlowClient(
            config_path=str(workdir / "config.yaml"),
            agent_name=self._agent,
            checkpointer=checkpointer,
        )
        return {"member": self._member, "checkpointer": checkpointer is not None}

    def assign(self, params: dict) -> dict:
        task_id = params["task_id"]
        prompt = params["prompt"]
        thread_id = self._threads.setdefault(task_id, f"{self._agent}-{task_id}")
        self._inject_inputs(thread_id, params.get("inputs") or [])
        self._pump(task_id, prompt, thread_id, plan_mode=_is_task(task_id))
        return {"task_id": task_id, "thread_id": thread_id}

    def _inject_inputs(self, thread_id: str, inputs: list[dict]) -> None:
        """artifact 引用授权的落地：把信封授权的产物拷进本线程 uploads 目录。

        这是成员唯一的跨任务数据通道——组织侧宿主路径成员不可见也不可达，
        成员只能经 /mnt/user-data/uploads/<name> 读到被明确授权的文件。
        """
        if not inputs:
            return
        from deerflow.config.paths import get_paths
        from deerflow.runtime.user_context import get_effective_user_id

        # 必须带 user_id：harness 线程目录是用户作用域的（home/users/<uid>/threads/…），
        # 不带则解析到 home/threads/… ——文件落在成员根本看不见的地方
        uid = get_effective_user_id()
        for a in inputs:
            src = Path(a["uri"])
            if not src.is_file():
                continue  # 源缺失如实跳过；信封的输入材料清单会让成员发现并上报
            dest = get_paths().resolve_virtual_path(
                thread_id, f"mnt/user-data/uploads/{Path(a['name']).name}", user_id=uid)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(src.read_bytes())

    def resume(self, params: dict) -> dict:
        """组长答复后恢复被 ask_clarification 中断的任务（同 thread + checkpointer）。"""
        task_id = params["task_id"]
        thread_id = self._threads.get(task_id, f"{self._agent}-{task_id}")
        self._inject_inputs(thread_id, params.get("inputs") or [])
        self._pump(task_id, params["answer"], thread_id, plan_mode=_is_task(task_id))
        return {"task_id": task_id, "resumed": True}

    def deliver(self, params: dict) -> dict:
        task_id = params["task_id"]
        thread_id = self._threads.get(task_id, f"{self._agent}-{task_id}")
        out: list[dict] = []
        for rel in params.get("artifacts", []):
            # get_artifact 只认 /mnt/user-data/... 虚拟路径；信封里的产物是裸文件名，
            # 按约定成员写在 outputs/ 下（见 render_envelope 的交付指引）
            vpath = rel if rel.lstrip("/").startswith("mnt/user-data") \
                else f"mnt/user-data/outputs/{rel}"
            try:
                content, media_type = self._client.get_artifact(thread_id, vpath)
            except Exception as e:  # noqa: BLE001 —— 缺失产物如实上报，不伪造
                out.append({"name": rel, "error": str(e)})
                continue
            dest = Path(params["dest_dir"]) / Path(rel).name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content if isinstance(content, bytes) else str(content).encode())
            out.append({"name": Path(rel).name, "uri": str(dest), "media_type": media_type})
        return {"task_id": task_id, "artifacts": out}

    # ---- 内部 ----------------------------------------------------------
    def _make_checkpointer(self, workdir: Path):
        """SQLite checkpointer：无它则每次调用无状态，中断后无法恢复（SPIKE-01 结论 3）。

        直接持有 sqlite3 连接——`from_conn_string()` 返回的是上下文管理器，
        取出 saver 后若不保留 CM 引用，连接会被 GC 关闭（实测 "Cannot operate on a closed database"）。
        """
        try:
            import sqlite3

            from langgraph.checkpoint.sqlite import SqliteSaver

            db = workdir / "home" / "checkpoints.sqlite"
            db.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(db), check_same_thread=False)
            return SqliteSaver(self._conn)
        except Exception:  # noqa: BLE001 —— 无 checkpointer 也能跑单轮，降级不阻断
            return None

    def cancel(self, params: dict) -> dict:
        """停止当前回合。**只置标志、不跨线程 close 生成器**——

        cancel 由 stdin 读线程就地处理（主线程正阻塞在 _pump 的流式循环里，
        否则请求根本读不到）；而在别的线程对正在执行的生成器调 close()
        会抛 "generator already executing"。所以由 _pump 自己在下一次
        迭代时看到标志并收尾（流式 token 很密集，感知延迟极小）。
        """
        task_id = params.get("task_id") or ""
        self._cancelled.add(task_id)
        print(f"[cancel] mark {task_id!r}", file=sys.stderr, flush=True)
        return {"task_id": task_id, "cancelled": True}

    def _pump(self, task_id: str, message: str, thread_id: str,
              *, plan_mode: bool = False) -> None:
        """plan_mode 按通道开关（实测结论）：

        TodoMiddleware 不只是"给个计划工具"——它会**阻止 agent 在 todo 未完成时
        退出循环**（未完成就跳回 model 节点继续）。这对任务执行是好事（别烂尾），
        但对私聊/秘书对话是灾难：问一句话它要走完整个计划，还与"停止"直接冲突。
        所以任务通道开、对话通道关。
        """
        self._cancelled.discard(task_id)
        gen = self._client.stream(message, thread_id=thread_id, plan_mode=plan_mode)
        aborted = False
        try:
            for frame in iter_normalized(gen, task_id=task_id):
                _emit(frame)
                if task_id in self._cancelled:
                    aborted = True
                    break
        except GeneratorExit:
            aborted = True
        finally:
            if aborted:
                self._cancelled.discard(task_id)
                try:
                    gen.close()  # 同线程收尾，安全
                except Exception:  # noqa: BLE001
                    pass
                # 补一帧终局，避免调用方无限等待
                _emit(EventFrame(event="system", task_id=task_id,
                                 payload={"aborted": True, "msg": "已停止"}))

    # ---- 主循环 --------------------------------------------------------
    def serve(self) -> None:
        """读线程 + 主线程分离：assign/resume 会长时间阻塞在流式循环里，
        若在同一线程读 stdin，期间的 cancel 请求永远读不到（停不下来）。
        """
        import queue
        import threading

        handlers = {
            "enroll": self.enroll,
            "assign": self.assign,
            "resume": self.resume,
            "deliver": self.deliver,
            "ping": lambda p: {"pong": True},
        }
        q: queue.Queue = queue.Queue()

        def reader() -> None:
            for line in sys.stdin:
                msg = decode_line(line)
                if not isinstance(msg, Request):
                    continue
                if msg.method == "cancel":
                    # 就地处理：主线程可能正卡在流式循环中
                    _emit(Response(id=msg.id, result=self.cancel(msg.params)))
                    continue
                q.put(msg)
            q.put(None)

        threading.Thread(target=reader, daemon=True).start()
        while True:
            msg = q.get()
            if msg is None:
                return
            if msg.method == "shutdown":
                _emit(Response(id=msg.id, result={"bye": True}))
                return
            try:
                result = handlers[msg.method](msg.params)
                _emit(Response(id=msg.id, result=result))
            except Exception as e:  # noqa: BLE001
                _emit(Response(id=msg.id, error=f"{type(e).__name__}: {e}"))
                print(traceback.format_exc(), file=sys.stderr)


def main() -> int:
    # 成员私有工作区由父进程通过环境变量指定；此处仅做存在性校验
    for var in ("DEER_FLOW_CONFIG_PATH", "DEER_FLOW_HOME"):
        if not os.environ.get(var):
            print(f"missing env {var}", file=sys.stderr)
            return 2
    Worker().serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
