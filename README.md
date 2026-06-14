# Foresight — AI Red-Team Engine for Strategic Decisions

> **HackPrix Season 3 · GenAI & ML Track · June 13–14, 2026 · Hyderabad**

Foresight stress-tests strategic decisions from the inside. Upload a business plan, pitch deck, or market-entry memo — five adversarial AI agents attack it from distinct angles using your own document as evidence, a swarm simulation plays the decision forward, and the system returns a deterministic verdict with an India-specific go-to-market strategy.

---

## What it does

| Stage | What happens |
|---|---|
| **Upload + Intake** | Parse PDF/DOCX → LLM extracts core decision, beliefs, gaps → 3–5 adaptive follow-up Q&A |
| **5 Adversarial Agents** | CFO, Market, Competitor, Legal, Execution run in parallel — each attacks from a distinct angle, grounded in your document + live web data |
| **Swarm Simulation** | MiroFish feeds thousands of personality-driven agents a seed scenario → bull/base/bear outcome bands; Chinese output auto-translated to English |
| **Verdict + GTM** | Risk Score (0–100), DO NOT PROCEED / CAUTION / PROCEED, 3 questions the team must answer, India-specific go-to-market strategy |
| **Remediation Roadmap** | Each top finding maps to a concrete remediation action per agent |

---

## Features built

- **Adaptive intake** — not just upload; grills you on gaps before critique begins
- **5-agent parallel red team** — CFO (financial), Market (demand), Competitor (incumbents), Legal (governance), Execution (capability) — all streaming live over SSE
- **Deterministic scoring** — `CRITICAL×30 / HIGH×15 / MEDIUM×5` + cross-agent convergence bonuses, capped at 100. No vibes.
- **Live web grounding** — Market + Competitor agents call Firecrawl for current evidence; results are cited
- **Two-layer RAG** — `decision` layer (your doc) + `internal` layer (company knowledge base); keyword fallback if Atlas Vector Search is unavailable
- **MiroFish swarm bridge** — 7-step async pipeline; reuses existing built graph to avoid Zep Cloud episode quota exhaustion (Steps 1–2 skipped on repeat runs); auto-translates Chinese output before saving to DB
- **Knowledge Base** — upload internal docs (strategy memos, Salesforce exports); extracted text stored in MongoDB and fed to the `internal` RAG layer
- **Live agent panel** — right-side panel with per-agent status cards, severity badges, live event timeline, and D3 findings graph
- **Persistent activity log** — event feed saved to localStorage per decision; visible when revisiting any past analysis from History
- **Full dashboard** — intake summary → agent findings → risk gauge → scenarios → GTM → remediation roadmap → verdict banner pinned to top
- **Deterministic fallbacks everywhere** — RAG → keyword search; MiroFish down → cached stub; JSON parse fail → score-computed report. The demo never breaks.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend — React 19 + Vite (:5173)                         │
│  Landing · Agents Dashboard · Knowledge Base · Plugins ·    │
│  History · Live agent panel (D3 findings graph + event feed) │
└──────────────────────┬──────────────────────────────────────┘
                       │ SSE + REST
┌──────────────────────▼──────────────────────────────────────┐
│  Orchestrator — FastAPI (:8000)                              │
│  /intake  /agents  /analyze (SSE)  /simulate                │
│  /synthesize  /reports  /knowledge  /rag/graph              │
│                                                              │
│  ┌─────────┐  ┌──────────────────────────────┐              │
│  │ RAG     │  │ 5 Adversarial Agents          │              │
│  │ 2-layer │  │ CFO · Market · Competitor     │              │
│  │ keyword │  │ Legal · Execution (asyncio)   │              │
│  └────┬────┘  └──────────────┬───────────────┘              │
│       │                      │ Firecrawl (Market, Comp.)    │
└───────┼──────────────────────┼──────────────────────────────┘
        │                      │
   ┌────▼────┐          ┌──────▼──────┐     ┌────────────────┐
   │ MongoDB │          │  LLM API    │     │  MiroFish      │
   │  Atlas  │          │ OpenAI SDK  │     │  (:5001 Flask) │
   │  (M0)   │          │ env-config. │     │  (:3000 Vue)   │
   └─────────┘          └─────────────┘     └────────────────┘
```

**Ports:**

| Service | Port |
|---|---|
| Frontend (Vite) | 5173 |
| Backend (FastAPI) | 8000 |
| MiroFish API (Flask) | 5001 |
| MiroFish UI (Vue) | 3000 |

---

## Quick start

### Prerequisites

- Python 3.11+
- Node 18+
- MongoDB Atlas account (free M0)
- API keys: LLM provider + Firecrawl

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env          # fill in your keys
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 3. MiroFish (optional — needed for swarm simulation)

```bash
cd mirofish
# Ensure its .env has same LLM_API_KEY/BASE_URL/MODEL_NAME + ZEP_API_KEY
npm run setup:all
npm run dev
```

MiroFish runs at `:5001` (API) and `:3000` (UI). The Foresight backend bridges to it automatically. On repeat runs the bridge reuses the existing knowledge graph — no new Zep episodes are consumed.

---

## Environment variables

```env
# LLM — any OpenAI-SDK-compatible provider
LLM_API_KEY=your-key
LLM_BASE_URL=https://integrate.api.nvidia.com/v1   # or Gemini, OpenRouter, Ollama, etc.
LLM_MODEL_NAME=meta/llama-3.3-70b-instruct         # or gemini-2-flash, gpt-4o, etc.

# Web grounding
FIRECRAWL_API_KEY=your-firecrawl-key

# Persistence
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/

# MiroFish sidecar (in mirofish/.env)
LLM_API_KEY=same-as-above
LLM_BASE_URL=same-as-above
LLM_MODEL_NAME=same-as-above
ZEP_API_KEY=your-zep-cloud-key
```

Provider is fully env-swappable. Switch `LLM_BASE_URL` + `LLM_MODEL_NAME` to use OpenAI, OpenRouter, a local Ollama instance, etc. — zero code changes.

---

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/intake/upload` | Upload PDF/DOCX → extract text → chunk into RAG |
| POST | `/intake/analyze` | LLM extracts DecisionContext + generates follow-up Q&A |
| POST | `/intake/answers` | Save user's answers |
| GET | `/intake/context/{id}` | Retrieve stored DecisionContext |
| POST | `/analyze` | **One-click full pipeline over SSE** (agents → score → sim → translate → GTM → synthesis) |
| GET | `/agents/findings/{id}` | All agent findings for a decision |
| GET | `/agents/score/{id}` | Computed risk score |
| POST | `/simulate/run` | Run MiroFish bridge (or return cached) |
| GET | `/simulate/result/{id}` | Bull/base/bear + opinion dynamics |
| POST | `/synthesize` | Fuse findings + simulation → verdict |
| GET | `/synthesize/{id}` | Retrieve verdict |
| GET | `/reports/{id}` | Agents, swarm, and GTM markdown reports |
| POST | `/knowledge/upload` | Upload internal knowledge doc |
| GET | `/knowledge/` | List knowledge docs |
| GET | `/knowledge/{id}/content` | Retrieve extracted doc text |
| DELETE | `/knowledge/{id}` | Delete knowledge doc |
| GET | `/rag/graph/{id}` | RAG knowledge graph (domain clusters + source nodes) |

### SSE events from `POST /analyze`

```json
{ "event": "agent_start",    "agent": "cfo" }
{ "event": "agent_complete", "agent": "cfo", "findings": [...], "progress": 20 }
{ "event": "scoring",        "risk_score": 72, "verdict": "PROCEED_WITH_CAUTION", "progress": 90 }
{ "event": "simulating",     "progress": 93 }
{ "event": "sim_progress",   "phase": "Reusing existing knowledge graph", "pct": 30 }
{ "event": "sim_progress",   "phase": "Agent swarm — round 2/5", "pct": 71 }
{ "event": "sim_progress",   "phase": "Translating swarm report", "pct": 98 }
{ "event": "gtm_start",      "progress": 94 }
{ "event": "synthesizing",   "progress": 97 }
{ "event": "complete",       "progress": 100, "score": {...}, "report": {...} }
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + Vite 8 |
| Styling | Tailwind CSS 4 (CSS-first `@theme` config) |
| Routing | React Router DOM 7 |
| Visualization | D3.js 7 (force-directed findings graph) |
| Backend framework | FastAPI 0.115 (async, SSE streaming) |
| LLM access | OpenAI Python SDK 1.56 (env-configured provider) |
| Database | MongoDB Atlas M0 + Motor 3.7 (async driver) |
| Document parsing | pdfplumber 0.11 + python-docx 1.1 |
| Web grounding | Firecrawl API |
| Swarm simulation | MiroFish (OASIS engine, Flask :5001, Vue :3000) |
| Agent memory (MiroFish) | Zep Cloud |

---

## MongoDB collections

| Collection | Purpose |
|---|---|
| `decisions` | Raw uploaded documents (text extracted, not the file) |
| `intake_context` | Structured DecisionContext + user Q&A answers |
| `agent_findings` | Per-agent findings (vulnerability, severity, attack, question) |
| `simulations` | MiroFish results (bull/base/bear, opinion dynamics, swarm report — always English) |
| `verdicts` | Final synthesis (risk score, verdict, GTM, executive summary) |
| `knowledge_docs` | Internal knowledge base documents (extracted text only) |
| `rag_chunks` | RAG chunk store (text, domain, source, decision_id) |

---

## Project structure

```
HackPrixS3/
├── backend/
│   ├── main.py                  # FastAPI app + middleware
│   ├── config.py                # pydantic-settings env loader (LLM_MODEL_NAME alias)
│   ├── models/schemas.py        # Pydantic models for all collections
│   ├── db/                      # MongoDB client + repository functions
│   ├── rag/                     # Two-layer RAG (chunker, store, retrieval)
│   ├── routers/                 # intake, agents, analyze, simulate,
│   │                            # synthesize, reports, knowledge, rag_graph
│   └── services/                # LLM client, document parser, agents,
│                                # seed composer, synthesis, MiroFish bridge,
│                                # translation (auto-runs post-simulation)
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Routes
│   │   ├── pages/               # LandingPage, AgentsPage, KnowledgebasePage,
│   │   │                        # PluginsPage, HistoryPage
│   │   ├── components/Sidebar.jsx
│   │   └── index.css            # Tailwind @theme + custom CSS animations
│   └── vite.config.js
├── mirofish/                    # MiroFish subproject (OASIS swarm engine)
├── scripts/                     # Utility scripts (e.g. translate_simulation.py backfill)
├── spikes/                      # Validation scripts (LLM, Firecrawl, Mongo, MiroFish e2e)
├── ARCHITECTURE.md
├── ROADMAP.md
├── PLAN.md
├── AGENTS_USED.md
└── MIROFISH_INTEGRATION.md
```
