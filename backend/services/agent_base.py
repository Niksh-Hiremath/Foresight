"""
Agent abstraction for adversarial red-team agents.
Each agent has a system prompt + accesses RAG grounding via get_agent_context.
Findings are emitted in VULNERABILITY / SEVERITY / ATTACK / QUESTION blocks.
"""
from __future__ import annotations

import re

from config import settings
from rag import get_agent_context
from services.llm_client import get_llm_client

_FINDING_PATTERN = re.compile(
    r"VULNERABILITY:\s*(.+?)\r?\n"
    r"SEVERITY:\s*(CRITICAL|HIGH|MEDIUM)\r?\n"
    r"ATTACK:\s*(.*?)(?=\r?\nQUESTION:)"
    r"\r?\nQUESTION:\s*(.*?)(?=\r?\nVULNERABILITY:|\Z)",
    re.DOTALL,
)


_FIELD_NORMALIZER = re.compile(
    r"(?<!\n)\s*(VULNERABILITY:|SEVERITY:|ATTACK:|QUESTION:)",
)


def _normalize(text: str) -> str:
    """Ensure each field keyword starts on its own line."""
    return _FIELD_NORMALIZER.sub(r"\n\1", text).strip()


def parse_findings(text: str, agent_name: str) -> list[dict]:
    """Parse VULNERABILITY/SEVERITY/ATTACK/QUESTION blocks from agent output."""
    normalized = _normalize(text)
    out = []
    for i, m in enumerate(_FINDING_PATTERN.finditer(normalized), 1):
        out.append(
            {
                "id": f"{agent_name}_{i}",
                "agent": agent_name,
                "vulnerability": m.group(1).strip(),
                "severity": m.group(2).strip(),
                "attack": m.group(3).strip(),
                "question": m.group(4).strip(),
                "sources": [],
            }
        )
    return out


async def run_agent(
    agent_name: str,
    system_prompt: str,
    decision_context: str,
    domain: str | None = None,
    extra_evidence: str = "",
) -> list[dict]:
    """
    Run a single agent against a decision context.
    Grounds the call with RAG chunks from the uploaded document.
    Returns parsed findings list.
    """
    grounding = get_agent_context(decision_context[:200], top_k=6, domain=domain)
    if extra_evidence:
        grounding = f"{grounding}\n\nLIVE EVIDENCE:\n{extra_evidence}" if grounding else extra_evidence

    user_msg = f"DECISION CONTEXT:\n{decision_context}"
    if grounding:
        user_msg += f"\n\nGROUNDING EVIDENCE FROM DOCUMENT:\n{grounding}"

    client = get_llm_client()
    resp = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.4,
    )
    raw = resp.choices[0].message.content or ""
    findings = parse_findings(raw, agent_name)
    if not findings:
        # LLM didn't follow the format — create a single generic finding
        findings = [
            {
                "id": f"{agent_name}_1",
                "agent": agent_name,
                "vulnerability": f"{agent_name.upper()} analysis produced unstructured output",
                "severity": "MEDIUM",
                "attack": raw[:500] if raw else "No output returned.",
                "question": "Can you provide more detail on the financial projections?",
                "sources": [],
            }
        ]
    return findings
