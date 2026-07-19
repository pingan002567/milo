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


def _emit(obj) -> None:
    sys.stdout.write(encode(obj) + "\n")
    sys.stdout.flush()


class Worker:
    def __init__(self) -> None:
        self._client: Any = None
        self._member: str = ""
        self._threads: dict[str, str] = {}

    # ---- 方法 ----------------------------------------------------------
    def enroll(self, params: dict) -> dict:
        from deerflow.client import DeerFlowClient  # 延迟导入：加速非 enroll 路径

        self._member = params["member"]
        workdir = Path(params["workdir"])
        checkpointer = self._make_checkpointer(workdir)
        self._client = DeerFlowClient(
            config_path=str(workdir / "config.yaml"),
            agent_name=self._member,
            checkpointer=checkpointer,
        )
        return {"member": self._member, "checkpointer": checkpointer is not None}

    def assign(self, params: dict) -> dict:
        task_id = params["task_id"]
        prompt = params["prompt"]
        thread_id = self._threads.setdefault(task_id, f"{self._member}-{task_id}")
        self._pump(task_id, prompt, thread_id)
        return {"task_id": task_id, "thread_id": thread_id}

    def resume(self, params: dict) -> dict:
        """组长答复后恢复被 ask_clarification 中断的任务（同 thread + checkpointer）。"""
        task_id = params["task_id"]
        thread_id = self._threads.get(task_id, f"{self._member}-{task_id}")
        self._pump(task_id, params["answer"], thread_id)
        return {"task_id": task_id, "resumed": True}

    def deliver(self, params: dict) -> dict:
        task_id = params["task_id"]
        thread_id = self._threads.get(task_id, f"{self._member}-{task_id}")
        out: list[dict] = []
        for rel in params.get("artifacts", []):
            try:
                content, media_type = self._client.get_artifact(thread_id, rel)
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

    def _pump(self, task_id: str, message: str, thread_id: str) -> None:
        for frame in iter_normalized(
            self._client.stream(message, thread_id=thread_id), task_id=task_id
        ):
            _emit(frame)

    # ---- 主循环 --------------------------------------------------------
    def serve(self) -> None:
        handlers = {
            "enroll": self.enroll,
            "assign": self.assign,
            "resume": self.resume,
            "deliver": self.deliver,
            "ping": lambda p: {"pong": True},
        }
        for line in sys.stdin:
            msg = decode_line(line)
            if not isinstance(msg, Request):
                continue
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
