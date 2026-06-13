SEVERITY_WEIGHTS = {"CRITICAL": 30, "HIGH": 15, "MEDIUM": 5}

_VERDICT_LABELS = {
    "DO_NOT_PROCEED": "Do Not Proceed",
    "PROCEED_WITH_CAUTION": "Proceed with Caution",
    "PROCEED": "Proceed",
}


def calculate_risk_score(findings: list[dict]) -> int:
    base = sum(SEVERITY_WEIGHTS.get(f.get("severity", ""), 0) for f in findings)
    agents_critical = {f["agent"] for f in findings if f.get("severity") == "CRITICAL"}
    agents_high = {f["agent"] for f in findings if f.get("severity") == "HIGH"}
    if len(agents_critical) >= 2:
        base += 10
    if len(agents_high) >= 3:
        base += 5
    return min(base, 100)


def get_verdict(score: int) -> str:
    if score >= 80:
        return "DO_NOT_PROCEED"
    if score >= 50:
        return "PROCEED_WITH_CAUTION"
    return "PROCEED"


def score_breakdown(findings: list[dict]) -> dict:
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0}
    for f in findings:
        sev = f.get("severity", "")
        if sev in counts:
            counts[sev] += 1

    base = sum(SEVERITY_WEIGHTS[s] * counts[s] for s in counts)
    agents_critical = {f["agent"] for f in findings if f.get("severity") == "CRITICAL"}
    agents_high = {f["agent"] for f in findings if f.get("severity") == "HIGH"}
    bonus_critical = 10 if len(agents_critical) >= 2 else 0
    bonus_high = 5 if len(agents_high) >= 3 else 0
    total = min(base + bonus_critical + bonus_high, 100)

    return {
        "risk_score": total,
        "verdict": get_verdict(total),
        "verdict_label": _VERDICT_LABELS[get_verdict(total)],
        "base_score": base,
        "bonus_critical_convergence": bonus_critical,
        "bonus_high_convergence": bonus_high,
        "counts": counts,
        "total_findings": len(findings),
    }
