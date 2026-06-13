# Architecture — Foresight

> Stack (locked): **LLM via OpenAI SDK** (provider/model from `.env`; default Gemini) for all
> reasoning · **two-layer RAG** for document grounding · **Firecrawl** for web grounding ·
> **MongoDB Atlas (free)** for persistence · **MiroFish (local)** for future simulation.

## Component map

```mermaid
flowchart TD
    subgraph Client["Frontend — React + Vite (:5173)"]
        L[Landing / Auth - mock]
        C[Connectors - mock Salesforce/RSS]
        U[Upload + Adaptive Q&A]
        D[Dashboard: findings · verdict · outcome bands · GTM]
        W[MiroFish world embed]
    end

    subgraph Orchestrator["Orchestrator backend — FastAPI / Python (:8000)"]
        I[Intake service: parse doc + extract decision + gen follow-ups]
        R[RAG: two-layer chunk+tag, Atlas Vector / keyword fallback]
        A[Agent service: 5 adversarial agents, parallel asyncio]
        B[Simulation bridge]
        S[Synthesis: severity score + verdict + GTM + remediation]
    end

    subgraph External["External services"]
        G[(LLM API - OpenAI SDK, env-configured)]
        F[(Firecrawl - search/scrape)]
        M[(MongoDB Atlas)]
    end

    subgraph Sim["MiroFish — local sidecar (Vue :3000 / API :5001)"]
        MF[OASIS swarm engine]
        Z[(Zep Cloud - agent memory)]
    end

    U --> I --> A --> B --> S --> D
    I --> R
    A -. retrieve context .-> R
    A == SSE stream ==> D
    I -. OpenAI SDK .-> G
    A -. OpenAI SDK .-> G
    A -. web grounding .-> F
    S -. OpenAI SDK .-> G
    I & A & B & S & R <--> M
    B -- seed in / report out --> MF
    MF -. OpenAI SDK same .env .-> G
    MF <--> Z
    W -. iframe/link .-> MF
```

## The three external boundaries

1. **LLM via OpenAI SDK (provider set in `.env`)** — everything (your agents *and* MiroFish)
   talks to one OpenAI-SDK-compatible endpoint. `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` are
   always read from `.env`, never hardcoded. Default provider is Gemini via its OpenAI-compatible
   endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`) — this keeps the Gemini
   partner-prize eligibility. Swap the three env values to use any other provider (OpenAI, Qwen,
   OpenRouter, a local model) with zero code changes.
2. **Firecrawl** — grounding for the Market + Competitor agents. Use `/search` (web search +
   scrape in one) and `/scrape` for specific competitor pages. Needs `FIRECRAWL_API_KEY`
   (free tier ~limited credits — cache aggressively, don't re-scrape during the demo).
3. **MongoDB Atlas (free M0)** — one database, collections: `decisions`, `intake_context`,
   `rag_chunks` (+ optional Vector Search index), `agent_findings` (VULNERABILITY/SEVERITY/ATTACK/
   QUESTION), `simulations`, `verdicts`. Stores the full audit trail per run.

## Pipeline data flow

1. **Upload** → orchestrator parses PDF/DOCX → text → **chunks + domain-tags into the RAG
   `decision` layer**; connector/company docs go into the `internal` layer.
2. **Intake (LLM)** → extract the core decision + stated beliefs → generate 3–5 adaptive
   follow-up questions (MCQ/text) → user answers → persist a `DecisionContext`. *This object is
   the shared seed for everything downstream.*
3. **Adversarial agents (LLM, parallel via asyncio)** → CFO / Market / Competitor / Legal /
   Execution. Each agent grounds itself by retrieving from **both RAG layers**
   (`get_agent_context`) so it quotes the actual document; Market + Competitor additionally call
   **Firecrawl** for live external evidence. Each emits structured findings in `VULNERABILITY /
   SEVERITY / ATTACK / QUESTION` form, **streamed to the UI over SSE** as each agent finishes.
4. **Severity scoring** → deterministic 0–100 Risk Score (weights + cross-agent convergence
   bonuses) → verdict band.
5. **Simulation bridge** → compose a MiroFish *seed* (decision + market context + key findings) →
   trigger MiroFish → retrieve its prediction report (bull/base/bear + opinion dynamics).
6. **Synthesis (LLM)** → fuse findings + simulation into a JSON report (verdict, the 3 questions,
   India-specific GTM, **remediation roadmap**). Has a deterministic fallback that rebuilds the
   report from the severity score if JSON parsing fails.
7. **Dashboard** → live agent panel (SSE: waiting→thinking→complete), findings with severity
   badges, the remediation roadmap, MiroFish outcome bands, and the verdict banner.

## Reference patterns adopted from the Red Team repo

Lifted from `galatro/hackaton-ai-week-2026` and adapted to this stack — full drop-in code in
`INSPIRATIONS.md`. The reference team defined a Google ADK agent graph but **never ran it** at
runtime; they hand-rolled an asyncio fan-out. We do the same — **no orchestration framework**.

- **Two-layer RAG with keyword fallback.** `decision` layer (uploaded doc) + `internal` layer
  (connector/company docs). Chunk (~512 tokens, 64 overlap), domain-tag, retrieve from both, merge
  + dedupe. Primary store: **MongoDB Atlas Vector Search**; fallback: in-memory keyword-overlap
  search (enough for the demo, zero infra). RAG is foundational — build it before the agents.
- **Structured findings + regex parse.** Agents emit `VULNERABILITY/SEVERITY/ATTACK/QUESTION`
  blocks; a regex extracts them (or use OpenAI structured output, with regex as the fallback).
- **Deterministic severity scoring.** `CRITICAL 30 / HIGH 15 / MEDIUM 5`, `+10` if ≥2 agents flag
  CRITICAL, `+5` if ≥3 flag HIGH, capped at 100. Verdict: ≥80 DO NOT PROCEED · 50–79 CAUTION ·
  <50 PROCEED.
- **SSE streaming on both ends.** Backend `StreamingResponse(media_type="text/event-stream")`
  emits `ingesting → agent_start → agent_complete(progress) → synthesizing → complete`. Frontend
  uses **fetch + ReadableStream** (not `EventSource`, which can't POST FormData).
- **Remediation Roadmap.** Each top finding maps to a recommended action per agent, rolling up
  into the GTM plan — the bridge from "what's broken" to "what to do."
- **Deterministic fallbacks everywhere.** RAG → keyword search; demo → hardcoded context string;
  synthesis → computed report. The demo never breaks on stage.

## MiroFish integration — now mapped (see `MIROFISH_INTEGRATION.md`)

MiroFish is a **Flask REST API on `:5001`** (blueprints `/api/graph`, `/api/simulation`,
`/api/report`, CORS open). Its LLM layer is the **OpenAI SDK** driven by `LLM_API_KEY/BASE_URL/
MODEL_NAME` — point it at the same Gemini env. **There is no one-shot endpoint:** one prediction is
a **7-step async pipeline** (ontology/seed → build graph → create sim → prepare → start → generate
report → fetch), each step polled. Required keys: `LLM_API_KEY` + `ZEP_API_KEY`.

| Mode | How | Risk | Recommendation |
|---|---|---|---|
| **B. Sidecar + bridge + embed** | Run MiroFish as-is; a thin `requests` bridge drives the 7 steps; show results by iframing its `:3000` world or rendering the fetched report JSON | Low | **Default for a 2-person team** |
| **A. Full programmatic** | Same bridge, render everything in your own dashboard; don't run their Vue | Medium | Only with spare time for polish |
| **C. Output-only** | Pre-run once (UI or `scripts/run_parallel_simulation.py`), cache report JSON, never call live | Lowest | Fallback if the live run is flaky |

Build Mode B's bridge but **pre-run the demo scenario and cache the report JSON** — the live demo
reads the cache, with a recording as the ultimate fallback. Full endpoint sequence, bridge skeleton,
and cost caps are in `MIROFISH_INTEGRATION.md`.

## Ports & process layout (avoid collisions)

| Process | Port | Notes |
|---|---|---|
| Your frontend (Vite) | 5173 | Don't use 3000 — MiroFish owns it |
| Your orchestrator (FastAPI) | 8000 | Don't use 5001 — MiroFish owns it |
| MiroFish frontend (Vue) | 3000 | Its default |
| MiroFish backend (Python) | 5001 | Its default |

## Consolidated environment variables

All LLM access goes through the OpenAI SDK; the three `LLM_*` values are **always** loaded from
`.env` — provider and model are never hardcoded anywhere in the codebase.

```env
# Your orchestrator — LLM via OpenAI SDK, fully env-driven
LLM_API_KEY=...
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/   # default: Gemini; swap freely
LLM_MODEL=gemini-3-flash             # any model the configured provider exposes
FIRECRAWL_API_KEY=...
MONGODB_URI=mongodb+srv://...         # Atlas M0 free

# MiroFish (.env in its own repo) — same provider, its own var names
LLM_API_KEY=${LLM_API_KEY}
LLM_BASE_URL=${LLM_BASE_URL}
LLM_MODEL_NAME=${LLM_MODEL}
ZEP_API_KEY=...                       # app.getzep.com free tier
```

## MiroFish hard facts (from repo, v0.1.2)

- Prereqs: **Node 18+**, **Python 3.11–3.12** (strict), **uv**.
- Required keys: LLM (OpenAI-SDK-compatible → use Gemini) + **Zep Cloud**.
- Engine: **OASIS** (camel-ai/oasis). API-bound — no local GPU; cost/time scale with agents × rounds.
- Repo warns: high token consumption, start with **<40 rounds**.
- License: **AGPL-3.0**.
- Self-contained app: Vue (:3000) + Python (:5001), `npm run dev` or Docker.

## Day-one validation checklist (do these before building features)

- [ ] The `.env`-configured LLM (OpenAI SDK) works with **tool calling** (MiroFish ReportAgent needs it).
- [ ] MiroFish runs end-to-end on one machine with a tiny scenario (few agents, ~10 rounds).
- [ ] Measure one small simulation's runtime + token cost → set demo agent/round caps from that.
- [ ] Firecrawl `/search` returns usable grounding for an Indian-market query.
- [ ] Atlas M0 reachable from the orchestrator.
```

