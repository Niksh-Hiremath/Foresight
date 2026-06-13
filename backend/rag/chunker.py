from __future__ import annotations

DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "financial": ["revenue", "ebitda", "loss", "valuation", "margin", "debt", "cash",
                  "burn", "runway", "profit", "funding", "investment", "arpu", "ltv"],
    "market": ["customer", "demand", "growth", "churn", "retention", "product",
               "segment", "tam", "sam", "adoption", "market", "pricing", "b2b", "b2c"],
    "legal": ["governance", "founder", "control", "board", "conflict", "trademark",
              "regulation", "compliance", "ip", "patent", "contract", "liability"],
    "competitor": ["competitor", "incumbent", "benchmark", "moat", "comparison",
                   "alternative", "differentiation", "advantage", "versus", "rival"],
    "execution": ["operations", "expansion", "headcount", "leadership", "scale",
                  "hiring", "roadmap", "milestone", "delivery", "team", "cto", "coo"],
}


def tag_domain(text: str) -> str:
    lower = text.lower()
    scores = {
        domain: sum(1 for kw in kws if kw in lower)
        for domain, kws in DOMAIN_KEYWORDS.items()
    }
    best = max(scores, key=lambda d: scores[d])
    return best if scores[best] > 0 else "general"


def chunk_text(text: str, size: int = 512, overlap: int = 64) -> list[str]:
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunks.append(" ".join(words[i : i + size]))
        if i + size >= len(words):
            break
        i += size - overlap
    return chunks
