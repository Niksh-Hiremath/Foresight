# Foresight — Build Roadmap (Claude Code)

> **Team model:** 1 builder drives Claude Code · 1 tester verifies each task.
> **Rule:** after every task, Claude Code STOPS. The tester runs the checkpoint and gives
> a thumbs up/down before the next task starts. Never batch two tasks past a gate.
> **Sequence logic:** de-risk first (Phase 0 spikes), then scaffold, then build the pipeline
> stage by stage, then mock the rest, then polish for the demo.

## How to use this doc

For each task: paste the **Prompt** into Claude Code, let it build, then the tester runs the
**STOP / verify** block. If it fails, fix before moving on. Keep `.env` populated as you go.

Stack recap: React+Vite frontend (:5173) · FastAPI orchestrator (:8000) · LLM via OpenAI SDK
(provider/model from `.env`; default Gemini) · two-layer RAG (Atlas Vector / keyword fallback) ·
Firecrawl · MongoDB Atlas (M0) · MiroFish sidecar (Vue :3000 / API :5001).

> **LLM rule for every task below:** all LLM calls use the OpenAI Python SDK, built from
> `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` read from `.env`. Never hardcode a provider,
> base URL, or model string anywhere. Build one shared client and reuse it.

> **Reference patterns:** several tasks below adopt code from the Red Team repo — see
> `INSPIRATIONS.md` for drop-in snippets (asyncio fan-out + SSE, regex finding parser, severity
> scoring, two-layer keyword RAG, deterministic fallbacks, remediation roadmap).

> **Critical path to a *working product*** (do these in order; everything else is enhancement):
> Phase 0 → T1.1–T1.4 (scaffold + RAG) → T2.1–T2.3 (intake) → T3.1–T3.5 (agents + score) →
> **T4.1 + a stubbed report** → T5.1–T5.3 (synthesis + one-click orchestration + dashboard).
> That alone is a one-click, end-to-end demo. Make MiroFish *live* (T4.2–T4.3) and the mock screens
> (Phase 6) only after that slice works — they are the safe things to cut if time runs short.

---

## Phase 0 — Validation spikes (do FIRST, before any features)

These exist to catch the project-killers in the first few hours, not at hour 30.

### T0.1 — OpenAI SDK hello world (env-driven) ✅
**Prompt:** "Create `spikes/llm_hello.py`. Load `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` from
`.env`. Use the OpenAI Python SDK configured with those three values (nothing hardcoded) to send
one chat completion and print the response. Add a `requirements.txt`."
**STOP / verify:** Tester runs it; a real completion prints. Confirms key + base_url + model + billing.

### T0.2 — Tool-calling on the env LLM (HIGHEST RISK) ✅
**Prompt:** "Create `spikes/llm_toolcall.py` using the OpenAI Python SDK configured from
`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` (.env only). Define one function tool
(`get_weather(city)`), send a prompt that should trigger it, and print whether the model
returned a valid tool call."
**STOP / verify:** Tester confirms a well-formed tool call comes back. ✅ = MiroFish + your agents are
good on this provider. ❌ = swap `.env` to a provider that supports tool-calling (e.g. OpenAI/Qwen)
and rerun — no code changes needed.

### T0.3 — MiroFish local run, tiny scenario ✅
**Prompt (mostly manual):** "Clone `666ghj/MiroFish`. Verify Node 18+, Python 3.11–3.12, uv.
Create its `.env` with `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL_NAME` set to the SAME values
your orchestrator uses (copy from your `.env`) + `ZEP_API_KEY`. Run
`npm run setup:all` then `npm run dev`. Configure the smallest possible scenario (few agents,
~10 rounds)."
**STOP / verify:** Tester loads MiroFish at :3000, runs one tiny simulation to completion, and
**records elapsed time + token cost**. Those numbers set the demo's agent/round caps.

### T0.4 — Firecrawl smoke test ✅
**Prompt:** "Create `spikes/firecrawl_search.py`. Call Firecrawl `/search` with an
Indian-market query (e.g. 'India edtech market size 2026 competitors') and print the top
results + scraped snippets."
**STOP / verify:** Tester sees usable grounded text. Note remaining free credits.

### T0.5 — MongoDB Atlas connection ✅
**Prompt:** "Create `spikes/mongo_ping.py`. Connect to `MONGODB_URI` (Atlas M0), insert one
doc into a `smoke` collection, read it back, print it."
**STOP / verify:** Tester confirms round-trip works (IP allowlist / network access set up).

**Phase 0 gate:** all five spikes green (or with documented fallbacks) before Phase 1.

---

## Phase 1 — Scaffolding

### T1.1 — Orchestrator skeleton (FastAPI :8000) ✅
**Prompt:** "Scaffold `/backend` as a FastAPI app on port 8000. Add `GET /health`, env loading
via pydantic-settings, CORS for `localhost:5173`, and a clean module layout: `routers/`,
`services/`, `models/`, `db/`. No business logic yet."
**STOP / verify:** `GET /health` returns 200; tester hits it from a browser.

### T1.2 — Frontend skeleton (React+Vite :5173) ✅
**Prompt:** "Scaffold `/frontend` as React+Vite on 5173. Add routing for: Landing, Connectors,
Upload, Dashboard. Build a shared layout shell + nav. Wire a `VITE_API_URL` pointing at :8000
and show backend `/health` status on the landing page."
**STOP / verify:** All routes load; landing shows backend 'healthy'. Confirms FE↔BE wiring + ports.

### T1.3 — Persistence layer + schemas ✅
**Prompt:** "In `/backend/db`, add a Mongo client and Pydantic models for collections:
`decisions`, `intake_context`, `agent_findings`, `simulations`, `verdicts`. Add repository
functions (create/get) for each. Seed nothing yet."
**STOP / verify:** Tester runs a small script that creates + reads one record per collection.

### T1.4 — Two-layer RAG foundation (build before agents — it's foundational) ✅
**Prompt:** "Add a `rag` module. `chunk_and_tag(text, layer)`: split into ~512-token chunks
(64 overlap), domain-tag each (financial/market/legal/competitor/execution by keyword). Store in
two layers: `decision` and `internal`. `get_agent_context(query, top_k)`: retrieve from both
layers, merge + dedupe, return formatted text. Primary backend = MongoDB Atlas Vector Search;
include an in-memory keyword-overlap fallback that works with zero infra (INSPIRATIONS.md §4)."
**STOP / verify:** Tester ingests a sample doc, queries per domain, gets relevant chunks back via
the keyword fallback (and via Atlas Vector if wired).

**Phase 1 gate:** skeleton runs, FE↔BE↔Mongo, and `get_agent_context` returns grounded chunks.

---

## Phase 2 — Intake pipeline (the differentiator)

### T2.1 — Upload + document parsing ✅
**Prompt:** "Add `POST /intake/upload` accepting PDF/DOCX. Parse to plain text (PyMuPDF/pdfplumber
/ python-docx). Store raw text in `decisions` AND chunk+tag it into the RAG `decision` layer (T1.4).
Return a `decision_id`."
**STOP / verify:** Tester uploads a sample pitch PDF; text is extracted and stored; id returned.

### T2.2 — LLM intake → DecisionContext + follow-ups ✅
**Prompt:** "Add a service that sends the parsed text to the LLM (OpenAI SDK, env-configured) and
returns a structured `DecisionContext` (core decision, market, stated beliefs, financial posture, gaps) PLUS 3–5
adaptive follow-up questions (MCQ/text) targeting the gaps. Expose `POST /intake/analyze`
(takes decision_id) and `POST /intake/answers` (saves answers into `intake_context`)."
**STOP / verify:** Tester runs analyze on the sample; gets sensible questions; submitting answers
persists a complete DecisionContext.

### T2.3 — Upload + adaptive Q&A UI ✅
**Prompt:** "Build the Upload page: drag-drop file → call analyze → render the follow-up
questions as a form (MCQ + text) → submit answers → show a 'context ready' summary."
**STOP / verify:** Tester completes the full intake flow in the browser, no console errors.

**Phase 2 gate:** upload a doc → answer questions → DecisionContext stored. End to end.

---

## Phase 3 — Adversarial agents (core engine)

### T3.1 — Agent framework + first agent (CFO) ✅
**Prompt:** "Create an agent abstraction: system prompt + a shared OpenAI-SDK client (from `LLM_*`
env) + a `get_agent_context` RAG tool so the agent grounds in the actual document. Findings use the
`VULNERABILITY / SEVERITY / ATTACK / QUESTION` format with a regex parser (INSPIRATIONS.md §2).
Implement the CFO agent (financial inconsistencies, invented metrics, runway). Add `POST /agents/run`
that runs CFO against a DecisionContext and stores findings in `agent_findings`."
**STOP / verify:** Tester runs CFO on the sample; gets parsed VULN/SEVERITY/ATTACK/QUESTION findings
that cite the document, stored.

### T3.2 — Remaining four agents, parallel + SSE fan-out ✅
**Prompt:** "Add Market, Competitor, Legal, Execution agents with distinct system prompts. Run all
five concurrently with an asyncio fan-out that streams each agent's result over SSE as it finishes
(`agent_start` → `agent_complete` with progress %), per INSPIRATIONS.md §1. Aggregate findings by agent."
**STOP / verify:** Tester sees five distinct perspectives stream in one-by-one (not all at once),
visibly disagreeing, all persisted.

### T3.3 — Firecrawl grounding (Market + Competitor) ✅
**Prompt:** "Give the Market and Competitor agents a Firecrawl `/search` tool so they cite live
evidence (alongside RAG grounding). Cache results in Mongo keyed by query to avoid re-scraping."
**STOP / verify:** Tester confirms those two agents cite real, current sources; cache hit on rerun.

### T3.4 — Live agent panel + findings view ✅
**Prompt:** "Build the Dashboard agent panel: five cards with a `waiting → thinking → complete`
state machine driven by the SSE stream (fetch + ReadableStream, INSPIRATIONS.md §7), severity
badges, expandable ATTACK/QUESTION, cited links for grounded agents."
**STOP / verify:** Tester watches the five cards animate as agents finish; severities + links render.

### T3.5 — Severity scoring + Risk Score ✅
**Prompt:** "Add `models/severity.py`: weights CRITICAL 30 / HIGH 15 / MEDIUM 5, +10 if ≥2 agents
flag CRITICAL, +5 if ≥3 flag HIGH, cap 100; `get_verdict(score)` with thresholds 80 / 50
(INSPIRATIONS.md §3). Compute the Risk Score from the aggregated findings."
**STOP / verify:** Tester confirms the score + verdict change sensibly as findings vary.

**Phase 3 gate:** five grounded agents stream a readable critique from a DecisionContext, with a
Risk Score + verdict.

---

## Phase 4 — Simulation bridge (MiroFish)

### T4.1 — Seed composer ✅
**Prompt:** "Add a service that composes a MiroFish seed document from DecisionContext +
top findings (the decision, market context, key risks) as natural-language seed material."
**STOP / verify:** Tester reviews a generated seed; it reads like valid MiroFish input.

### T4.2 — Simulation bridge (the documented 7-step pipeline) ✅
**Prompt:** "Implement the MiroFish bridge per `MIROFISH_INTEGRATION.md`: a thin `requests` client
that chains the 7 Flask endpoints (`/graph/ontology/generate` → `/graph/build` → `/simulation/create`
→ `/simulation/prepare` → `/simulation/start` → `/report/generate` → `/report/by-simulation`) with a
polling helper, capped at `max_rounds≈8`. POST the composed seed from T4.1. First run a one-off
`spikes/mirofish_probe.py` to confirm each endpoint's real `status` strings. Return a normalized
report (bull/base/bear + opinion dynamics), store it in `simulations`. **If the live run isn't ready,
return a cached/stub report so the rest of the pipeline is never blocked.**"
**STOP / verify:** Tester gets a real MiroFish report tied to a decision_id; killing MiroFish still
yields a valid stub so synthesis proceeds.

### T4.3 — Pre-run demo scenario + outcome viz ✅ (partial)
**What was built:** Swarm simulation progress bar streams live MiroFish phases over SSE
(`sim_progress` events); 3 downloadable reports (agents, swarm, GTM) added to dashboard.
MiroFish live simulation view opens in a new tab on `sim_started` event (not iframed, as the
Zep Cloud free tier's episode limit blocks fresh knowledge graph builds during demo).
**Status:** live simulation bridge works; fully cached pre-run not formalized.

**Phase 4 gate:** a decision flows into MiroFish and a prediction comes back into the dashboard. ✅

---

## Phase 5 — Synthesis + GTM

### T5.1 — Synthesis agent ✅
**Prompt:** "Add a synthesis service: fuse findings + simulation into a JSON report — Risk Score,
executive summary (adversarial tone), verdict, the 3 questions, and an India-specific GTM strategy
(channels, pricing posture, sequencing). Include a deterministic fallback that rebuilds the report
from `calculate_risk_score` if JSON parsing fails (INSPIRATIONS.md §6). Store in `verdicts`.
Expose `POST /synthesize`."
**STOP / verify:** Tester gets a coherent verdict + 3 questions + GTM that reflects the findings/sim;
forcing a bad-JSON response still yields a valid report via the fallback.

### T5.2 — End-to-end pipeline orchestration (the glue that makes it a product) ✅
**Prompt:** "Add `POST /analyze` that runs the whole pipeline for a `decision_id` and streams it over
SSE: load DecisionContext → fan out the 5 agents (reuse the T3.2 stream: `agent_start`/`agent_complete`)
→ severity score → MiroFish bridge (or cached/stub) → synthesis → emit a final `complete` event with
the full report. On the frontend, add a 'Run Red Team' button (after intake) that opens this SSE and
drives the dashboard live."
**STOP / verify:** One click takes a stored DecisionContext all the way to a verdict on screen, with
agents streaming in between — no manual per-endpoint calls.

### T5.3 — Dashboard assembly ✅
**Prompt:** "Assemble the full Dashboard: Intake summary → live Findings → Future bands → Verdict +
GTM → **Remediation Roadmap** (SVG flow: top findings → a remediation action per agent → verdict,
INSPIRATIONS.md §8), as one scrollable narrative with a prominent verdict banner."
**STOP / verify:** Tester walks the whole dashboard top to bottom; it tells one clear story.

**Phase 5 gate:** one click → full pipeline runs end to end and renders in the browser. ✅

---

## Phase 6 — Mock screens, demo polish, submission

### T6.1 — Mock landing / auth / connectors ✅
**What was built:** Animated `LandingPage` (hero + animated agent icons, features grid, CTA),
`PluginsPage` (connector toggles for Salesforce/Notion/GDrive/Slack/Jira with connected state
and doc-count badges), `HistoryPage` (mock analysis history list). All look production-ready.

### T6.2 — Demo dry-run + seed data + fallback
**Status:** End-to-end pipeline reliable for a fresh upload. Fully automated "demo mode" button
(pre-seeded Indian case, one-click) not implemented — user uploads their own doc + answers intake
questions. Triple fallback (RAG → keyword → hardcoded) is in place.

### T6.3 — Submission assets ✅
**What was built:** `README.md` at repo root — problem statement, architecture diagram, full API
reference, quick-start instructions, tech stack, environment variable reference, project structure.

**Final gate:** demo runs reliably + submission complete before the 3:30 PM Jun 14 window closes.

---

## Extra deliverables (beyond original plan)

These features were added after the core plan was complete:

### EX1 — Knowledge Base page ✅
Full `/knowledge-base` page: drag-and-drop upload (PDF/DOCX), extracted text stored in MongoDB
`knowledge_docs` collection (not the file), list view with 3 actions per doc:
- **Download** — exports extracted text as `.md` file
- **View** — full-screen popup with ESC-to-close + inline export button
- **Delete** — confirmation modal before removal
Backend: `POST /knowledge/upload`, `GET /knowledge/`, `GET /knowledge/{id}/content`,
`DELETE /knowledge/{id}`. Uploaded docs are chunked into the `internal` RAG layer automatically.

### EX2 — Live agent side panel (4 features) ✅
Right-side sticky panel on the AgentsPage analysis view, inspired by MiroFish's simulation UI:

1. **Agent status cards** — per-agent card with pulsing status dot, finding count, top severity
   badge, 2-line finding preview, animated bar when actively thinking
2. **Live event timeline feed** — real-time event log (capped at 50 entries) with typed entries
   per SSE event (agent_start, agent_complete, scoring, simulating, etc.) + HH:MM:SS timestamps
3. **D3 findings graph** — force-directed graph linking agent nodes → finding nodes, colored by
   severity, with zoom/pan/drag; renders as each agent completes
4. **RAG knowledge graph** — D3 force graph showing domain clusters (colored by domain) linked
   to source document nodes, weighted by chunk count; fetched from `GET /rag/graph/{decision_id}`

### EX3 — RAG graph API endpoint ✅
`GET /rag/graph/{decision_id}` — aggregates in-memory RAG chunks for a decision, groups by
source document → domain, returns nodes (domain + source kinds with colors and chunk counts)
and weighted links. Powers the KnowledgeGraph D3 component in the side panel.

---

## Risk-ordered priority (if time runs short, cut from the bottom)

1. Phase 0 spikes — non-negotiable.
2. RAG foundation (T1.4) — the agents are only as good as their grounding; build it early.
3. Intake + 5 agents + severity + synthesis (Phases 2, 3, 5) — the GenAI substance judges score.
4. Orchestration + dashboard (5.2, 5.3, 3.4) — the one-click flow + narrative; needed to demo.
5. MiroFish live (T4.2–4.3) — if it slips, keep the T4.2 stub and still demo it.
6. Mock screens (6.1) — nice-to-have polish.

## Parallelizing builder vs tester

While Claude Code builds task N, the tester prepares task N's checkpoint data (sample docs,
expected outputs, the Indian demo case) and writes down pass/fail criteria. The tester also
owns: the demo dataset, the fallback recording, and the README walkthrough on a second machine.
