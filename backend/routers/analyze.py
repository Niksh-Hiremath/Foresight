"""
POST /analyze — end-to-end pipeline over SSE.
Agents (parallel) → severity score → simulation (with progress) → GTM agent → synthesis → complete.
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
    create_simulation,
)
from models.schemas import AgentFinding, Verdict, Simulation
from models.severity import score_breakdown
from services.agents.cfo_agent import run_cfo_agent
from services.agents.market_agent import run_market_agent
from services.agents.competitor_agent import run_competitor_agent
from services.agents.legal_agent import run_legal_agent
from services.agents.execution_agent import run_execution_agent
from services.firecrawl_service import get_market_grounding, get_competitor_grounding
from services.mirofish_bridge import run_simulation, translate_sim_result
from services.seed_composer import compose_seed_for_decision
from services.agents_report import compile_agents_report
from services.gtm_agent import run_gtm_agent
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

        # ── Phase 1: Agents ──────────────────────────────────────────────────
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

        # ── Phase 2: Severity score ──────────────────────────────────────────
        all_findings_raw = [f.model_dump(mode="json") for f in await get_agent_findings(req.decision_id)]
        score_info = score_breakdown(all_findings_raw)
        yield sse({"event": "scoring", "progress": 90, **score_info})

        # ── Phase 3: Simulation ──────────────────────────────────────────────
        yield sse({"event": "simulating", "progress": 93})

        existing_sim = await get_simulation(req.decision_id)
        if existing_sim and not req.force_rerun:
            sim_dict = {
                "bull": existing_sim.bull,
                "base": existing_sim.base,
                "bear": existing_sim.bear,
                "opinion_dynamics": existing_sim.opinion_dynamics,
                "markdown_content": existing_sim.swarm_report_md,
                "is_stub": not existing_sim.mirofish_id,
            }
            swarm_report_md = existing_sim.swarm_report_md
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
            last_phase = None
            last_pct = None
            while not sim_task.done():
                phase = sim_info.get("phase")
                pct = sim_info.get("pct")
                if phase and (phase != last_phase or pct != last_pct):
                    yield sse({"event": "sim_progress", "phase": phase, "pct": pct or 0})
                    last_phase = phase
                    last_pct = pct
                try:
                    await asyncio.wait_for(asyncio.shield(sim_task), timeout=5)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
            sim_result = sim_task.result()

            # Translate any Chinese fields before persisting
            yield sse({"event": "sim_progress", "phase": "Translating swarm report", "pct": 98})
            sim_result = await translate_sim_result(sim_result)

            swarm_report_md = sim_result.get("markdown_content", "")

            sim_doc = Simulation(
                decision_id=req.decision_id,
                seed=seed_result["seed"],
                bull=sim_result.get("bull", ""),
                base=sim_result.get("base", ""),
                bear=sim_result.get("bear", ""),
                opinion_dynamics=sim_result.get("opinion_dynamics", {}),
                mirofish_id=sim_result.get("mirofish_id", ""),
                swarm_report_md=swarm_report_md,
            )
            await create_simulation(sim_doc)
            sim_dict = sim_result

        # ── Phase 4: Compile agents report (instant) ─────────────────────────
        agents_report_md = compile_agents_report(all_findings_raw, intake)

        # ── Phase 5: GTM agent + Synthesis (parallel LLM calls) ─────────────
        yield sse({"event": "gtm_start", "progress": 94})

        seed_text = locals().get("seed_result", {}).get("seed", "")
        gtm_task = asyncio.create_task(
            run_gtm_agent(
                seed_content=seed_text,
                agents_report_md=agents_report_md,
                swarm_report_md=swarm_report_md,
            )
        )
        synth_task = asyncio.create_task(synthesize(all_findings_raw, sim_dict))

        pending_final = {gtm_task, synth_task}
        gtm_done = synth_done = False
        while pending_final:
            done_set, pending_final = await asyncio.wait(
                pending_final, return_when=asyncio.FIRST_COMPLETED, timeout=10
            )
            if not done_set:
                yield ": heartbeat\n\n"
                continue
            if gtm_task in done_set:
                gtm_done = True
            if synth_task in done_set:
                synth_done = True
                yield sse({"event": "synthesizing", "progress": 97})

        gtm_report_md = gtm_task.result()
        report = synth_task.result()

        # ── Phase 6: Persist verdict with all reports ─────────────────────────
        existing_verdict = await get_stored_verdict(req.decision_id)
        if not existing_verdict or req.force_rerun:
            verdict_doc = Verdict(
                decision_id=req.decision_id,
                risk_score=report["risk_score"],
                verdict=report["verdict"],
                executive_summary=report["executive_summary"],
                key_questions=report.get("key_questions", []),
                gtm_strategy=report.get("gtm_strategy", ""),
                agents_report_md=agents_report_md,
                gtm_report_md=gtm_report_md,
            )
            await create_verdict(verdict_doc)

        # ── Complete ──────────────────────────────────────────────────────────
        yield sse({
            "event": "complete",
            "progress": 100,
            "reports_ready": True,
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
