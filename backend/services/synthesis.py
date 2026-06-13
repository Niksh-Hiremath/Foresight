"""
Synthesis service: fuse agent findings + MiroFish simulation into a final verdict report.
Includes a deterministic fallback if LLM JSON parsing fails.
"""
from __future__ import annotations

import json
import re

from config import settings
from models.severity import calculate_risk_score, get_verdict, score_breakdown
from services.llm_client import get_llm_client

_SYNTHESIS_PROMPT = """\
You are the final synthesis layer of an adversarial red-team due-diligence platform focused \
on the INDIAN market. You receive structured findings from five expert red-team agents \
(CFO, Market, Competitor, Legal, Execution) plus a multi-scenario simulation outcome. \
Your job is to produce a hard-hitting, evidence-backed verdict report.

OUTPUT: Return ONLY a valid JSON object — no markdown fences, no prose outside the JSON.

JSON schema (strict):
{
  "executive_summary": "<3–4 hard-hitting adversarial paragraphs — cite specific findings, \
name the agents who flagged them, and reference the simulation scenario that validates the risk>",
  "verdict": "<one of: DO_NOT_PROCEED | PROCEED_WITH_CAUTION | PROCEED>",
  "verdict_label": "<human-readable: Do Not Proceed | Proceed with Caution | Proceed>",
  "key_questions": [
    "<investor question 1 — specific, unanswerable without more data>",
    "<investor question 2>",
    "<investor question 3>"
  ],
  "gtm_strategy": "<4–6 paragraphs: India-specific go-to-market strategy. Must include: \
(a) recommended entry channels (enterprise direct, channel partners, B2B2C, telesales, \
regional SIs); (b) pricing posture for India (value-based vs penetration vs freemium); \
(c) sequencing — tier-1 cities first, when to expand tier-2; \
(d) regulatory navigation specific to India (IT Act, DPDP, SEBI/RBI if fintech); \
(e) talent and execution adaptations for the Indian context>"
}"""


def _top_n(findings: list[dict], severity: str, n: int) -> list[dict]:
    return [f for f in findings if f.get("severity") == severity][:n]


def _build_prompt_input(
    findings: list[dict],
    score_info: dict,
    simulation: dict | None,
) -> str:
    top_critical = _top_n(findings, "CRITICAL", 5)
    top_high = _top_n(findings, "HIGH", 4)

    lines = [
        f"RISK SCORE: {score_info['risk_score']}/100",
        f"VERDICT: {score_info['verdict']} ({score_info['verdict_label']})",
        f"FINDING COUNTS: {score_info['counts']['CRITICAL']} critical, "
        f"{score_info['counts']['HIGH']} high, {score_info['counts']['MEDIUM']} medium",
        "",
        "=== TOP CRITICAL FINDINGS ===",
    ]
    for f in top_critical:
        lines += [
            f"[{f['agent'].upper()}] {f['vulnerability']}",
            f"  Attack vector: {f['attack'][:300]}",
            f"  Investor question: {f['question']}",
        ]

    lines += ["", "=== TOP HIGH FINDINGS ==="]
    for f in top_high:
        lines += [
            f"[{f['agent'].upper()}] {f['vulnerability']}",
            f"  Investor question: {f['question']}",
        ]

    if simulation:
        bull = (simulation.get("bull") or "")[:400]
        base = (simulation.get("base") or "")[:400]
        bear = (simulation.get("bear") or "")[:400]
        lines += [
            "", "=== SIMULATION OUTCOMES ===",
            f"BULL: {bull}",
            f"BASE: {base}",
            f"BEAR: {bear}",
        ]

    return "\n".join(lines)


def _deterministic_fallback(
    findings: list[dict],
    score_info: dict,
    simulation: dict | None,
) -> dict:
    verdict = score_info["verdict"]
    verdict_label = score_info["verdict_label"]
    score = score_info["risk_score"]
    counts = score_info["counts"]

    all_questions = [f.get("question", "") for f in findings if f.get("question")]
    key_questions = [q for q in all_questions if q][:3]
    while len(key_questions) < 3:
        key_questions.append("What specific risk mitigation plan exists for this area?")

    sim_note = ""
    if simulation and not simulation.get("is_stub"):
        bear = (simulation.get("bear") or "")[:200]
        sim_note = f" Simulation modelling confirms the bear scenario: {bear}"

    exec_summary = (
        f"Red-team analysis of this decision surfaced {score_info['total_findings']} findings "
        f"({counts['CRITICAL']} critical, {counts['HIGH']} high, {counts['MEDIUM']} medium), "
        f"yielding a Risk Score of {score}/100 — {verdict_label}. "
        f"The CFO agent identified financial inconsistencies and missing metrics that undermine "
        f"the stated revenue thesis. The Market agent found addressable market assumptions that "
        f"are unsubstantiated by current India-specific data. The Competitor agent flagged "
        f"entrenched incumbents with deeper distribution moats. The Legal agent identified "
        f"regulatory exposure under DPDP and sector-specific compliance gaps. "
        f"The Execution agent questioned leadership bench strength and realistic ramp timelines.{sim_note} "
        f"In aggregate, the risk profile does not support proceeding without material de-risking."
    )

    gtm_strategy = (
        "India Entry Strategy: Begin with tier-1 metro markets (Mumbai, Bengaluru, Delhi-NCR, "
        "Hyderabad) targeting established enterprise accounts where proof-of-concept pilots can "
        "be landed within a 90-day sales cycle. Avoid broad consumer-market bets until the "
        "product-market fit signal is clear.\n\n"
        "Channel: Lead with direct enterprise sales backed by a small, senior solution-engineering "
        "team. Supplement with 2–3 regional system integrator (SI) partnerships in months 6–12 "
        "to extend reach without proportional headcount cost. Avoid telesales and channel-reseller "
        "models until the playbook is proven at ≥10 enterprise references.\n\n"
        "Pricing Posture: Adopt value-based pricing anchored to quantified productivity gains or "
        "risk reduction outcomes. India buyers are price-sensitive but will pay for demonstrable "
        "ROI — avoid freemium, which commoditises the offering before trust is established. "
        "INR-denominated contracts recommended to remove FX friction in procurement.\n\n"
        "Regulatory Navigation: Engage a Bengaluru-based DPDP compliance counsel from day one. "
        "If the product touches financial data, schedule a pre-engagement meeting with the "
        "relevant RBI/SEBI regulatory sandbox team. Build a data-residency architecture that "
        "satisfies both current and anticipated localisation requirements.\n\n"
        "Sequencing: Months 1–6: 3–5 lighthouse enterprise accounts in tier-1 cities, "
        "build case studies. Months 7–12: SI partner activation, tier-2 expansion pilot "
        "(Pune, Ahmedabad, Chennai). Month 13+: scale based on proven unit economics."
    )

    return {
        "executive_summary": exec_summary,
        "verdict": verdict,
        "verdict_label": verdict_label,
        "key_questions": key_questions,
        "gtm_strategy": gtm_strategy,
    }


async def synthesize(
    findings: list[dict],
    simulation: dict | None = None,
) -> dict:
    """
    Call the LLM to synthesize a final verdict report.
    Falls back deterministically if the LLM fails or returns malformed JSON.
    """
    score_info = score_breakdown(findings)

    try:
        prompt_input = _build_prompt_input(findings, score_info, simulation)
        client = get_llm_client()
        resp = await client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": _SYNTHESIS_PROMPT},
                {"role": "user", "content": prompt_input},
            ],
            temperature=0.3,
        )
        raw = resp.choices[0].message.content or ""

        # Extract JSON — tolerate prose wrapping it
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            raise ValueError("No JSON object found in LLM output")
        parsed = json.loads(match.group())

        # Validate required keys
        required = {"executive_summary", "verdict", "verdict_label", "key_questions", "gtm_strategy"}
        missing = required - set(parsed)
        if missing:
            raise ValueError(f"Missing keys: {missing}")

        return {**parsed, "risk_score": score_info["risk_score"], "is_fallback": False}

    except Exception:
        fallback = _deterministic_fallback(findings, score_info, simulation)
        return {**fallback, "risk_score": score_info["risk_score"], "is_fallback": True}
