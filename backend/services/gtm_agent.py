"""GTM Agent — synthesizes seed doc + agents report + swarm report into a GTM strategy."""
from __future__ import annotations

from config import settings
from services.llm_client import get_llm_client

_SYSTEM = """\
You are a senior India-market Go-To-Market strategist with 20 years of experience \
launching B2B enterprise software and platform businesses in India. You have deep expertise \
in the Indian regulatory landscape (IT Act, DPDP, SEBI, RBI), enterprise procurement cycles, \
channel dynamics (SIs, VARs, GSIs, direct), and regional sequencing from tier-1 to tier-2 cities.

You will receive three inputs:
1. A seed / strategy document describing the business or decision being analyzed
2. A five-agent red team report identifying key risks and vulnerabilities
3. An agent swarm simulation report showing how stakeholders and markets may react

Produce a COMPREHENSIVE, ACTIONABLE Go-To-Market Strategy Report in Markdown. \
This is a standalone document an executive team can act on directly.

Requirements:
- Minimum 1500 words of substantive, non-generic content
- All recommendations must be India-specific and grounded in the red team findings
- Where risks were identified, state explicitly how the GTM strategy mitigates them
- Reference specific findings from the red team report by agent name
- Use clear markdown headers, bullet lists, and tables where they aid clarity
- Be direct and opinionated — lead with the 3 most critical priorities

Structure:
# Go-To-Market Strategy Report

## 1. Executive GTM Summary
## 2. Target Market & Customer Segmentation
## 3. Channel & Distribution Architecture
## 4. Pricing & Packaging Strategy
## 5. Regulatory Navigation Roadmap
## 6. Talent, Partnerships & Ecosystem
## 7. 18-Month Go-Live Sequencing Plan
## 8. Risk Mitigation in Execution
## 9. Success Metrics & KPIs
"""

_USER_TEMPLATE = """\
## INPUT 1: SEED / STRATEGY DOCUMENT

{seed}

---

## INPUT 2: FIVE-AGENT RED TEAM REPORT

{agents_report}

---

## INPUT 3: AGENT SWARM SIMULATION REPORT

{swarm_report}

---

Now produce the comprehensive GTM Strategy Report in Markdown. Be India-specific, \
be actionable, and directly address the risks surfaced by the red team and simulation.
"""


async def run_gtm_agent(
    seed_content: str,
    agents_report_md: str,
    swarm_report_md: str,
) -> str:
    seed_trimmed = seed_content[:3000]
    agents_trimmed = agents_report_md[:4000]
    swarm_trimmed = swarm_report_md[:4000]

    user_content = _USER_TEMPLATE.format(
        seed=seed_trimmed,
        agents_report=agents_trimmed,
        swarm_report=swarm_trimmed,
    )

    try:
        client = get_llm_client()
        resp = await client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_content},
            ],
            temperature=0.4,
        )
        content = resp.choices[0].message.content or ""
        return content if content.strip() else _fallback()
    except Exception:
        return _fallback()


def _fallback() -> str:
    return """\
# Go-To-Market Strategy Report

> _Fallback report — LLM unavailable. Re-run with force_rerun=true to regenerate._

## 1. Executive GTM Summary

Based on red team findings and simulation outcomes, a phased India market entry is recommended. \
Start with tier-1 enterprise accounts (Mumbai, Bengaluru, Delhi-NCR) before expanding to tier-2 cities.

## 2. Target Market & Customer Segmentation

- **Primary:** Large enterprises (500+ employees) in BFSI, Healthcare, Manufacturing, and IT Services
- **Secondary:** Mid-market companies in tech-forward sectors (edtech, fintech, healthtech)
- **Tertiary:** Government and PSU accounts where compliance capabilities are a differentiator

## 3. Channel & Distribution Architecture

1. **Direct enterprise sales** (months 1–6): Small, senior team focused on lighthouse accounts
2. **System integrator partnerships** (months 6–12): 2–3 regional SIs for distribution leverage
3. **Channel reseller network** (month 12+): Only after playbook is proven at ≥10 references

## 4. Pricing & Packaging Strategy

Value-based pricing anchored to quantified business outcomes. INR-denominated contracts. \
Avoid freemium — commoditises the offering before trust is established.

## 5. Regulatory Navigation Roadmap

- Engage DPDP-specialist legal counsel from day one (Bengaluru-based preferred)
- Build data residency architecture meeting current and anticipated localisation requirements
- If fintech-adjacent: schedule pre-engagement with RBI/SEBI sandbox team in month 2

## 6. Talent, Partnerships & Ecosystem

- Hire locally: India sales leadership with enterprise track record
- Partner with GSI (TCS/Infosys/Wipro) aligned with the solution's vertical focus
- Leverage hyperscaler (AWS/Azure/GCP) co-sell for enterprise credibility

## 7. 18-Month Go-Live Sequencing Plan

| Phase | Timeline | Focus |
|-------|----------|-------|
| Seed | M1–2 | Legal setup, team hire, lighthouse pipeline |
| Launch | M3–6 | 3–5 enterprise POCs, tier-1 cities |
| Scale | M7–12 | SI activation, tier-2 pilot (Pune, Chennai, Ahmedabad) |
| Expand | M13–18 | Full channel, government vertical entry |

## 8. Risk Mitigation in Execution

- Financial risk: Milestone-gated capex; monthly cash-flow reviews
- Regulatory risk: DPDP counsel embedded in product team from day one
- Talent risk: Retain key hires with ESOPs and clear career paths
- Competitive risk: Differentiate on compliance and local support SLAs

## 9. Success Metrics & KPIs

| Metric | M6 Target | M12 Target | M18 Target |
|--------|-----------|------------|------------|
| Enterprise customers | 5 | 20 | 50 |
| ARR | ₹2Cr | ₹10Cr | ₹30Cr |
| NPS | 40 | 50 | 60 |
| CAC payback (months) | — | 18 | 12 |
"""
