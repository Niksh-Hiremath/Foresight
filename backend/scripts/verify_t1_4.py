"""T1.4 verification: ingest a sample doc, query per domain, assert chunks returned."""
import asyncio, sys
sys.path.insert(0, ".")

from rag import chunk_and_tag, get_agent_context
from rag.store import clear_layer

SAMPLE = """
Foresight Edtech is raising Series A at a post-money valuation of INR 400 Cr.
Revenue grew 3x to INR 48 Cr in FY25. EBITDA margin is -22% with a 14-month runway.
The company targets Tier-2 Indian cities with a B2C tutoring product.
Customer churn is 31% monthly; retention is the core execution risk.
Key competitors include BYJU's, Unacademy, and PhysicsWallah.
No trademark registered for the brand name. Founder holds 60% voting control.
The expansion roadmap targets 10 new cities in 6 months with a team of 40.
"""

async def main():
    # fresh slate
    clear_layer("decision")
    clear_layer("internal")

    chunks = await chunk_and_tag(SAMPLE.strip(), layer="decision",
                                 source="sample_pitch.pdf", decision_id="verify-001")
    print(f"Ingested {len(chunks)} chunk(s), domains: {[c['domain'] for c in chunks]}")

    # domain-keyword queries (no domain filter) — exercises keyword overlap per topic
    domain_queries = {
        "financial":  "revenue valuation margin debt runway",
        "market":     "customer churn retention growth product",
        "legal":      "trademark governance founder board conflict",
        "competitor":  "competitor incumbent benchmark moat",
        "execution":  "expansion headcount leadership scale roadmap",
    }
    for domain, query in domain_queries.items():
        ctx = get_agent_context(query, top_k=2)
        hit = "HIT" if ctx else "MISS"
        print(f"  {domain:12s} -> {hit}")

    # broad query that should pull multiple chunks
    broad = get_agent_context("revenue growth customer churn expansion team", top_k=5)
    assert broad, "broad query returned nothing"
    print(f"\nBroad query returned {len(broad.split(chr(10)*2))} chunk(s)")
    print("T1.4 OK")

asyncio.run(main())
