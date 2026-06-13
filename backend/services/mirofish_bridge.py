"""
MiroFish simulation bridge — chains the 7-step Flask pipeline.
Falls back to a stub report if MiroFish is unreachable or fails.
"""
import asyncio
import time
import requests

MIROFISH_BASE = "http://localhost:5001/api"
_REQUEST_TIMEOUT = 60
_POLL_INTERVAL = 5
_POLL_TIMEOUT = 1800  # 30 min hard cap on simulation step

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


def _poll(method: str, url: str, *, json_body=None, key: str,
          done_states: set, fail_states: set = None,
          interval: int = _POLL_INTERVAL, timeout: int = _POLL_TIMEOUT) -> dict:
    if fail_states is None:
        fail_states = {"failed", "error"}
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = requests.request(method, url, json=json_body, timeout=_REQUEST_TIMEOUT).json()
        data = resp.get("data") or {}
        val = str(data.get(key, "")).lower()
        if val in done_states:
            return data
        if val in fail_states:
            raise RuntimeError(f"MiroFish step failed at {url}: {resp}")
        time.sleep(interval)
    raise TimeoutError(f"MiroFish timed out polling {url} (key={key})")


def _normalize(raw: dict) -> dict:
    """Extract bull/base/bear + opinion_dynamics from raw MiroFish report dict."""
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

    # Fall back: split markdown_content into thirds
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


def _run_sync(seed_md: str, requirement: str, max_rounds: int = 8) -> dict:
    """Blocking 7-step MiroFish pipeline. Intended to be run in a thread executor."""

    # 1. Create project + ingest seed document
    r1 = requests.post(
        f"{MIROFISH_BASE}/graph/ontology/generate",
        data={
            "project_name": "Foresight Analysis",
            "simulation_requirement": requirement,
            "additional_context": "",
        },
        files={"files": ("seed.md", seed_md.encode("utf-8"), "text/markdown")},
        timeout=120,
    ).json()
    if not r1.get("success"):
        raise RuntimeError(f"Step 1 (ontology/generate) failed: {r1}")
    project_id = r1["data"]["project_id"]

    # 2. Build GraphRAG knowledge graph (async task)
    r2 = requests.post(
        f"{MIROFISH_BASE}/graph/build",
        json={"project_id": project_id},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    task_id = r2["data"]["task_id"]
    _poll("GET", f"{MIROFISH_BASE}/graph/task/{task_id}",
          key="status", done_states={"completed"})

    # 3. Create simulation
    r3 = requests.post(
        f"{MIROFISH_BASE}/simulation/create",
        json={"project_id": project_id, "enable_twitter": True, "enable_reddit": True},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    if not r3.get("success"):
        raise RuntimeError(f"Step 3 (simulation/create) failed: {r3}")
    sim_id = r3["data"]["simulation_id"]

    # 4. Prepare — generate agent personas
    r4 = requests.post(
        f"{MIROFISH_BASE}/simulation/prepare",
        json={"simulation_id": sim_id, "use_llm_for_profiles": True, "parallel_profile_count": 5},
        timeout=_REQUEST_TIMEOUT,
    ).json()
    prepare_task_id = (r4.get("data") or {}).get("task_id")
    _poll("POST", f"{MIROFISH_BASE}/simulation/prepare/status",
          json_body={"simulation_id": sim_id, "task_id": prepare_task_id},
          key="status", done_states={"ready", "completed"}, interval=5)

    # 5. Start simulation (slowest step)
    requests.post(
        f"{MIROFISH_BASE}/simulation/start",
        json={
            "simulation_id": sim_id,
            "platform": "parallel",
            "max_rounds": max_rounds,
            "enable_graph_memory_update": False,
        },
        timeout=_REQUEST_TIMEOUT,
    )
    _poll("GET", f"{MIROFISH_BASE}/simulation/{sim_id}/run-status",
          key="runner_status", done_states={"completed", "stopped"},
          interval=10, timeout=_POLL_TIMEOUT)

    # 6. Generate report (async)
    requests.post(
        f"{MIROFISH_BASE}/report/generate",
        json={"simulation_id": sim_id},
        timeout=_REQUEST_TIMEOUT,
    )
    _poll("GET", f"{MIROFISH_BASE}/report/check/{sim_id}",
          key="report_status", done_states={"completed"}, interval=5)

    # 7. Fetch final report
    r7 = requests.get(
        f"{MIROFISH_BASE}/report/by-simulation/{sim_id}",
        timeout=_REQUEST_TIMEOUT,
    ).json()
    report_data = r7.get("data") or {}
    report_data["_simulation_id"] = sim_id
    return report_data


async def run_simulation(seed_md: str, requirement: str, max_rounds: int = 8) -> dict:
    """
    Run the full 7-step MiroFish pipeline (or return stub if unavailable).
    Returns a normalized dict with bull/base/bear/opinion_dynamics.
    """
    if not _is_available():
        return dict(_STUB_REPORT)

    try:
        loop = asyncio.get_event_loop()
        raw = await loop.run_in_executor(
            None, lambda: _run_sync(seed_md, requirement, max_rounds)
        )
        return _normalize(raw)
    except Exception as exc:
        return {**dict(_STUB_REPORT), "stub_reason": str(exc)}
