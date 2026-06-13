"""
POST /analyze — end-to-end pipeline over SSE.
Agents (parallel) → severity score → simulation → synthesis → complete.
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db.repositories import (
    create_agent_finding,
    get_agent_findings,
    get_intake_context,
    get_simulation,
    get_verdict as get_stored_verdict,
    create_verdict,
)
from models.schemas import AgentFinding, Verdict
from models.severity import score_breakdown
from services.agents.cfo_agent import run_cfo_agent
from services.agents.market_agent import run_market_agent
from services.agents.competitor_agent import run_competitor_agent
from services.agents.legal_agent import run_legal_agent
from services.agents.execution_agent import run_execution_agent
from services.firecrawl_service import get_market_grounding, get_competitor_grounding
from services.mirofish_bridge import run_simulation
from services.seed_composer import compose_seed_for_decision
from services.synthesis import synthesize

router = APIRouter(prefix="/analyze", tags=["analyze"])

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


class AnalyzeRequest(BaseModel):
    decision_id: str
    max_sim_rounds: int = 5
    force_rerun: bool = False


@router.post("")
async def run_full_pipeline(req: AnalyzeRequest):
    intake = await get_intake_context(req.decision_id)
    if not intake:
        raise HTTPException(404, f"No intake context for decision {req.decision_id}. Run /intake/analyze first.")

    async def event_stream():
        def sse(data: dict) -> str:
            return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

        decision_context = _build_decision_context(intake)

        yield sse({"event": "start", "agents": _ALL_AGENTS, "progress": 0})

        # ── Phase 1: Agents ──────────────────────────────────────────
        for name in _ALL_AGENTS:
            yield sse({"event": "agent_start", "agent": name})

        market_evidence, competitor_evidence = await asyncio.gather(
            get_market_grounding(decision_context),
            get_competitor_grounding(decision_context),
        )

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
                yield ": heartbeat\n\n"
                continue
            for task in done:
                try:
                    agent_name, findings = task.result()
                except Exception as exc:
                    agent_name = tasks[task]
                    yield sse({"event": "agent_error", "agent": agent_name, "error": str(exc)})
                    continue

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
                progress = int(done_count / len(_ALL_AGENTS) * 85)
                yield sse({"event": "agent_complete", "agent": agent_name,
                           "findings": saved, "progress": progress})

        # ── Phase 2: Severity score ──────────────────────────────────
        all_findings_raw = [f.model_dump(mode="json") for f in await get_agent_findings(req.decision_id)]
        score_info = score_breakdown(all_findings_raw)
        yield sse({"event": "scoring", "progress": 90, **score_info})

        # ── Phase 3: Simulation ──────────────────────────────────────
        yield sse({"event": "simulating", "progress": 93})

        existing_sim = await get_simulation(req.decision_id)
        if existing_sim and not req.force_rerun:
            sim_dict = {
                "bull": existing_sim.bull,
                "base": existing_sim.base,
                "bear": existing_sim.bear,
                "opinion_dynamics": existing_sim.opinion_dynamics,
                "is_stub": not existing_sim.mirofish_id,
            }
        else:
            seed_result = await compose_seed_for_decision(req.decision_id)
            requirement = (
                f"Predict stakeholder and market reactions over 24 months if: "
                f"{intake.core_decision[:300]}"
            )
            sim_info: dict = {}
            sim_task = asyncio.create_task(
                run_simulation(seed_result["seed"], requirement, req.max_sim_rounds, sim_info)
            )
            sim_id_emitted = False
            while not sim_task.done():
                # As soon as MiroFish creates the simulation, emit the live-view URL
                if not sim_id_emitted and sim_info.get("sim_id"):
                    yield sse({
                        "event": "sim_started",
                        "sim_id": sim_info["sim_id"],
                        "mirofish_url": f"http://localhost:3000/simulation/{sim_info['sim_id']}/start",
                    })
                    sim_id_emitted = True
                try:
                    await asyncio.wait_for(asyncio.shield(sim_task), timeout=10)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
            sim_result = sim_task.result()

            from models.schemas import Simulation
            from db.repositories import create_simulation
            sim_doc = Simulation(
                decision_id=req.decision_id,
                seed=seed_result["seed"],
                bull=sim_result.get("bull", ""),
                base=sim_result.get("base", ""),
                bear=sim_result.get("bear", ""),
                opinion_dynamics=sim_result.get("opinion_dynamics", {}),
                mirofish_id=sim_result.get("mirofish_id", ""),
            )
            await create_simulation(sim_doc)
            sim_dict = sim_result

        # ── Phase 4: Synthesis ───────────────────────────────────────
        yield sse({"event": "synthesizing", "progress": 96})

        existing_verdict = await get_stored_verdict(req.decision_id)
        if existing_verdict and not req.force_rerun:
            report = {
                "risk_score": existing_verdict.risk_score,
                "verdict": existing_verdict.verdict,
                "verdict_label": existing_verdict.verdict,
                "executive_summary": existing_verdict.executive_summary,
                "key_questions": existing_verdict.key_questions,
                "gtm_strategy": existing_verdict.gtm_strategy,
                "is_fallback": False,
            }
        else:
            synth_task = asyncio.create_task(synthesize(all_findings_raw, sim_dict))
            while not synth_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(synth_task), timeout=10)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
            report = synth_task.result()

            verdict_doc = Verdict(
                decision_id=req.decision_id,
                risk_score=report["risk_score"],
                verdict=report["verdict"],
                executive_summary=report["executive_summary"],
                key_questions=report.get("key_questions", []),
                gtm_strategy=report.get("gtm_strategy", ""),
            )
            await create_verdict(verdict_doc)

        # ── Complete ─────────────────────────────────────────────────
        yield sse({
            "event": "complete",
            "progress": 100,
            "score": score_info,
            "report": {
                **report,
                "bull": sim_dict.get("bull", ""),
                "base": sim_dict.get("base", ""),
                "bear": sim_dict.get("bear", ""),
                "opinion_dynamics": sim_dict.get("opinion_dynamics", {}),
            },
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
