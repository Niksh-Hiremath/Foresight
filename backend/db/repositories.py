from db.client import get_db
from models.schemas import Decision, IntakeContext, AgentFinding, Simulation, Verdict


async def create_decision(doc: Decision) -> Decision:
    await get_db()["decisions"].insert_one(doc.model_dump())
    return doc


async def get_decision(decision_id: str) -> Decision | None:
    raw = await get_db()["decisions"].find_one({"id": decision_id})
    return Decision(**raw) if raw else None


async def create_intake_context(doc: IntakeContext) -> IntakeContext:
    await get_db()["intake_context"].insert_one(doc.model_dump())
    return doc


async def get_intake_context(decision_id: str) -> IntakeContext | None:
    raw = await get_db()["intake_context"].find_one({"decision_id": decision_id})
    return IntakeContext(**raw) if raw else None


async def update_intake_context(doc: IntakeContext) -> IntakeContext:
    await get_db()["intake_context"].replace_one(
        {"decision_id": doc.decision_id}, doc.model_dump()
    )
    return doc


async def create_agent_finding(doc: AgentFinding) -> AgentFinding:
    await get_db()["agent_findings"].insert_one(doc.model_dump())
    return doc


async def get_agent_findings(decision_id: str) -> list[AgentFinding]:
    cursor = get_db()["agent_findings"].find({"decision_id": decision_id})
    return [AgentFinding(**raw) async for raw in cursor]


async def create_simulation(doc: Simulation) -> Simulation:
    await get_db()["simulations"].insert_one(doc.model_dump())
    return doc


async def get_simulation(decision_id: str) -> Simulation | None:
    raw = await get_db()["simulations"].find_one({"decision_id": decision_id})
    return Simulation(**raw) if raw else None


async def create_verdict(doc: Verdict) -> Verdict:
    await get_db()["verdicts"].insert_one(doc.model_dump())
    return doc


async def get_verdict(decision_id: str) -> Verdict | None:
    raw = await get_db()["verdicts"].find_one({"decision_id": decision_id})
    return Verdict(**raw) if raw else None
