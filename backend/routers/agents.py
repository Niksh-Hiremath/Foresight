import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db.repositories import (
    create_agent_finding,
    get_agent_findings,
    get_intake_context,
)
from models.schemas import AgentFinding
from models.severity import score_breakdown
from services.agents.cfo_agent import run_cfo_agent
from services.agents.market_agent import run_market_agent
from services.agents.competitor_agent import run_competitor_agent
from services.agents.legal_agent import run_legal_agent
from services.agents.execution_agent import run_execution_agent
from services.firecrawl_service import get_market_grounding, get_competitor_grounding

router = APIRouter(prefix="/agents", tags=["agents"])

_AGENT_RUNNERS = {
    "cfo": run_cfo_agent,
    "market": run_market_agent,
    "competitor": run_competitor_agent,
    "legal": run_legal_agent,
    "execution": run_execution_agent,
}

_ALL_AGENTS = list(_AGENT_RUNNERS)


def _build_decision_context(intake) -> str:
    ctx = (
        f"CORE DECISION: {intake.core_decision}\n"
        f"MARKET: {intake.market}\n"
        f"STATED BELIEFS: {intake.stated_beliefs}\n"
        f"FINANCIAL POSTURE: {intake.financial_posture}\n"
        f"IDENTIFIED GAPS: {intake.gaps}\n"
    )
    if intake.follow_up_answers:
        lines = []
        for k, v in intake.follow_up_answers.items():
            q_text = next(
                (q.get("question", k) for q in intake.follow_up_questions if q.get("id") == k),
                k,
            )
            lines.append(f"  Q: {q_text}\n  A: {v}")
        ctx += "\nFOLLOW-UP ANSWERS:\n" + "\n".join(lines)
    return ctx


class RunAgentRequest(BaseModel):
    decision_id: str
    agent: str = "cfo"


@router.post("/run")
async def run_single_agent(req: RunAgentRequest):
    """Run a single named agent against a decision and store findings."""
    if req.agent not in _AGENT_RUNNERS:
        raise HTTPException(400, f"Unknown agent '{req.agent}'. Available: {_ALL_AGENTS}")

    intake = await get_intake_context(req.decision_id)
    if not intake:
        raise HTTPException(404, f"No intake context for decision {req.decision_id}. Run /intake/analyze first.")

    decision_context = _build_decision_context(intake)
    runner = _AGENT_RUNNERS[req.agent]
    try:
        if req.agent == "market":
            evidence = await get_market_grounding(decision_context)
            findings = await runner(decision_context, extra_evidence=evidence)
        elif req.agent == "competitor":
            evidence = await get_competitor_grounding(decision_context)
            findings = await runner(decision_context, extra_evidence=evidence)
        else:
            findings = await runner(decision_context)
    except Exception as exc:
        raise HTTPException(500, f"Agent run failed: {exc}")

    saved = []
    for f in findings:
        doc = AgentFinding(
            decision_id=req.decision_id,
            agent=f["agent"],
            vulnerability=f["vulnerability"],
            severity=f["severity"],
            attack=f["attack"],
            question=f["question"],
            sources=f.get("sources", []),
        )
        await create_agent_finding(doc)
        saved.append(doc.model_dump(mode="json"))

    return {
        "decision_id": req.decision_id,
        "agent": req.agent,
        "findings_count": len(saved),
        "findings": saved,
    }


class RunAllRequest(BaseModel):
    decision_id: str


@router.post("/run-all")
async def run_all_agents_sse(req: RunAllRequest):
    """Fan-out all 5 agents in parallel, stream results via SSE as each completes."""
    intake = await get_intake_context(req.decision_id)
    if not intake:
        raise HTTPException(404, f"No intake context for decision {req.decision_id}")

    decision_context = _build_decision_context(intake)

    async def event_stream():
        def sse(data: dict) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

        yield sse({"event": "start", "agents": _ALL_AGENTS, "progress": 0})

        # Emit agent_start for all agents immediately
        for name in _ALL_AGENTS:
            yield sse({"event": "agent_start", "agent": name})

        # Pre-fetch Firecrawl grounding for market + competitor in parallel
        market_evidence, competitor_evidence = await asyncio.gather(
            get_market_grounding(decision_context),
            get_competitor_grounding(decision_context),
        )

        # Create tasks
        async def run_one(name: str):
            runner = _AGENT_RUNNERS[name]
            if name == "market":
                return name, await runner(decision_context, extra_evidence=market_evidence)
            if name == "competitor":
                return name, await runner(decision_context, extra_evidence=competitor_evidence)
            return name, await runner(decision_context)

        tasks = {asyncio.create_task(run_one(name)): name for name in _ALL_AGENTS}
        pending = set(tasks)
        all_findings = []
        done_count = 0

        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED, timeout=10)
            if not done:
                # Heartbeat to keep connection alive while LLM is running
                yield ": heartbeat\n\n"
                continue
            for task in done:
                try:
                    agent_name, findings = task.result()
                except Exception as exc:
                    agent_name = tasks[task]
                    yield sse({"event": "agent_error", "agent": agent_name, "error": str(exc)})
                    continue

                # Persist each finding
                saved = []
                for f in findings:
                    doc = AgentFinding(
                        decision_id=req.decision_id,
                        agent=f["agent"],
                        vulnerability=f["vulnerability"],
                        severity=f["severity"],
                        attack=f["attack"],
                        question=f["question"],
                        sources=f.get("sources", []),
                    )
                    await create_agent_finding(doc)
                    saved.append(doc.model_dump(mode="json"))

                all_findings.extend(saved)
                done_count += 1
                progress = int(done_count / len(_ALL_AGENTS) * 90)
                yield sse({
                    "event": "agent_complete",
                    "agent": agent_name,
                    "findings": saved,
                    "progress": progress,
                })

        yield sse({
            "event": "complete",
            "all_findings": all_findings,
            "findings_count": len(all_findings),
            "progress": 100,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/findings/{decision_id}")
async def get_findings(decision_id: str):
    findings = await get_agent_findings(decision_id)
    return {"decision_id": decision_id, "findings": [f.model_dump(mode="json") for f in findings]}


@router.get("/score/{decision_id}")
async def get_risk_score(decision_id: str):
    findings = await get_agent_findings(decision_id)
    if not findings:
        raise HTTPException(404, f"No findings for decision {decision_id}. Run /agents/run-all first.")
    raw = [f.model_dump(mode="json") for f in findings]
    return {"decision_id": decision_id, **score_breakdown(raw)}
