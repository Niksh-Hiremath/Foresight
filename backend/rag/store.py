"""
Hybrid RAG store: in-memory dict (fast) + MongoDB persistence (survives restarts).
Two layers: 'decision' (uploaded docs) and 'internal' (connector/company docs).
"""
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

# In-memory mirror — populated on ingest and on load_from_db()
_store: dict[str, list[dict]] = {"decision": [], "internal": []}


def _collection():
    from db.client import get_db
    return get_db()["rag_chunks"]


def add_chunk(layer: str, chunk: dict) -> None:
    """Add a chunk to the in-memory store (synchronous)."""
    _store.setdefault(layer, []).append(chunk)


async def persist_chunk(layer: str, chunk: dict) -> None:
    """Persist a chunk to MongoDB (async). Call after add_chunk."""
    await _collection().insert_one({"layer": layer, **chunk})


async def load_from_db() -> None:
    """Reload all persisted chunks into memory (call at startup)."""
    _store["decision"].clear()
    _store["internal"].clear()
    async for doc in _collection().find({}, {"_id": 0}):
        layer = doc.pop("layer", "decision")
        _store.setdefault(layer, []).append(doc)


def get_layer(layer: str) -> list[dict]:
    return _store.get(layer, [])


def clear_layer(layer: str) -> None:
    _store[layer] = []
