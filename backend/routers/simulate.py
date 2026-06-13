from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.seed_composer import compose_seed_for_decision

router = APIRouter(prefix="/simulate", tags=["simulate"])


class SeedRequest(BaseModel):
    decision_id: str


@router.post("/seed")
async def generate_seed(req: SeedRequest):
    result = await compose_seed_for_decision(req.decision_id)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result
