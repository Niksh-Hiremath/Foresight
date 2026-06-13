"""Compile 5-agent findings into a structured markdown report document."""
from __future__ import annotations

_AGENT_LABELS: dict[str, tuple[str, str]] = {
    "cfo":        ("CFO Agent",        "Financial Risk Analysis"),
    "market":     ("Market Agent",     "Market Opportunity & Sizing"),
    "competitor": ("Competitor Agent", "Competitive Landscape"),
    "legal":      ("Legal Agent",      "Legal & Regulatory Risk"),
    "execution":  ("Execution Agent",  "Execution & Operational Risk"),
}

_SEV_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}
_AGENT_ORDER = ["cfo", "market", "competitor", "legal", "execution"]


def compile_agents_report(findings: list[dict], intake=None) -> str:
    lines: list[str] = ["# Five-Agent Red Team Analysis Report\n\n"]

    if intake and getattr(intake, "core_decision", ""):
        lines += [
            "## Decision Under Review\n\n",
            f"{intake.core_decision}\n\n",
            "---\n\n",
        ]

    by_agent: dict[str, list] = {}
    for f in findings:
        agent = f.get("agent", "unknown")
        by_agent.setdefault(agent, []).append(f)

    for agent in by_agent:
        by_agent[agent].sort(key=lambda f: _SEV_ORDER.get(f.get("severity", "MEDIUM"), 3))

    # Summary table
    lines.append("## Summary\n\n")
    lines.append("| Agent | Critical | High | Medium | Total |\n")
    lines.append("|-------|:--------:|:----:|:------:|:-----:|\n")
    total_c = total_h = total_m = 0
    for agent_key in _AGENT_ORDER:
        fs = by_agent.get(agent_key, [])
        c = sum(1 for f in fs if f.get("severity") == "CRITICAL")
        h = sum(1 for f in fs if f.get("severity") == "HIGH")
        m = sum(1 for f in fs if f.get("severity") == "MEDIUM")
        label = _AGENT_LABELS.get(agent_key, (agent_key, ""))[0]
        lines.append(f"| {label} | {c} | {h} | {m} | {len(fs)} |\n")
        total_c += c
        total_h += h
        total_m += m
    total = total_c + total_h + total_m
    lines.append(f"| **TOTAL** | **{total_c}** | **{total_h}** | **{total_m}** | **{total}** |\n\n")
    lines.append("---\n\n")

    # Per-agent sections
    for agent_key in _AGENT_ORDER:
        fs = by_agent.get(agent_key, [])
        label, subtitle = _AGENT_LABELS.get(agent_key, (agent_key, agent_key))
        lines.append(f"## {label}: {subtitle}\n\n")

        if not fs:
            lines.append("_No findings from this agent._\n\n---\n\n")
            continue

        for f in fs:
            sev = f.get("severity", "MEDIUM")
            vuln = f.get("vulnerability", "Unknown")
            attack = f.get("attack", "")
            question = f.get("question", "")
            sources = f.get("sources", [])

            lines.append(f"### [{sev}] {vuln}\n\n")
            if attack:
                lines.append(f"**Attack Vector / How This Plays Out:**\n\n{attack}\n\n")
            if question:
                lines.append(f"**Investor Question:**\n\n_{question}_\n\n")
            if sources:
                src_lines = "\n".join(f"- {s}" for s in sources[:3])
                lines.append(f"**Evidence:**\n\n{src_lines}\n\n")

        lines.append("---\n\n")

    return "".join(lines)
