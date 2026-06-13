from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.repositories import create_simulation, get_simulation, get_intake_context
from models.schemas import Simulation
from services.seed_composer import compose_seed_for_decision
from services.mirofish_bridge import run_simulation

router = APIRouter(prefix="/simulate", tags=["simulate"])


class SeedRequest(BaseModel):
    decision_id: str


class RunRequest(BaseModel):
    decision_id: str
    max_rounds: int = 8
    force_rerun: bool = False


@router.post("/seed")
async def generate_seed(req: SeedRequest):
    result = await compose_seed_for_decision(req.decision_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@router.post("/run")
async def run_mirofish(req: RunRequest):
    """
    Run the full MiroFish 7-step simulation for a decision.
    Returns cached result if one exists and force_rerun is False.
    Falls back to a stub report if MiroFish is unreachable.
    """
    # Return cached result unless force_rerun
    if not req.force_rerun:
        existing = await get_simulation(req.decision_id)
        if existing:
            return _simulation_response(existing)

    # Compose seed
    seed_result = await compose_seed_for_decision(req.decision_id)
    if "error" in seed_result:
        raise HTTPException(404, seed_result["error"])

    intake = await get_intake_context(req.decision_id)
    core_decision = intake.core_decision if intake else "Strategic decision analysis"
    requirement = (
        f"Predict stakeholder and market reactions over the next 24 months "
        f"if the following decision is executed: {core_decision[:300]}"
    )

    # Run simulation (or get stub if MiroFish is down)
    result = await run_simulation(
        seed_md=seed_result["seed"],
        requirement=requirement,
        max_rounds=req.max_rounds,
    )

    # Persist to simulations collection
    doc = Simulation(
        decision_id=req.decision_id,
        seed=seed_result["seed"],
        bull=result.get("bull", ""),
        base=result.get("base", ""),
        bear=result.get("bear", ""),
        opinion_dynamics=result.get("opinion_dynamics", {}),
        mirofish_id=result.get("mirofish_id", ""),
    )
    await create_simulation(doc)

    return {
        **_simulation_response(doc),
        "is_stub": result.get("is_stub", False),
        "stub_reason": result.get("stub_reason"),
    }


@router.get("/result/{decision_id}")
async def get_simulation_result(decision_id: str):
    sim = await get_simulation(decision_id)
    if not sim:
        raise HTTPException(404, f"No simulation for decision {decision_id}. Run POST /simulate/run first.")
    return _simulation_response(sim)


def _simulation_response(sim: Simulation) -> dict:
    return {
        "decision_id": sim.decision_id,
        "bull": sim.bull,
        "base": sim.base,
        "bear": sim.bear,
        "opinion_dynamics": sim.opinion_dynamics,
        "mirofish_id": sim.mirofish_id,
        "created_at": sim.created_at.isoformat(),
    }
