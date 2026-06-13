"""Compose a MiroFish seed document from DecisionContext + top agent findings."""
from db.repositories import get_intake_context, get_agent_findings
from models.severity import score_breakdown, get_verdict

_SEV_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}


def _top_findings(findings: list, max_critical: int = 5, max_high: int = 4, max_medium: int = 2) -> list:
    by_sev: dict[str, list] = {"CRITICAL": [], "HIGH": [], "MEDIUM": []}
    for f in findings:
        sev = f.get("severity", "")
        if sev in by_sev:
            by_sev[sev].append(f)
    selected = (
        by_sev["CRITICAL"][:max_critical]
        + by_sev["HIGH"][:max_high]
        + by_sev["MEDIUM"][:max_medium]
    )
    seen_vuln: set[str] = set()
    deduped = []
    for f in selected:
        key = f.get("vulnerability", "")[:60]
        if key not in seen_vuln:
            seen_vuln.add(key)
            deduped.append(f)
    return deduped


def compose_seed(intake, findings_raw: list[dict]) -> str:
    score_info = score_breakdown(findings_raw) if findings_raw else {}
    risk_score = score_info.get("risk_score", 0)
    verdict_label = score_info.get("verdict_label", "Proceed with Caution")
    top = _top_findings(findings_raw)

    agent_labels = {
        "cfo": "Chief Financial Officer",
        "market": "Market Analyst",
        "competitor": "Competitive Intelligence",
        "legal": "Legal & Compliance",
        "execution": "Execution Risk",
    }

    lines = [
        "# STRATEGIC DECISION SIMULATION SEED",
        "",
        "## The Decision Under Review",
        intake.core_decision,
        "",
        "## Market Context",
        intake.market,
        "",
        "## Stated Beliefs & Assumptions",
        intake.stated_beliefs,
        "",
        "## Financial Posture",
        intake.financial_posture,
        "",
    ]

    if intake.gaps:
        lines += [
            "## Identified Gaps",
            intake.gaps,
            "",
        ]

    if intake.follow_up_answers:
        lines.append("## Clarifications from Decision Maker")
        for k, v in intake.follow_up_answers.items():
            q_text = next(
                (q.get("question", k) for q in intake.follow_up_questions if q.get("id") == k),
                k,
            )
            lines.append(f"- **{q_text}**: {v}")
        lines.append("")

    lines += [
        f"## Red Team Assessment Summary",
        f"Risk Score: {risk_score}/100 — {verdict_label}",
        f"Total findings: {score_info.get('total_findings', len(findings_raw))} "
        f"({score_info.get('counts', {}).get('CRITICAL', 0)} critical, "
        f"{score_info.get('counts', {}).get('HIGH', 0)} high, "
        f"{score_info.get('counts', {}).get('MEDIUM', 0)} medium)",
        "",
    ]

    if top:
        lines.append("## Key Risk Vectors")
        for f in top:
            agent_label = agent_labels.get(f.get("agent", ""), f.get("agent", "Unknown"))
            sev = f.get("severity", "MEDIUM")
            lines += [
                f"### [{sev}] {f.get('vulnerability', 'Unknown Risk')}",
                f"**Source perspective:** {agent_label}",
                f"**How this could play out:** {f.get('attack', '')}",
                f"**Critical question:** {f.get('question', '')}",
            ]
            if f.get("sources"):
                lines.append(f"**Evidence:** {'; '.join(f['sources'][:2])}")
            lines.append("")

    lines += [
        "## Simulation Parameters",
        "- Simulate 3 scenarios: bull (optimistic execution), base (expected), bear (key risks materialise)",
        "- Key uncertain variables: market adoption rate, competitive response speed, "
        "regulatory environment, execution capability, capital availability",
        "- Time horizon: 24 months post-decision",
        "- India market context: tier-1 city rollout with tier-2 expansion in month 12",
        "- Key stakeholders: Founders, CFO, Board, Series B investors, Regulatory body, Enterprise customers",
        "",
        "## Opinion Dynamics Seed",
        "Model diverging stakeholder views. Founders are optimistic; institutional investors are skeptical "
        "of the stated assumptions; regulators are risk-averse; early enterprise customers are cautiously "
        "interested but demand proof-of-concept. Simulate how these opinions converge or diverge over 24 months "
        "as the key risks above either materialise or are mitigated.",
    ]

    return "\n".join(lines)


async def compose_seed_for_decision(decision_id: str) -> dict:
    intake = await get_intake_context(decision_id)
    if not intake:
        return {"error": f"No intake context for decision {decision_id}"}

    findings = await get_agent_findings(decision_id)
    findings_raw = [f.model_dump(mode="json") for f in findings]

    seed_text = compose_seed(intake, findings_raw)

    score_info = score_breakdown(findings_raw) if findings_raw else {}

    return {
        "decision_id": decision_id,
        "seed": seed_text,
        "risk_score": score_info.get("risk_score", 0),
        "verdict": score_info.get("verdict", "PROCEED_WITH_CAUTION"),
        "verdict_label": score_info.get("verdict_label", "Proceed with Caution"),
        "finding_count": len(findings_raw),
    }
