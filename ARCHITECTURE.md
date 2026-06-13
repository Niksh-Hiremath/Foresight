# Architecture — RedTeam

> Stack (locked): **Gemini API (GCP)** for all reasoning · **Firecrawl** for web grounding ·
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
        A[Agent service: 5 adversarial agents]
        B[Simulation bridge]
        S[Synthesis service: verdict + GTM]
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
    I -. OpenAI SDK .-> G
    A -. OpenAI SDK .-> G
    A -. web grounding .-> F
    S -. OpenAI SDK .-> G
    I & A & B & S <--> M
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
   `agent_findings`, `simulations`, `verdicts`. Stores the full audit trail per run.

## Pipeline data flow

1. **Upload** → orchestrator parses PDF/DOCX → text.
2. **Intake (Gemini)** → extract the core decision + stated company beliefs → generate 3–5
   adaptive follow-up questions (MCQ/text) → user answers → persist a `DecisionContext` object.
   *This object is the shared seed for everything downstream.*
3. **Adversarial agents (Gemini, parallel)** → CFO / Market / Competitor / Legal / Execution.
   Market + Competitor agents call Firecrawl for live evidence. Each returns scored findings.
4. **Simulation bridge** → compose a MiroFish *seed* (the decision + market context + key
   findings) → trigger MiroFish → retrieve its prediction report (bull/base/bear + opinion dynamics).
5. **Synthesis (Gemini)** → fuse findings + simulation → verdict (Proceed/Caution/Do Not Proceed)
   + the 3 questions + an India-specific GTM strategy.
6. **Dashboard** renders all four stages; the MiroFish digital world is embedded/linked.

## MiroFish integration — three options (pick by risk appetite)

| Option | How | Risk | Recommendation |
|---|---|---|---|
| **A. API call** | Orchestrator POSTs seed to MiroFish backend (:5001), polls for report JSON, ingests into dashboard | Medium — API surface is undocumented; inspect `backend/` for the route | Do this *if* you find a clean endpoint early |
| **B. Sidecar + embed** | Run MiroFish standalone; pre-run the demo scenario; embed/iframe its world UI + paste its report into your dashboard | Low | **Default for a 2-person team** |
| **C. Output-only** | Pre-run once, export report, render in your own UI; never call MiroFish live | Lowest | Fallback if A and B both slip |

Start on B, attempt A only if the backend exposes an obvious trigger/report route.

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

