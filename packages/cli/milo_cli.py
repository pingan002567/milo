"""milo —— M1 命令行闭环。

  milo init <org>                    初始化组织（org.yaml + bindings.yaml）
  milo add <org> <pack-dir> [--as]   把成员写入编制（人事：仅组长可为）
  milo run <org> "<需求>"            分解→批准→派单→汇报→（升级则问你）→验收
  milo reply <org> <task> "<答复>"   答复被中断的任务
  milo log <org> [group]             查看任务群记录（事件即审计）
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

import yaml

from milod.config.paths import org_dir
from milod.models import EventType
from milod.pack.renderer import load_manifest
from milod.secretariat.decompose import DecomposeError
from milod.secretariat.office import Office, _read_secret
from milod.secretariat.route import NoMemberForTask
from milod.store.repo import Store

C = {"dim": "\033[2m", "b": "\033[1m", "g": "\033[32m", "y": "\033[33m",
     "r": "\033[31m", "c": "\033[36m", "0": "\033[0m"}


def _p(tag: str, msg: str, color: str = "c") -> None:
    print(f"{C[color]}{tag}{C['0']} {msg}")


# ---- init / add ---------------------------------------------------------
def cmd_init(args) -> int:
    root = org_dir(args.org)
    root.mkdir(parents=True, exist_ok=True)
    org_file = root / "org.yaml"
    if org_file.exists():
        _p("[=]", f"已存在 {org_file}", "y")
    else:
        org_file.write_text(
            yaml.safe_dump(
                {"apiVersion": "milo.dev/v1alpha1", "kind": "Organization",
                 "metadata": {"name": args.org},
                 "spec": {"members": [], "limits": {"maxParallelMembers": 5}}},
                allow_unicode=True, sort_keys=False),
            encoding="utf-8")
    binding = root / "bindings.yaml"
    if not binding.exists():
        binding.write_text(
            yaml.safe_dump(
                {"model": {"name": args.model, "provider": args.provider,
                           "model": args.model, "api_base": args.api_base,
                           "secret_env": args.secret_env}},
                allow_unicode=True, sort_keys=False),
            encoding="utf-8")
    _p("[✓]", f"组织 {args.org} 就绪：{root}", "g")
    print(f"    编制 org.yaml / 绑定 bindings.yaml（密钥经 {args.secret_env} 注入，不落盘）")
    return 0


def cmd_add(args) -> int:
    root = org_dir(args.org)
    doc = yaml.safe_load((root / "org.yaml").read_text(encoding="utf-8"))
    pack = Path(args.pack).expanduser().resolve()
    manifest = load_manifest(pack)
    name = args.as_name or manifest["name"]
    members = doc["spec"].setdefault("members", [])
    if any(m["name"] == name for m in members):
        _p("[=]", f"成员 {name} 已在编制中", "y")
        return 0
    if len(members) >= 5:
        _p("[x]", "已达并行上限 5（监督幅度护栏）", "r")
        return 1
    members.append({"name": name, "pack": str(pack)})
    (root / "org.yaml").write_text(
        yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
    caps = "、".join(c["id"] for c in manifest.get("capabilities", []))
    _p("[✓]", f"已招募 {name}（能力：{caps}）", "g")
    return 0


# ---- run ----------------------------------------------------------------
async def _run(args) -> int:
    office = Office(args.org, on_event=_render_event)
    _p("[·]", "启动成员子进程…")
    await office.open()

    group_id = f"g-{uuid.uuid4().hex[:6]}"
    office.start_group(group_id, args.request)  # 落标题 + 记录组长需求
    _p("[·]", f"任务群 {group_id} · 需求：{args.request}")

    # 1) 分解（唯一用 LLM 处）
    prompt = office.plan_prompt(args.request)
    plan_text = await _ask_llm(args.org, prompt)
    try:
        envelopes = office.parse_plan(plan_text, group_id)
    except DecomposeError as e:
        _p("[x]", f"分解失败：{e}", "r")
        await office.close()
        return 1

    print(f"\n{C['b']}执行计划{C['0']}")
    for i, env in enumerate(envelopes, 1):
        print(f"  {i}. [{env.capability}] {env.objective}")
        if env.output_spec.artifacts:
            print(f"     产物：{'、'.join(env.output_spec.artifacts)}")
    if not args.yes and input("\n批准执行？[Y/n] ").strip().lower() in {"n", "no"}:
        _p("[=]", "已取消", "y")
        await office.close()
        return 0

    # 2) 逐步执行：v0 无 DAG，按计划顺序派单并把上一步产物前递给下一步
    print()
    carry: list[str] = []  # 上游交付摘要（artifact 引用 + 摘要）
    for idx, env in enumerate(envelopes, 1):
        if carry:
            env.constraints.append("参考上一步的产出：" + " / ".join(c[:300] for c in carry[-1:]))
        if len(envelopes) > 1:
            _p(f"[{idx}/{len(envelopes)}]", f"{env.capability}", "b")
        try:
            await office.dispatch([env], group_id)
        except NoMemberForTask as e:
            _p("[?]", f"{e} —— 需要你招募合适成员后重试", "y")
            break

        # 等待本步终局；遇升级就地应答（不必另开 reply）
        for _ in range(args.max_rounds + 1):
            await _await_settled(office, group_id, args.timeout)
            blocked = [t for t in office.store.tasks(group_id)
                       if t["state"] == "input_required" and t["task_id"] == env.task_id]
            if not blocked:
                break
            if args.non_interactive or not sys.stdin.isatty():
                _p("[?]", f"{env.task_id} 等你决定 —— "
                          f"milo reply {args.org} {env.task_id} \"你的答复\"", "y")
                break
            answer = _prompt_answer(office, env.task_id)
            if answer is None:
                _p("[=]", f"{env.task_id} 已跳过，稍后可用 milo reply 继续", "y")
                break
            await office.reply(env.task_id, answer)

        # 验收并前递
        row = next((t for t in office.store.tasks(group_id) if t["task_id"] == env.task_id), None)
        if row and row["state"] == "delivered":
            v = await office.collect(env.task_id)
            _p("[✓]" if v.accepted else "[!]", f"{env.task_id} 验收{v.summary}",
               "g" if v.accepted else "y")
            payload = office.last_delivery(env.task_id) or {}
            summary = payload.get("summary") or ""
            arts = payload.get("artifacts") or []
            if arts:
                carry.append("产物 " + "、".join(a["name"] for a in arts if a.get("name")))
            elif summary:
                carry.append(summary)
        elif row and row["state"] == "input_required":
            _p("[?]", f"{env.task_id} 仍等你决定，后续步骤已暂停", "y")
            break

    office.sync_group_status(group_id)
    await office.close()
    return 0


async def _await_settled(office: Office, group_id: str, timeout: float) -> None:
    """等到本轮所有任务都不再运行（交付/待决/失败）。"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(1)
        states = {t["state"] for t in office.store.tasks(group_id)}
        if not (states & {"assigned", "working"}):
            return


def _prompt_answer(office: Office, task_id: str) -> str | None:
    """就地渲染决策卡并读取组长答复。

    渲染依据是 harness 的 human_input_request 契约：
    input_mode=choice_with_other 时列出选项（可输编号），free_text 时直接输入。
    """
    esc = None
    for e in reversed(office.store.group_events(_group_of(office, task_id))):
        if e["type"] == "escalation" and e["task_id"] == task_id:
            esc = e["payload"]
            break
    if not esc:
        return None

    print(f"\n{C['y']}{'─' * 58}{C['0']}")
    print(f"{C['y']}⚠ 需要你决定{C['0']}  [{esc.get('policy')}]  任务 {task_id}")
    if esc.get("context"):
        print(f"{C['dim']}背景：{esc['context']}{C['0']}")
    print(f"\n{esc.get('question') or esc.get('fallback_text') or '（无问题正文）'}")

    options = esc.get("options") or []
    if options:
        print()
        for i, o in enumerate(options, 1):
            print(f"  {i}. {o['label']}")
        print(f"  {C['dim']}或直接输入自定义答复；留空跳过{C['0']}")
    else:
        print(f"\n{C['dim']}（自由输入；留空跳过）{C['0']}")
    print(f"{C['y']}{'─' * 58}{C['0']}")

    raw = input("你的答复 > ").strip()
    if not raw:
        return None
    if options and raw.isdigit() and 1 <= int(raw) <= len(options):
        chosen = options[int(raw) - 1]
        print(f"{C['dim']}已选择：{chosen['label']}{C['0']}")
        return chosen["value"]
    return raw


def _group_of(office: Office, task_id: str) -> str:
    row = next((t for t in office.store.tasks() if t["task_id"] == task_id), None)
    return row["group_id"] if row else task_id


async def _ask_llm(org: str, prompt: str) -> str:
    """直连 provider 做分解——秘书长不经成员。"""
    import httpx

    b = yaml.safe_load((org_dir(org) / "bindings.yaml").read_text(encoding="utf-8"))["model"]
    key = _read_secret(b["secret_env"])
    if not key:
        raise SystemExit(f"缺少凭证：设置环境变量 {b['secret_env']} 或存入钥匙串")
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(
            f"{b['api_base'].rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": b["model"], "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0},
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


def _render_event(ev) -> None:
    who = {"secretariat": "秘书长", "owner": "组长", "system": "系统"}.get(ev.actor, ev.actor)
    if ev.type == EventType.ENVELOPE:
        _p("  →", f"{C['dim']}秘书长 派单给 {ev.payload.get('member')}：{ev.payload.get('objective','')[:60]}{C['0']}")
    elif ev.type == EventType.STATUS:
        _p("  ·", f"{C['dim']}{who}：{str(ev.payload.get('doing',''))[:80]}{C['0']}")
    elif ev.type == EventType.ESCALATION:
        _p("  ⚠", f"{C['y']}{who} 请示（{ev.payload.get('policy')}）：{str(ev.payload.get('question',''))[:100]}{C['0']}")
    elif ev.type == EventType.DELIVERY:
        _p("  ✓", f"{who} 交付：{str(ev.payload.get('summary',''))[:80]}")


def cmd_reply(args) -> int:
    async def go() -> int:
        office = Office(args.org, on_event=_render_event)
        await office.open()
        await office.reply(args.task, args.answer)
        deadline = asyncio.get_event_loop().time() + args.timeout
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(1)
            row = next((t for t in office.store.tasks() if t["task_id"] == args.task), None)
            if row and row["state"] in {"delivered", "input_required"}:
                break
        if row and row["state"] == "delivered":
            v = await office.collect(args.task)
            _p("[✓]" if v.accepted else "[!]", f"验收{v.summary}", "g" if v.accepted else "y")
        await office.close()
        return 0

    return asyncio.run(go())


def cmd_recover(args) -> int:
    """恢复上次崩溃/强退遗留的任务（成员 checkpoint 仍在，接续而非重跑）。"""

    async def go() -> int:
        office = Office(args.org, on_event=_render_event)
        await office.open()
        recovered = await office.recover()
        if not recovered:
            _p("[=]", "没有需要恢复的任务", "y")
        for r in recovered:
            act = "等你答复" if r["action"] == "await_reply" else "已接续执行"
            _p("[✓]", f"{r['task_id']} → {act}", "g")
        if any(r["action"] == "resumed" for r in recovered):
            await asyncio.sleep(args.timeout)
        await office.close()
        return 0

    return asyncio.run(go())


def cmd_log(args) -> int:
    store = Store(org_dir(args.org) / "milo.sqlite")
    if not args.group:
        for g in store.groups():
            if g["group_id"] == "org":
                continue
            mark = f" {C['y']}[{g['pending']} 项待决]{C['0']}" if g["pending"] else ""
            state = {"archived": C["dim"], "waiting": C["y"]}.get(g["status"], "")
            title = g["title"] or "(未命名)"
            print(f"{state}{g['group_id']}{C['0']}  {title:<20} {g['events']:>3} 条  "
                  f"{g['updated_at'][:19]}  [{g['status']}]{mark}")
        return 0
    for e in store.group_events(args.group, category=args.category, run_id=args.run):
        icon = {"envelope": "→", "status": "·", "escalation": "⚠", "delivery": "✓",
                "acceptance": "✔", "chat": "💬", "system": "ℹ"}.get(e["type"], "·")
        run = (e["run_id"] or "")[-4:]
        # content 就是人类可读文本，无需再从 JSON 里挑字段（DeerFlow RunEventRow 式拆分）
        print(f"{e['ts'][11:19]} {icon} [{e['category']:<8}] {run:>4} {e['actor']:<12} "
              f"{e['content'][:80]}")
    return 0


def cmd_eval(args) -> int:
    """质检冒烟：临时实例跑包内 eval/smoke.yaml，实测报告落盘供市场页展示。"""
    from milod.evals import run_smoke
    from milod.evals.smoke import SuiteError

    b = yaml.safe_load((org_dir(args.org) / "bindings.yaml").read_text(encoding="utf-8"))["model"]
    secrets = {b["secret_env"]: _read_secret(b["secret_env"])}
    if not secrets[b["secret_env"]]:
        _p("[!]", f"未找到密钥 {b['secret_env']}（keyring/环境变量均为空），评测无法调模型", "r")
        return 1

    def prog(cid: str, passed: bool, reasons: list[str]) -> None:
        if passed:
            _p("[✓]", cid, "g")
        else:
            _p("[✗]", f"{cid} —— {'；'.join(reasons)}", "r")

    try:
        report = asyncio.run(run_smoke(Path(args.pack).expanduser(), model=b,
                                       secrets=secrets, on_progress=prog))
    except SuiteError as e:
        _p("[!]", str(e), "r")
        return 1
    tone = "g" if report["meets_min"] else "r"
    _p("[评]", f"{report['pack']}@{report['version']}  实测 {report['score']}/5"
       f"（{report['cases_passed']}/{report['cases_total']} 通过）"
       f"  自报门槛 {report['min_score']}  "
       f"{'达标' if report['meets_min'] else '未达标'}", tone)
    from milod.evals import report_path
    print(f"    报告：{report_path(report['pack'], report['version'])}")
    return 0 if report["meets_min"] else 2


def main() -> int:
    ap = argparse.ArgumentParser(prog="milo")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", help="初始化组织")
    p.add_argument("org")
    p.add_argument("--model", default="mimo-v2.5")
    p.add_argument("--provider", default="mimo")
    p.add_argument("--api-base", default="https://api.xiaomimimo.com/v1")
    p.add_argument("--secret-env", default="MIMO_API_KEY")
    p.set_defaults(fn=cmd_init)

    p = sub.add_parser("add", help="招募成员（写入编制）")
    p.add_argument("org"); p.add_argument("pack"); p.add_argument("--as", dest="as_name")
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("run", help="下达需求")
    p.add_argument("org"); p.add_argument("request")
    p.add_argument("-y", "--yes", action="store_true", help="跳过计划批准")
    p.add_argument("--timeout", type=float, default=240)
    p.add_argument("--max-rounds", type=int, default=3, help="最多就地应答几轮升级")
    p.add_argument("--non-interactive", action="store_true", help="遇升级不追问，转为提示 milo reply")
    p.set_defaults(fn=lambda a: asyncio.run(_run(a)))

    p = sub.add_parser("reply", help="答复被中断的任务")
    p.add_argument("org"); p.add_argument("task"); p.add_argument("answer")
    p.add_argument("--timeout", type=float, default=240)
    p.set_defaults(fn=cmd_reply)

    p = sub.add_parser("recover", help="恢复中断的任务（崩溃/强退后）")
    p.add_argument("org")
    p.add_argument("--timeout", type=float, default=120)
    p.set_defaults(fn=cmd_recover)

    p = sub.add_parser("eval", help="质检冒烟（实测报告，市场页据此'验货'）")
    p.add_argument("pack", help="MiloPack 目录")
    p.add_argument("--org", default="demo", help="借用哪个组织的模型绑定（默认 demo）")
    p.set_defaults(fn=cmd_eval)

    p = sub.add_parser("log", help="查看任务群记录")
    p.add_argument("org"); p.add_argument("group", nargs="?")
    p.add_argument("--category", choices=["message", "status", "decision", "outputs",
                                          "error", "trace"], help="按粗分类过滤")
    p.add_argument("--run", help="只看某次执行（run_id）")
    p.set_defaults(fn=cmd_log)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
