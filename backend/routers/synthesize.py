from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.repositories import (
    get_agent_findings,
    get_simulation,
    get_verdict as get_stored_verdict,
    create_verdict,
)
from models.schemas import Verdict
from services.synthesis import synthesize

router = APIRouter(prefix="/synthesize", tags=["synthesize"])


class SynthesizeRequest(BaseModel):
    decision_id: str
    force_rerun: bool = False


@router.post("")
async def run_synthesis(req: SynthesizeRequest):
    """
    Fuse agent findings + simulation into a final verdict report.
    Caches result in verdicts collection. Returns cached if exists.
    """
    if not req.force_rerun:
        existing = await get_stored_verdict(req.decision_id)
        if existing:
            return _verdict_response(existing)

    findings = await get_agent_findings(req.decision_id)
    if not findings:
        raise HTTPException(
            404,
            f"No findings for decision {req.decision_id}. Run /agents/run-all first.",
        )

    simulation = await get_simulation(req.decision_id)
    sim_dict = (
        {
            "bull": simulation.bull,
            "base": simulation.base,
            "bear": simulation.bear,
            "opinion_dynamics": simulation.opinion_dynamics,
            "is_stub": not simulation.mirofish_id,
        }
        if simulation
        else None
    )

    findings_raw = [f.model_dump(mode="json") for f in findings]
    result = await synthesize(findings_raw, sim_dict)

    doc = Verdict(
        decision_id=req.decision_id,
        risk_score=result["risk_score"],
        verdict=result["verdict"],
        executive_summary=result["executive_summary"],
        key_questions=result.get("key_questions", []),
        gtm_strategy=result.get("gtm_strategy", ""),
    )
    await create_verdict(doc)

    return {
        **_verdict_response(doc),
        "verdict_label": result.get("verdict_label", ""),
        "is_fallback": result.get("is_fallback", False),
    }


@router.get("/{decision_id}")
async def get_synthesis(decision_id: str):
    doc = await get_stored_verdict(decision_id)
    if not doc:
        raise HTTPException(
            404,
            f"No verdict for decision {decision_id}. Run POST /synthesize first.",
        )
    return _verdict_response(doc)


def _verdict_response(v: Verdict) -> dict:
    return {
        "decision_id": v.decision_id,
        "risk_score": v.risk_score,
        "verdict": v.verdict,
        "executive_summary": v.executive_summary,
        "key_questions": v.key_questions,
        "gtm_strategy": v.gtm_strategy,
        "created_at": v.created_at.isoformat(),
    }
