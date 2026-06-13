"""T1.3 verification: create + read one doc per collection."""
import asyncio, sys
sys.path.insert(0, ".")

from db.repositories import (
    create_decision, get_decision,
    create_intake_context, get_intake_context,
    create_agent_finding, get_agent_findings,
    create_simulation, get_simulation,
    create_verdict, get_verdict,
)
from models.schemas import Decision, IntakeContext, AgentFinding, Simulation, Verdict

DID = "test-decision-001"

async def main():
    d = await create_decision(Decision(id=DID, filename="test.pdf", raw_text="hello world"))
    assert (await get_decision(DID)).filename == "test.pdf"
    print("OK decisions")

    ic = await create_intake_context(IntakeContext(decision_id=DID, core_decision="expand to Tier-2 cities"))
    assert (await get_intake_context(DID)).core_decision == "expand to Tier-2 cities"
    print("OK intake_context")

    af = await create_agent_finding(AgentFinding(decision_id=DID, agent="CFO",
        vulnerability="Revenue projection inflated", severity="HIGH",
        attack="No evidence for 3× growth claim", question="What data supports this?"))
    findings = await get_agent_findings(DID)
    assert len(findings) >= 1
    print("OK agent_findings")

    sim = await create_simulation(Simulation(decision_id=DID, seed="test seed", base="base outcome"))
    assert (await get_simulation(DID)).base == "base outcome"
    print("OK simulations")

    v = await create_verdict(Verdict(decision_id=DID, risk_score=72, verdict="PROCEED WITH CAUTION"))
    assert (await get_verdict(DID)).risk_score == 72
    print("OK verdicts")

    print("\nAll 5 collections OK.")

asyncio.run(main())
