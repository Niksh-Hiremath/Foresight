"""
MiroFish simulation bridge — chains the 7-step Flask pipeline.
Falls back to a stub report if MiroFish is unreachable or fails.
Progress updates are written into the shared sim_info dict so the
SSE stream in analyze.py can emit sim_progress events in real-time.
"""
import asyncio
import time
import requests

MIROFISH_BASE = "http://localhost:5001/api"
_REQUEST_TIMEOUT = 60
_POLL_INTERVAL = 5
_POLL_TIMEOUT = 1800  # 30 min hard cap

_STUB_REPORT = {
    "is_stub": True,
    "bull": (
        "**Bull Scenario (12–24 months):** Disciplined execution of the AI-native roadmap "
        "unlocks 15–20% productivity gains across delivery units. Clients accelerate migration "
        "spend; Infosys Topaz becomes the reference platform for AI-first transformation in "
        "BFSI and retail verticals. Margin uplift of 80–120 bps materialises ahead of guidance. "
        "Stakeholder sentiment converges around the brand narrative; institutional investors "
        "re-rate the stock at a 10–15% premium to sector peers."
    ),
    "base": (
        "**Base Scenario (12–24 months):** Partial execution — 60% of planned AI-native "
        "initiatives reach production. Competitive pressure from hyperscaler-native offerings "
        "limits net-new client wins, though renewals hold. Margin uplift lands at 40–60 bps, "
        "below guidance. Stakeholder opinion remains divided: founders and delivery leadership "
        "are optimistic; institutional investors maintain a 'show-me' stance pending proof-of-scale "
        "case studies. Regulatory scrutiny on AI labour displacement adds process overhead."
    ),
    "bear": (
        "**Bear Scenario (12–24 months):** Key risks materialise — critical talent gaps slow "
        "the transformation timeline by 6–9 months. A regulatory ruling on AI-led offshoring "
        "in two target markets triggers client contract renegotiations (est. 3–5% revenue at risk). "
        "Hyperscaler price wars compress the addressable AI services margin. Board confidence erodes; "
        "two senior execution sponsors depart. The USD 300–400B market-size thesis is revised "
        "downward, and the growth trajectory reverts to the pre-AI baseline of 4–5% CC."
    ),
    "opinion_dynamics": {
        "founders": "Optimistic throughout; belief in long-term thesis remains strong.",
        "institutional_investors": "Shift from skeptical to cautiously positive only in bull; flat in base; exit in bear.",
        "regulators": "Risk-averse; introduce friction in base/bear scenarios around AI labour norms.",
        "enterprise_clients": "Demand proof-of-concept; commit in bull, defer in base, freeze in bear.",
        "talent_market": "Constrained supply amplifies execution risk in base and bear.",
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
    """

    def update(phase: str, pct: int) -> None:
        if sim_info is not None:
            sim_info["phase"] = phase
            sim_info["pct"] = pct

    # ── Step 1: Ontology generation ──────────────────────────────────────────
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

    # ── Step 2: Graph build (async task, poll with sub-progress) ─────────────
    r2 = requests.post(
        f"{MIROFISH_BASE}/graph/build",
        json={"project_id": project_id},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    task_id = r2["data"]["task_id"]

    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        resp = requests.get(f"{MIROFISH_BASE}/graph/task/{task_id}",
                            timeout=_REQUEST_TIMEOUT).json()
        data = resp.get("data") or {}
        status = str(data.get("status", "")).lower()
        inner_pct = int(data.get("progress") or 0)
        update("Building knowledge graph", 15 + int(15 * inner_pct / 100))
        if status == "completed":
            break
        if status in ("failed", "error"):
            raise RuntimeError(f"Step 2 (graph/build) failed: {resp}")
        time.sleep(_POLL_INTERVAL)
    update("Knowledge graph ready", 30)

    # ── Step 3: Create simulation ─────────────────────────────────────────────
    update("Initializing simulation", 32)
    r3 = requests.post(
        f"{MIROFISH_BASE}/simulation/create",
        json={"project_id": project_id, "enable_twitter": True, "enable_reddit": True},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    if not r3.get("success"):
        raise RuntimeError(f"Step 3 (simulation/create) failed: {r3}")
    sim_id = r3["data"]["simulation_id"]
    if sim_info is not None:
        sim_info["sim_id"] = sim_id

    # ── Step 4: Prepare — generate agent personas (poll with sub-progress) ────
    update("Preparing agent profiles", 35)
    r4 = requests.post(
        f"{MIROFISH_BASE}/simulation/prepare",
        json={"simulation_id": sim_id, "use_llm_for_profiles": True,
              "parallel_profile_count": 10},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    prepare_task_id = (r4.get("data") or {}).get("task_id")

    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        resp = requests.post(
            f"{MIROFISH_BASE}/simulation/prepare/status",
            json={"simulation_id": sim_id, "task_id": prepare_task_id},
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

    # ── Step 5: Start simulation & poll run-status with per-round progress ────
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
        if runner_status in ("completed", "stopped"):
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
    requests.post(
        f"{MIROFISH_BASE}/report/generate",
        json={"simulation_id": sim_id},
        timeout=_REQUEST_TIMEOUT,
    )

    deadline = time.time() + _POLL_TIMEOUT
    while time.time() < deadline:
        resp = requests.get(f"{MIROFISH_BASE}/report/check/{sim_id}",
                            timeout=_REQUEST_TIMEOUT).json()
        data = resp.get("data") or {}
        report_status = str(data.get("report_status", "")).lower()
        if report_status == "completed":
            break
        if report_status in ("failed", "error"):
            raise RuntimeError(f"Step 6 (report/generate) failed: {resp}")
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
