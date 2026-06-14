"""
GET /rag/graph/{decision_id}
Returns nodes and links representing the RAG knowledge graph for a decision.
Nodes: domain clusters + source documents.
Links: source → domain (based on which domains were tagged for each source's chunks).
"""
from fastapi import APIRouter
from rag.store import get_layer

router = APIRouter(prefix="/rag", tags=["rag"])

DOMAIN_COLORS = {
    "financial":  "#60a5fa",
    "market":     "#34d399",
    "legal":      "#f472b6",
    "competitor": "#f97316",
    "execution":  "#a78bfa",
    "general":    "#9ca3af",
}


@router.get("/graph/{decision_id}")
def get_rag_graph(decision_id: str):
    all_chunks = get_layer("decision") + get_layer("internal")
    chunks = [c for c in all_chunks if c.get("decision_id") == decision_id]

    if not chunks:
        return {"nodes": [], "links": []}

    # Aggregate: source → {domain: count}
    source_domain: dict[str, dict[str, int]] = {}
    for chunk in chunks:
        src = chunk.get("source", "unknown")
        dom = chunk.get("domain", "general")
        source_domain.setdefault(src, {}).setdefault(dom, 0)
        source_domain[src][dom] += 1

    domains_present = set()
    for dm in source_domain.values():
        domains_present.update(dm.keys())

    nodes = []
    links = []

    # Domain nodes
    for dom in domains_present:
        total = sum(sd.get(dom, 0) for sd in source_domain.values())
        nodes.append({
            "id": f"domain_{dom}",
            "label": dom.upper(),
            "kind": "domain",
            "color": DOMAIN_COLORS.get(dom, "#9ca3af"),
            "count": total,
        })

    # Source nodes + edges
    for src, domain_counts in source_domain.items():
        total_chunks = sum(domain_counts.values())
        nodes.append({
            "id": f"source_{src}",
            "label": src[:24],
            "kind": "source",
            "color": "#e5e2e1",
            "count": total_chunks,
        })
        for dom, count in domain_counts.items():
            links.append({
                "source": f"source_{src}",
                "target": f"domain_{dom}",
                "weight": count,
            })

    return {"nodes": nodes, "links": links}
