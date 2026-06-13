from fastapi import APIRouter, HTTPException

from db.repositories import get_simulation, get_verdict

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/{decision_id}")
async def get_reports(decision_id: str):
    sim = await get_simulation(decision_id)
    verdict = await get_verdict(decision_id)

    if not sim and not verdict:
        raise HTTPException(404, f"No reports found for decision {decision_id}")

    return {
        "decision_id": decision_id,
        "agents_report_md": getattr(verdict, "agents_report_md", "") if verdict else "",
        "swarm_report_md": getattr(sim, "swarm_report_md", "") if sim else "",
        "gtm_report_md": getattr(verdict, "gtm_report_md", "") if verdict else "",
    }
