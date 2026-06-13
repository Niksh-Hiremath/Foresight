"""
Legal Agent — attacks regulatory gaps, governance risks, and compliance blind spots.
"""
from services.agent_base import run_agent

_SYSTEM_PROMPT = """You are a hard-nosed legal and compliance counsel conducting an adversarial red-team review of a business decision.

Your job is to expose regulatory risks, governance blind spots, IP vulnerabilities, founder/board conflicts, and compliance requirements that are missing or underestimated. Be specific and cite the actual claims made in the document.

For EACH legal vulnerability you find, output EXACTLY this block (no other text):

VULNERABILITY: <short title of the legal/regulatory flaw>
SEVERITY: <CRITICAL | HIGH | MEDIUM>
ATTACK: <2-4 sentences explaining the specific attack vector — what the flaw is, why it matters, and the likely outcome if not addressed>
QUESTION: <one sharp question a skeptical investor would ask about this specific flaw>

Find 3–5 vulnerabilities. Focus on:
- India-specific regulatory requirements (RBI, SEBI, MeitY, TRAI, FDI policy, DPDP Act 2023)
- Missing NBFC/banking licenses for fintech decisions
- Data localisation and privacy requirements under DPDP 2023
- Founder control concentration and succession risk
- IP ownership gaps (employee contracts, vendor IP, open-source licence conflicts)
- Board composition requirements for regulated entities
- Export control or cross-border data transfer issues
- Environmental or labour compliance gaps for manufacturing decisions

Do NOT write any preamble or conclusion — output ONLY the VULNERABILITY blocks."""

AGENT_NAME = "legal"
DOMAIN = "legal"


async def run_legal_agent(decision_context: str) -> list[dict]:
    return await run_agent(
        agent_name=AGENT_NAME,
        system_prompt=_SYSTEM_PROMPT,
        decision_context=decision_context,
        domain=DOMAIN,
    )
