"""
Firecrawl grounding service — fireplexity pattern.
Single /v2/search call with sources=['web','news'] returns full markdown per result.
Content is keyword-filtered to 2000 chars before being injected into agent prompts.
Results cached in MongoDB by query hash.
"""
from __future__ import annotations

import hashlib
import httpx

from config import settings
from db.client import get_db

_FIRECRAWL_V2_URL = "https://api.firecrawl.dev/v2/search"
_CACHE_COLLECTION = "firecrawl_cache"
_STOPWORDS = {"what", "when", "where", "which", "how", "why", "does", "with",
              "from", "about", "that", "this", "have", "will", "been"}


def _cache_key(query: str) -> str:
    return hashlib.sha256(query.lower().strip().encode()).hexdigest()[:32]


async def _get_cached(query: str) -> str | None:
    doc = await get_db()[_CACHE_COLLECTION].find_one({"key": _cache_key(query)})
    return doc["result"] if doc else None


async def _set_cache(query: str, result: str) -> None:
    key = _cache_key(query)
    await get_db()[_CACHE_COLLECTION].replace_one(
        {"key": key},
        {"key": key, "query": query, "result": result},
        upsert=True,
    )


def _select_relevant_content(content: str, query: str, max_length: int = 2000) -> str:
    """
    Fireplexity-style keyword scorer:
    - Always keep intro (first 2 paragraphs) and conclusion (last paragraph)
    - Score middle paragraphs by keyword overlap, take top 3
    - Cap at max_length
    """
    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    if not paragraphs:
        return content[:max_length]

    keywords = {
        w for w in query.lower().split()
        if len(w) > 3 and w not in _STOPWORDS
    }

    intro = "\n\n".join(paragraphs[:2])
    conclusion = paragraphs[-1] if len(paragraphs) > 2 else ""
    middle = paragraphs[2:-1] if len(paragraphs) > 3 else []

    scored = sorted(
        [{"text": p, "score": sum(1 for kw in keywords if kw in p.lower()), "idx": i}
         for i, p in enumerate(middle)],
        key=lambda x: -x["score"],
    )
    top_middle = [s["text"] for s in sorted(scored[:3], key=lambda x: x["idx"])]

    parts = [intro] + top_middle + ([conclusion] if conclusion else [])
    result = "\n\n".join(parts)
    return result[:max_length - 3] + "..." if len(result) > max_length else result


async def _v2_search(query: str, num_results: int = 5) -> str:
    """
    Call Firecrawl /v2/search with web+news sources.
    Returns a formatted citation string ready for LLM injection.
    """
    cached = await _get_cached(query)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _FIRECRAWL_V2_URL,
                headers={
                    "Authorization": f"Bearer {settings.firecrawl_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "query": query,
                    "sources": ["web", "news"],
                    "limit": num_results,
                    "scrapeOptions": {
                        "formats": ["markdown"],
                        "onlyMainContent": True,
                        "maxAge": 86400000,  # 24h cache on Firecrawl side too
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return f"[Firecrawl unavailable: {exc}]"

    search_data = data.get("data", {})
    web_results = search_data.get("web", [])
    news_results = search_data.get("news", [])

    lines = []
    idx = 1

    for item in web_results:
        url = item.get("url", "")
        title = item.get("title") or url
        markdown = item.get("markdown") or item.get("content") or item.get("description") or ""
        relevant = _select_relevant_content(markdown, query) if markdown else ""
        if url:
            lines.append(f"[{idx}] {title}\n{url}\n{relevant}")
            idx += 1

    for item in news_results:
        url = item.get("url", "")
        title = item.get("title") or url
        snippet = item.get("snippet") or item.get("description") or ""
        date = item.get("date", "")
        if url:
            date_str = f" ({date})" if date else ""
            lines.append(f"[{idx}] {title}{date_str}\n{url}\n{snippet[:600]}")
            idx += 1

    if not lines:
        return "[No search results found]"

    result = "\n\n---\n\n".join(lines)
    await _set_cache(query, result)
    return result


async def get_market_grounding(decision_context: str) -> str:
    from datetime import datetime
    year = datetime.now().year
    ctx = decision_context[:300].replace("\n", " ")
    query = f"India market size trends competitors {year} {ctx[:100]}"
    return await _v2_search(query)


async def get_competitor_grounding(decision_context: str) -> str:
    from datetime import datetime
    year = datetime.now().year
    ctx = decision_context[:300].replace("\n", " ")
    query = f"India startup competitive landscape funding rivals {year} {ctx[:100]}"
    return await _v2_search(query)
