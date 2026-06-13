"""
RAG public API:
  chunk_and_tag(text, layer, source, decision_id)  — ingest
  get_agent_context(query, top_k, domain)           — retrieve
"""
from __future__ import annotations

from rag.chunker import chunk_text, tag_domain
from rag.store import add_chunk, persist_chunk, get_layer, load_from_db


async def chunk_and_tag(
    text: str,
    layer: str,
    source: str = "upload",
    decision_id: str = "",
) -> list[dict]:
    """Chunk text, domain-tag each chunk, store in memory + MongoDB."""
    chunks = chunk_text(text)
    stored = []
    for chunk in chunks:
        doc = {
            "text": chunk,
            "domain": tag_domain(chunk),
            "source": source,
            "decision_id": decision_id,
        }
        add_chunk(layer, doc)
        await persist_chunk(layer, doc)
        stored.append(doc)
    return stored


def _keyword_score(chunk: dict, query_words: set[str]) -> float:
    chunk_words = set(chunk["text"].lower().split())
    return len(query_words & chunk_words) / max(len(query_words), 1)


def _keyword_search(layer: str, query: str, top_k: int, domain: str | None) -> list[dict]:
    query_words = set(query.lower().split())
    candidates = get_layer(layer)
    if domain:
        candidates = [c for c in candidates if c.get("domain") == domain]
    ranked = sorted(candidates, key=lambda c: _keyword_score(c, query_words), reverse=True)
    return ranked[:top_k]


def get_agent_context(
    query: str,
    top_k: int = 5,
    domain: str | None = None,
) -> str:
    """
    Retrieve from both layers, merge, dedupe by text prefix, return formatted string.
    Primary: keyword overlap. Upgrade path: swap _keyword_search for Atlas Vector Search.
    """
    decision_hits = _keyword_search("decision", query, top_k, domain)
    internal_hits = _keyword_search("internal", query, top_k, domain)

    seen: set[str] = set()
    merged: list[dict] = []
    for chunk in decision_hits + internal_hits:
        key = chunk["text"][:80]
        if key not in seen:
            seen.add(key)
            merged.append(chunk)

    if not merged:
        return ""

    lines = []
    for i, c in enumerate(merged, 1):
        tag = f"[{i}] ({c['source']} · {c['domain']})"
        lines.append(f"{tag}\n{c['text']}")
    return "\n\n".join(lines)
