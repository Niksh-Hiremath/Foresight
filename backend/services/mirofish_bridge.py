"""
MiroFish simulation bridge — chains the 7-step Flask pipeline.
Falls back to a stub report if MiroFish is unreachable or fails.
Progress updates are written into the shared sim_info dict so the
SSE stream in analyze.py can emit sim_progress events in real-time.

Key design: reuse an existing built graph (project with status
"graph_completed") instead of building a new one on every call.
Building a new graph consumes Zep Cloud episode quota; reusing skips
Steps 1-2 entirely.
"""
import asyncio
import re
import time
import requests
from openai import OpenAI

MIROFISH_BASE = "http://localhost:5001/api"
_REQUEST_TIMEOUT = 60
_POLL_INTERVAL = 5
_POLL_TIMEOUT = 1800  # 30 min hard cap

_STUB_REPORT = {
    "is_stub": True,
    "bull": (
        "**Bull Scenario (12–24 months):** The decision executes with strong cross-functional "
        "alignment. Key risks are mitigated early; market timing proves favourable. Stakeholder "
        "confidence builds quarter-on-quarter. Revenue targets are met or exceeded within the "
        "projected window."
    ),
    "base": (
        "**Base Scenario (12–24 months):** Partial execution — core milestones reached but "
        "secondary initiatives face delays. Competitive pressure limits net-new wins, though "
        "retention holds. The team adapts tactically; outcomes land within a cautious range "
        "rather than the optimistic projection."
    ),
    "bear": (
        "**Bear Scenario (12–24 months):** Key risks materialise — execution gaps, regulatory "
        "friction, or adverse market shifts compress the timeline and addressable opportunity. "
        "Stakeholder confidence erodes; the leadership team must decide whether to pivot, "
        "defer, or restructure the initiative."
    ),
    "opinion_dynamics": {
        "leadership": "Divided; optimists push forward while skeptics call for more validation.",
        "investors": "Risk-averse; shift to cautiously positive only if early milestones hit.",
        "regulators": "Watchful; introduce friction in base/bear scenarios.",
        "customers": "Demand proof before commitment; early adopters in bull, laggards in bear.",
    },
    "mirofish_id": "",
    "markdown_content": "",
    "sections": [],
}


def _is_available() -> bool:
    try:
        r = requests.get("http://localhost:5001/health", timeout=5)
        return r.ok
    except Exception:
        return False


def _find_existing_graph() -> tuple[str, str] | None:
    """
    Query MiroFish for any project that already has a built graph.
    Returns (project_id, graph_id) or None.
    Reusing an existing graph avoids consuming Zep episode quota.
    """
    try:
        resp = requests.get(
            f"{MIROFISH_BASE}/graph/project/list",
            params={"limit": 50},
            timeout=10,
        ).json()
        projects = (resp.get("data") or [])
        for p in projects:
            status = str(p.get("status", "")).lower()
            graph_id = p.get("graph_id")
            if status == "graph_completed" and graph_id:
                return p["project_id"], graph_id
    except Exception:
        pass
    return None


def _normalize(raw: dict) -> dict:
    sections = raw.get("sections") or []
    bull = base = bear = ""

    for s in sections:
        title = (s.get("title") or "").lower()
        content = s.get("content") or ""
        if any(k in title for k in ("bull", "optimist", "upside", "positive")):
            bull = content
        elif any(k in title for k in ("bear", "pessim", "downside", "risk")):
            bear = content
        elif any(k in title for k in ("base", "expect", "neutral", "likely", "moderate")):
            base = content

    if not (bull or base or bear):
        md = raw.get("markdown_content", "")
        paras = [p for p in md.split("\n\n") if p.strip()]
        third = max(1, len(paras) // 3)
        bull = "\n\n".join(paras[:third]) if paras else ""
        base = "\n\n".join(paras[third:2*third]) if paras else ""
        bear = "\n\n".join(paras[2*third:]) if paras else ""

    return {
        "is_stub": False,
        "bull": bull,
        "base": base,
        "bear": bear,
        "opinion_dynamics": raw.get("opinion_dynamics") or {},
        "mirofish_id": raw.get("_simulation_id", ""),
        "markdown_content": raw.get("markdown_content", ""),
        "sections": sections,
    }


def _run_sync(seed_md: str, requirement: str, max_rounds: int = 5,
              sim_info: dict | None = None) -> dict:
    """
    Blocking 7-step MiroFish pipeline. Runs in a thread executor.
    sim_info is mutated at every step with {phase, pct, sim_id}.

    Steps 1-2 (ontology + graph build) are SKIPPED if MiroFish already
    has a completed project — this avoids hitting the Zep episode limit.
    """

    def update(phase: str, pct: int) -> None:
        if sim_info is not None:
            sim_info["phase"] = phase
            sim_info["pct"] = pct

    # ── Try to reuse an existing graph (skip Zep quota consumption) ──────────
    update("Checking for existing knowledge graph", 3)
    existing = _find_existing_graph()

    if existing:
        project_id, graph_id = existing
        update("Reusing existing knowledge graph", 30)
    else:
        # ── Step 1: Ontology generation ──────────────────────────────────────
        update("Analyzing document & generating ontology", 5)
        r1 = requests.post(
            f"{MIROFISH_BASE}/graph/ontology/generate",
            data={
                "project_name": "Foresight Analysis",
                "simulation_requirement": requirement,
                "additional_context": "",
            },
            files={"files": ("seed.md", seed_md.encode("utf-8"), "text/markdown")},
            timeout=1800,
        ).json()
        if not r1.get("success"):
            raise RuntimeError(f"Step 1 (ontology/generate) failed: {r1}")
        project_id = r1["data"]["project_id"]
        update("Ontology generated — building knowledge graph", 15)

        # ── Step 2: Graph build (async task, poll until complete) ─────────────
        r2 = requests.post(
            f"{MIROFISH_BASE}/graph/build",
            json={"project_id": project_id},
            timeout=_REQUEST_TIMEOUT,
        ).json()
        if not r2.get("success"):
            raise RuntimeError(f"Step 2 (graph/build) start failed: {r2}")
        task_id = r2["data"]["task_id"]

        deadline = time.time() + _POLL_TIMEOUT
        while time.time() < deadline:
            resp = requests.get(
                f"{MIROFISH_BASE}/graph/task/{task_id}",
                timeout=_REQUEST_TIMEOUT,
            ).json()
            data = resp.get("data") or {}
            status = str(data.get("status", "")).lower()
            inner_pct = int(data.get("progress") or 0)
            update("Building knowledge graph", 15 + int(15 * inner_pct / 100))
            if status == "completed":
                graph_id = (
                    (data.get("result") or {}).get("graph_id")
                    or data.get("graph_id")
                )
                break
            if status in ("failed", "error"):
                raise RuntimeError(f"Step 2 (graph/build) failed: {resp}")
            time.sleep(_POLL_INTERVAL)
        else:
            raise RuntimeError("Step 2 (graph/build) timed out")
        update("Knowledge graph ready", 30)

    # ── Step 3: Create simulation ─────────────────────────────────────────────
    update("Initializing simulation", 32)
    r3 = requests.post(
        f"{MIROFISH_BASE}/simulation/create",
        json={
            "project_id": project_id,
            "graph_id": graph_id,          # explicit — avoids "graph not built" error
            "enable_twitter": True,
            "enable_reddit": True,
        },
        timeout=_REQUEST_TIMEOUT,
    ).json()
    if not r3.get("success"):
        raise RuntimeError(f"Step 3 (simulation/create) failed: {r3}")
    sim_id = r3["data"]["simulation_id"]
    if sim_info is not None:
        sim_info["sim_id"] = sim_id

    # ── Step 4: Prepare — generate agent personas (poll until ready) ──────────
    update("Preparing agent profiles", 35)
    r4 = requests.post(
        f"{MIROFISH_BASE}/simulation/prepare",
        json={
            "simulation_id": sim_id,
            "use_llm_for_profiles": True,
            "parallel_profile_count": 3,   # 3 matches spike; 10 generates too many agents
        },
        timeout=_REQUEST_TIMEOUT,
    ).json()
    prepare_task_id = (r4.get("data") or {}).get("task_id")

    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        resp = requests.post(
            f"{MIROFISH_BASE}/simulation/prepare/status",
            json={"task_id": prepare_task_id},   # spike sends only task_id (not simulation_id)
            timeout=_REQUEST_TIMEOUT,
        ).json()
        data = resp.get("data") or {}
        status = str(data.get("status", "")).lower()
        inner_pct = int(data.get("progress") or 0)
        update("Generating agent profiles", 35 + int(20 * inner_pct / 100))
        if status in ("ready", "completed"):
            break
        if status in ("failed", "error"):
            raise RuntimeError(f"Step 4 (simulation/prepare) failed: {resp}")
        time.sleep(5)
    update("Agent profiles ready", 56)

    # ── Step 5: Start simulation & poll run-status ────────────────────────────
    requests.post(
        f"{MIROFISH_BASE}/simulation/start",
        json={
            "simulation_id": sim_id,
            "platform": "parallel",
            "max_rounds": max_rounds,
            "num_agents": 10,
            "enable_graph_memory_update": False,
        },
        timeout=_REQUEST_TIMEOUT,
    )
    update("Launching agent swarm", 57)

    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        resp = requests.get(
            f"{MIROFISH_BASE}/simulation/{sim_id}/run-status",
            timeout=_REQUEST_TIMEOUT,
        ).json()
        data = resp.get("data") or {}
        runner_status = str(data.get("runner_status", "")).lower()
        if runner_status in ("completed", "stopped", "idle"):
            update("Agent swarm complete", 85)
            break
        if runner_status in ("failed", "error"):
            raise RuntimeError(f"Step 5 (simulation/run) failed: {resp}")
        current_round = int(data.get("current_round") or 0)
        total_rounds = int(data.get("total_rounds") or max_rounds or 1)
        round_pct = current_round / max(1, total_rounds)
        update(
            f"Agent swarm — round {current_round}/{total_rounds}",
            57 + int(28 * round_pct),
        )
        time.sleep(_POLL_INTERVAL)

    # ── Step 6: Generate report ───────────────────────────────────────────────
    update("Generating swarm report", 87)
    r6 = requests.post(
        f"{MIROFISH_BASE}/report/generate",
        json={"simulation_id": sim_id},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    report_task_id = (r6.get("data") or {}).get("task_id")

    if report_task_id:
        # Poll via task_id (matches spike's approach)
        deadline = time.time() + _POLL_TIMEOUT
        while time.time() < deadline:
            resp = requests.post(
                f"{MIROFISH_BASE}/report/generate/status",
                json={"task_id": report_task_id},
                timeout=_REQUEST_TIMEOUT,
            ).json()
            data = resp.get("data") or {}
            report_status = str(data.get("status", "")).lower()
            if report_status == "completed":
                break
            if report_status in ("failed", "error"):
                raise RuntimeError(f"Step 6 (report/generate) failed: {resp}")
            time.sleep(5)
    else:
        # Fallback: poll the check endpoint
        deadline = time.time() + _POLL_TIMEOUT
        while time.time() < deadline:
            resp = requests.get(
                f"{MIROFISH_BASE}/report/check/{sim_id}",
                timeout=_REQUEST_TIMEOUT,
            ).json()
            data = resp.get("data") or {}
            report_status = str(data.get("report_status", "")).lower()
            if report_status == "completed":
                break
            if report_status in ("failed", "error"):
                raise RuntimeError(f"Step 6 (report/check) failed: {resp}")
            time.sleep(5)
    update("Fetching final report", 96)

    # ── Step 7: Fetch report ──────────────────────────────────────────────────
    r7 = requests.get(
        f"{MIROFISH_BASE}/report/by-simulation/{sim_id}",
        timeout=_REQUEST_TIMEOUT,
    ).json()
    report_data = r7.get("data") or {}
    report_data["_simulation_id"] = sim_id
    return report_data


def _has_chinese(text: str) -> bool:
    return bool(text) and any('一' <= c <= '鿿' for c in text)


def _translate_one(text: str, llm: OpenAI, model: str) -> str:
    if not _has_chinese(text):
        return text
    resp = llm.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional translator. Translate the following text from Chinese to English. "
                    "Preserve all markdown formatting, headings, bullet points, bold/italic markers, and structure exactly. "
                    "Preserve the original meaning and business context faithfully. "
                    "Return ONLY the translated text — no preamble, no explanation."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.2,
        max_tokens=8192,
    )
    content = resp.choices[0].message.content or ""
    # Strip <think>…</think> blocks some models emit
    return re.sub(r'<think>[\s\S]*?</think>', '', content).strip()


async def translate_sim_result(sim_result: dict) -> dict:
    """
    Translate any Chinese content in the simulation result to English.
    Operates on: bull, base, bear, markdown_content.
    Returns the same dict with translated values; no-ops if no Chinese detected.
    Runs LLM calls in a thread executor so the event loop stays unblocked.
    """
    _FIELDS = ("bull", "base", "bear", "markdown_content")

    if not any(_has_chinese(sim_result.get(f, "")) for f in _FIELDS):
        return sim_result

    from config import settings  # local import avoids circular dep at module level

    llm = OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url)
    model = settings.llm_model

    def _do_all() -> dict:
        out = dict(sim_result)
        for field in _FIELDS:
            out[field] = _translate_one(out.get(field, ""), llm, model)
        return out

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _do_all)


async def run_simulation(seed_md: str, requirement: str, max_rounds: int = 5,
                         sim_info: dict | None = None) -> dict:
    """
    Run the full 7-step MiroFish pipeline (or stub if unavailable).
    Returns a normalized dict with bull/base/bear/opinion_dynamics/markdown_content.
    sim_info is mutated with {phase, pct, sim_id} throughout execution.
    """
    if not _is_available():
        return dict(_STUB_REPORT)

    try:
        loop = asyncio.get_event_loop()
        raw = await loop.run_in_executor(
            None, lambda: _run_sync(seed_md, requirement, max_rounds, sim_info)
        )
        return _normalize(raw)
    except Exception as exc:
        return {**dict(_STUB_REPORT), "stub_reason": str(exc)}
