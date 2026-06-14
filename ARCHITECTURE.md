# Architecture — Foresight

> Stack (as built): **LLM via OpenAI SDK** (provider/model from `.env`; active model:
> `meta/llama-3.3-70b-instruct`) · **two-layer RAG** (keyword fallback, no Atlas Vector index
> wired) · **Firecrawl** for web grounding · **MongoDB Atlas (free M0)** for persistence ·
> **MiroFish sidecar** (Flask :5001 / Vue :3000) for swarm simulation · **D3.js 7** for
> force-directed graphs in the browser.

## Component map

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend — React 19 + Vite (:5173)                                 │
│                                                                      │
│  LandingPage · AgentsPage (analysis dashboard) · KnowledgebasePage  │
│  PluginsPage (connector mocks) · HistoryPage                         │
│                                                                      │
│  AgentsPage layout:                                                   │
│  ┌───────────────────────────┐  ┌────────────────────────────────┐   │
│  │  Left column (flex-1)     │  │  Right panel (w-72 sticky)     │   │
│  │  • Intake summary          │  │  • Agent status cards          │   │
│  │  • 5 agent finding cards   │  │  • Live event timeline         │   │
│  │  • Risk gauge + verdict    │  │  • D3 findings graph           │   │
│  │  • Scenario bands          │  │  • RAG knowledge graph (D3)    │   │
│  │  • GTM strategy            │  └────────────────────────────────┘   │
│  │  • Remediation roadmap SVG │                                        │
│  │  • 3 downloadable reports  │                                        │
│  └───────────────────────────┘                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ SSE + REST (CORS: localhost:5173)
┌──────────────────────────────▼──────────────────────────────────────┐
│  Orchestrator — FastAPI 0.115 (:8000)                                │
│                                                                      │
│  Routers:                                                             │
│  /health  /intake  /analyze (SSE)  /agents  /simulate               │
│  /synthesize  /reports  /knowledge  /rag/graph                       │
│                                                                      │
│  ┌──────────────────┐  ┌───────────────────────────────────────┐    │
│  │  RAG module       │  │  5 Adversarial Agents (asyncio)       │    │
│  │  • chunk_and_tag  │  │  CFO · Market · Competitor            │    │
│  │  • 512w / 64 overlap│  │  Legal · Execution                  │    │
│  │  • domain tagging │  │  Each: RAG grounding + LLM call       │    │
│  │  • keyword search │  │  Market/Comp: + Firecrawl search      │    │
│  │  • 2 layers:      │  │  All emit: VULN/SEVERITY/ATTACK/Q     │    │
│  │    decision        │  └───────────────────────────────────────┘   │
│  │    internal        │                                               │
│  └──────────────────┘  ┌───────────────────────────────────────┐    │
│                          │  Synthesis service                    │    │
│                          │  • fuse findings + sim → JSON report  │    │
│                          │  • deterministic fallback on bad JSON  │    │
│                          │  • verdict + 3 Qs + India GTM         │    │
│                          └───────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
          ┌────────────────────┼──────────────────────┐
          │                    │                       │
    ┌─────▼─────┐    ┌─────────▼──────┐    ┌──────────▼──────┐
    │  MongoDB   │    │   LLM API      │    │   MiroFish       │
    │  Atlas M0  │    │  OpenAI SDK    │    │  (:5001 Flask    │
    │            │    │  env-config    │    │   :3000 Vue)     │
    │  decisions │    │  llama-3.3-70b │    │  OASIS engine    │
    │  intake_ctx│    │  (active)      │    │  Zep Cloud       │
    │  agent_find│    └────────────────┘    │  (agent memory)  │
    │  simulations│                          └──────────────────┘
    │  verdicts  │    ┌─────────────────┐
    │  knowledge │    │  Firecrawl API  │
    │  rag_chunks│    │  /search+scrape │
    └────────────┘    └─────────────────┘
```

## Three external boundaries

1. **LLM via OpenAI SDK** — all reasoning (intake, 5 agents, synthesis, MiroFish's internal
   agents) goes through one OpenAI-SDK-compatible endpoint. `LLM_API_KEY`, `LLM_BASE_URL`,
   `LLM_MODEL` loaded from `.env` — never hardcoded. Active model: `meta/llama-3.3-70b-instruct`
   via OpenRouter. Swap the three env values to use Gemini, GPT-4o, a local Ollama — zero code
   changes. **Note:** `response_format` (structured output) is NOT used; findings are extracted
   with a regex parser to avoid model compatibility issues.

2. **Firecrawl** — web grounding for Market + Competitor agents. Calls `/search` (web search +
   scrape). Results cached in MongoDB keyed by query to avoid re-scraping on repeated runs.
   Needs `FIRECRAWL_API_KEY`.

3. **MongoDB Atlas (free M0)** — one database, seven collections:

   | Collection | Contents |
   |---|---|
   | `decisions` | Uploaded document text (extracted, not the file binary) |
   | `intake_context` | DecisionContext + adaptive Q&A answers |
   | `agent_findings` | Per-agent findings (VULN/SEVERITY/ATTACK/QUESTION) |
   | `simulations` | MiroFish report (bull/base/bear, opinion dynamics, swarm report) |
   | `verdicts` | Synthesis output (risk score, verdict, 3 Qs, GTM, exec summary) |
   | `knowledge_docs` | Internal knowledge base docs (extracted text only) |
   | `rag_chunks` | RAG chunk store (text, domain, source, layer, decision_id) |

## Pipeline data flow

1. **Upload** → `POST /intake/upload` → pdfplumber/python-docx parses file → text stored in
   `decisions` → chunked (512 words, 64-word overlap) + domain-tagged into RAG `decision` layer.
2. **Intake** → `POST /intake/analyze` → LLM extracts `DecisionContext` (core decision, market,
   beliefs, financial posture, gaps) + generates 3–5 adaptive follow-up questions →
   `POST /intake/answers` saves user answers → `intake_context` stored.
3. **One-click analysis** → `POST /analyze` (SSE stream):
   - Loads `DecisionContext` from `intake_context`
   - asyncio fan-out: 5 agents run concurrently, each streaming `agent_start` → `agent_complete`
   - Each agent: `get_agent_context(query)` retrieves from `decision`+`internal` RAG layers;
     Market+Competitor also call Firecrawl; LLM produces VULN/SEVERITY/ATTACK/QUESTION blocks
   - Severity scoring: `CRITICAL×30 / HIGH×15 / MEDIUM×5` + convergence bonuses, capped at 100
   - MiroFish bridge: seed composed from DecisionContext + top findings → 7-step async pipeline
     → `sim_started` event → live MiroFish view opens in new tab
   - Synthesis: fuses findings + simulation → verdict + GTM + remediation roadmap → `complete` event
4. **Dashboard** → SSE drives two-column layout live:
   - Left: 5 agent cards → risk gauge → scenario bands → GTM → remediation roadmap SVG → verdict
   - Right (sticky): agent status cards → event feed → D3 findings graph → RAG knowledge graph

## RAG — two-layer keyword system

```
Layer "decision"  — uploaded doc chunks (chunked on upload)
Layer "internal"  — knowledge base docs (chunked on /knowledge/upload)

Chunking: fixed sliding window, 512 words, 64-word overlap
Domain tagging:  financial / market / legal / competitor / execution / general
                 by keyword scoring (top-scoring domain wins)

Retrieval (get_agent_context):
  1. Query both layers
  2. Score chunks by keyword overlap with query
  3. Merge + deduplicate by text hash
  4. Return top-k as formatted context block
```

Atlas Vector Search is wired in the schema but the keyword fallback is the active path.
No Atlas Search index created for the M0 cluster — keyword fallback works reliably for demo.

## MiroFish integration (as shipped)

MiroFish runs as a **local sidecar** on `:5001` (Flask API) and `:3000` (Vue UI).
The Foresight backend drives it via a `requests`-based bridge:

```
/graph/ontology/generate  →  /graph/build  →  /simulation/create
→ /simulation/prepare  →  /simulation/start  →  /report/generate
→ /report/by-simulation
```

Each step is polled until `status == "completed"`. Simulation is capped at `max_rounds=8`.
The bridge emits `sim_progress` SSE events (phase name + percent) while MiroFish runs.

**On `sim_started` SSE event:** the frontend opens the MiroFish Vue UI in a new tab,
navigating directly to the live simulation run view. This sidesteps iframe CORS/CSP issues.

**Zep Cloud rate limit:** MiroFish's `ReportAgent` uses Zep Cloud for episode memory. The free
tier's episode limit can cause 403 errors during the knowledge-graph-build step (`图谱构建失败`).
The bridge catches these and returns a stub report so the Foresight pipeline never blocks.

## Live agent side panel — D3 components

The right panel in `AgentsPage` contains two D3.js 7 force-directed graphs:

**FindingsGraph** (`W=256, H=220`)
- Agent nodes (r=9, red `#ef4444`) linked to finding nodes (r=5, severity-colored)
- Forces: link (distance 50) + charge (−60) + center + collide
- Zoom/pan + node drag; agent labels; finding tooltips on hover
- Rebuilds on `agents` state change; cleanup: `sim.stop()` on unmount

**KnowledgeGraph** (`W=256, H=200`)
- Domain nodes (r=11, domain-colored) + source-doc nodes (r=7, `#e5e2e1`)
- Link width proportional to chunk-count weight
- Data from `GET /rag/graph/{decision_id}` on component mount
- Returns null if endpoint returns empty graph (no chunks for this decision)

Domain color map: financial=#60a5fa · market=#34d399 · legal=#f472b6 ·
competitor=#f97316 · execution=#a78bfa · general=#9ca3af

## Ports & process layout

| Process | Port | Notes |
|---|---|---|
| Frontend (Vite) | 5173 | |
| Backend (FastAPI) | 8000 | CORS open to :5173 |
| MiroFish frontend (Vue) | 3000 | |
| MiroFish backend (Flask) | 5001 | |

## Environment variables

```env
# Your orchestrator
LLM_API_KEY=...
LLM_BASE_URL=https://openrouter.ai/api/v1   # or Gemini / OpenAI / local
LLM_MODEL=meta/llama-3.3-70b-instruct       # or gemini-2-flash, gpt-4o, etc.
FIRECRAWL_API_KEY=...
MONGODB_URI=mongodb+srv://...

# MiroFish sidecar (mirofish/.env)
LLM_API_KEY=...       # same key
LLM_BASE_URL=...      # same base URL
LLM_MODEL_NAME=...    # same model
ZEP_API_KEY=...       # app.getzep.com
```

All LLM access goes through the OpenAI SDK. Provider and model are env-swappable with zero
code changes — the client is built once in `services/llm_client.py` and reused everywhere.

## SSE event stream from POST /analyze

```
agent_start      { agent: "cfo" }
agent_complete   { agent: "cfo", findings: [...], progress: 20 }
...              (× 5 agents, interleaved)
scoring          { risk_score: 72, verdict: "PROCEED_WITH_CAUTION", progress: 90 }
simulating       { progress: 93 }
sim_progress     { phase: "Opinion formation", pct: 45 }
sim_started      { simulation_id: "...", progress: 95 }   ← frontend opens MiroFish tab
gtm_start        { progress: 94 }
synthesizing     { progress: 97 }
complete         { progress: 100, score: {...}, report: {...} }
```
