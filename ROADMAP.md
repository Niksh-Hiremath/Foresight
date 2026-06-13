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
(provider/model from `.env`; default Gemini) · Firecrawl · MongoDB Atlas (M0) ·
MiroFish sidecar (Vue :3000 / API :5001).

> **LLM rule for every task below:** all LLM calls use the OpenAI Python SDK, built from
> `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` read from `.env`. Never hardcode a provider,
> base URL, or model string anywhere. Build one shared client and reuse it.

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

### T1.1 — Orchestrator skeleton (FastAPI :8000)
**Prompt:** "Scaffold `/backend` as a FastAPI app on port 8000. Add `GET /health`, env loading
via pydantic-settings, CORS for `localhost:5173`, and a clean module layout: `routers/`,
`services/`, `models/`, `db/`. No business logic yet."
**STOP / verify:** `GET /health` returns 200; tester hits it from a browser.

### T1.2 — Frontend skeleton (React+Vite :5173)
**Prompt:** "Scaffold `/frontend` as React+Vite on 5173. Add routing for: Landing, Connectors,
Upload, Dashboard. Build a shared layout shell + nav. Wire a `VITE_API_URL` pointing at :8000
and show backend `/health` status on the landing page."
**STOP / verify:** All routes load; landing shows backend 'healthy'. Confirms FE↔BE wiring + ports.

### T1.3 — Persistence layer + schemas
**Prompt:** "In `/backend/db`, add a Mongo client and Pydantic models for collections:
`decisions`, `intake_context`, `agent_findings`, `simulations`, `verdicts`. Add repository
functions (create/get) for each. Seed nothing yet."
**STOP / verify:** Tester runs a small script that creates + reads one record per collection.

**Phase 1 gate:** skeleton runs, FE talks to BE, BE talks to Mongo.

---

## Phase 2 — Intake pipeline (the differentiator)

### T2.1 — Upload + document parsing
**Prompt:** "Add `POST /intake/upload` accepting PDF/DOCX. Parse to plain text (pdfplumber /
python-docx). Store the raw text in `decisions`. Return a `decision_id`."
**STOP / verify:** Tester uploads a sample pitch PDF; text is extracted and stored; id returned.

### T2.2 — Gemini intake → DecisionContext + follow-ups
**Prompt:** "Add a service that sends the parsed text to the LLM (OpenAI SDK, env-configured) and
returns a structured `DecisionContext` (core decision, market, stated beliefs, financial posture, gaps) PLUS 3–5
adaptive follow-up questions (MCQ/text) targeting the gaps. Expose `POST /intake/analyze`
(takes decision_id) and `POST /intake/answers` (saves answers into `intake_context`)."
**STOP / verify:** Tester runs analyze on the sample; gets sensible questions; submitting answers
persists a complete DecisionContext.

### T2.3 — Upload + adaptive Q&A UI
**Prompt:** "Build the Upload page: drag-drop file → call analyze → render the follow-up
questions as a form (MCQ + text) → submit answers → show a 'context ready' summary."
**STOP / verify:** Tester completes the full intake flow in the browser, no console errors.

**Phase 2 gate:** upload a doc → answer questions → DecisionContext stored. End to end.

---

## Phase 3 — Adversarial agents (core engine)

### T3.1 — Agent framework + first agent (CFO)
**Prompt:** "Create an agent abstraction (system prompt + LLM call via a shared OpenAI-SDK client
built from `LLM_*` env vars + structured findings output: {claim, severity 1-5, evidence}).
Implement the CFO agent (financial inconsistencies,
inflated metrics, runway). Add `POST /agents/run` that runs CFO against a DecisionContext and
stores findings."
**STOP / verify:** Tester runs CFO on the sample; gets scored, relevant findings stored.

### T3.2 — Remaining four agents, parallel
**Prompt:** "Add Market, Competitor, Legal, Execution agents with distinct system prompts.
Run all five concurrently (asyncio) in `/agents/run`; aggregate findings by agent."
**STOP / verify:** Tester sees five distinct perspectives, visibly disagreeing, all persisted.

### T3.3 — Firecrawl grounding (Market + Competitor)
**Prompt:** "Give the Market and Competitor agents a Firecrawl `/search` tool so they cite live
evidence. Cache results in Mongo keyed by query to avoid re-scraping."
**STOP / verify:** Tester confirms those two agents cite real, current sources; cache hit on rerun.

### T3.4 — Findings view
**Prompt:** "Build the Dashboard 'Findings' section: five agent cards, severity badges,
expandable evidence, with cited links for grounded agents."
**STOP / verify:** Tester views findings in browser; links open; severities render.

**Phase 3 gate:** five grounded agents produce a readable critique from a DecisionContext.

---

## Phase 4 — Simulation bridge (MiroFish)

### T4.1 — Seed composer
**Prompt:** "Add a service that composes a MiroFish seed document from DecisionContext +
top findings (the decision, market context, key risks) as natural-language seed material."
**STOP / verify:** Tester reviews a generated seed; it reads like valid MiroFish input.

### T4.2 — Trigger + retrieve (start with Option B)
**Prompt:** "Implement the integration: first try the API path — inspect MiroFish's backend
(:5001) for a route to start a simulation and fetch the report; if none is clean, fall back to
the sidecar/embed path (run the scenario in MiroFish's own UI, capture its report JSON).
Store results in `simulations`."
**STOP / verify:** Tester gets a real MiroFish report (bull/base/bear + opinion dynamics) tied to
a decision_id, by whichever path works.

### T4.3 — Pre-run demo scenario + outcome viz
**Prompt:** "Pre-run the demo scenario and cache the report so the live demo never waits on a
fresh simulation. Build the Dashboard 'Future' section: bull/base/bear bands + a link/iframe to
the MiroFish world."
**STOP / verify:** Tester loads cached outcome bands instantly; MiroFish world opens.

**Phase 4 gate:** a decision flows into MiroFish and a prediction comes back into the dashboard.

---

## Phase 5 — Synthesis + GTM

### T5.1 — Synthesis agent
**Prompt:** "Add a synthesis service: fuse findings + simulation into a verdict
(Proceed/Caution/Do Not Proceed) with severity, the 3 questions to answer first, and an
India-specific GTM strategy (channels, pricing posture, sequencing). Store in `verdicts`.
Expose `POST /synthesize`."
**STOP / verify:** Tester gets a coherent verdict + 3 questions + GTM that reflects the findings/sim.

### T5.2 — Dashboard assembly
**Prompt:** "Assemble the full Dashboard: Intake summary → Findings → Future bands → Verdict +
GTM, as one scrollable narrative with a prominent verdict banner."
**STOP / verify:** Tester walks the whole dashboard top to bottom; it tells one clear story.

**Phase 5 gate:** full pipeline visible end to end in the browser.

---

## Phase 6 — Mock screens, demo polish, submission

### T6.1 — Mock landing / auth / connectors
**Prompt:** "Build polished static Landing, Sign-up (mock), and Connectors page (Salesforce/RSS
toggles that set a hardcoded dataset). No real auth — make it look production-ready."
**STOP / verify:** Tester clicks through; screens look credible for a demo.

### T6.2 — Demo dry-run + seed data + fallback
**Prompt:** "Wire a one-click demo: a recognizable Indian cautionary-tale 'plan' preloaded,
running the full pipeline against cached MiroFish output. Add a 'reset demo' button."
**STOP / verify:** Tester runs the 90-second demo 3× cleanly. **Record a fallback screen capture.**

### T6.3 — Submission assets
**Prompt:** "Write the README (problem, architecture diagram, stack, partner-tech usage for
Gemini — default LLM provider via OpenAI SDK — + MongoDB prizes, setup steps) and a short demo script."
**STOP / verify:** Tester follows the README from scratch on the other laptop; it works.

**Final gate:** demo runs reliably + submission complete before the 3:30 PM Jun 14 window closes.

---

## Risk-ordered priority (if time runs short, cut from the bottom)

1. Phase 0 spikes — non-negotiable.
2. Intake + 5 agents + synthesis (Phases 2, 3, 5) — the GenAI substance judges score.
3. Dashboard narrative (5.2) — needed to demo.
4. MiroFish live (Phase 4) — if it slips, fall back to cached/output-only and still demo it.
5. Mock screens (6.1) — nice-to-have polish.

## Parallelizing builder vs tester

While Claude Code builds task N, the tester prepares task N's checkpoint data (sample docs,
expected outputs, the Indian demo case) and writes down pass/fail criteria. The tester also
owns: the demo dataset, the fallback recording, and the README walkthrough on a second machine.
