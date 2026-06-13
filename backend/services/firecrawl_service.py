"""
Firecrawl grounding service for Market + Competitor agents.
Queries are cached in MongoDB keyed by query string to avoid re-scraping.
"""
from __future__ import annotations

import hashlib
import httpx

from config import settings
from db.client import get_db

_FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v1/search"
_CACHE_COLLECTION = "firecrawl_cache"


def _cache_key(query: str) -> str:
    return hashlib.sha256(query.lower().strip().encode()).hexdigest()[:32]


async def _get_cached(query: str) -> str | None:
    key = _cache_key(query)
    doc = await get_db()[_CACHE_COLLECTION].find_one({"key": key})
    return doc["result"] if doc else None


async def _set_cache(query: str, result: str) -> None:
    key = _cache_key(query)
    await get_db()[_CACHE_COLLECTION].replace_one(
        {"key": key}, {"key": key, "query": query, "result": result}, upsert=True
    )


async def search_and_ground(query: str, num_results: int = 5) -> str:
    """
    Search via Firecrawl and return a formatted grounding string.
    Results are cached in MongoDB — cache hit avoids API call on rerun.
    """
    cached = await _get_cached(query)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _FIRECRAWL_SEARCH_URL,
                headers={"Authorization": f"Bearer {settings.firecrawl_api_key}"},
                json={"query": query, "limit": num_results, "scrapeOptions": {"formats": ["markdown"]}},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return f"[Firecrawl unavailable: {exc}]"

    results = data.get("data", [])
    if not results:
        return "[No search results found]"

    lines = []
    for i, r in enumerate(results, 1):
        title = r.get("title") or r.get("url", "")
        url = r.get("url", "")
        snippet = (r.get("markdown") or r.get("description") or "")[:600]
        lines.append(f"[{i}] {title}\n{url}\n{snippet}")

    formatted = "\n\n".join(lines)
    await _set_cache(query, formatted)
    return formatted


async def get_market_grounding(decision_context: str) -> str:
    """Build market-specific Firecrawl queries from decision context."""
    # Extract a short search phrase from the first 200 chars of context
    ctx_snippet = decision_context[:200].replace("\n", " ")
    query = f"India market size competitors 2024 {ctx_snippet[:80]}"
    return await search_and_ground(query)


async def get_competitor_grounding(decision_context: str) -> str:
    """Build competitor-specific Firecrawl queries from decision context."""
    ctx_snippet = decision_context[:200].replace("\n", " ")
    query = f"India startup competitors funding 2024 {ctx_snippet[:80]}"
    return await search_and_ground(query)
