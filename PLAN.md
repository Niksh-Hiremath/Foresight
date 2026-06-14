# Foresight — Build Plan

> Strategic-decision stress-test platform for Indian startups, VCs, and businesses
> facing high-stakes moves (market pivots, product launches, financial decisions).
> HackPrix S3 · GenAI & ML track · 2-person team · 13–14 June 2026.

## One-liner

The people who propose a strategy are the same ones who defend it. Foresight stress-tests
a strategic decision from the inside — adversarial AI agents attack the plan using the
company's own context and live market data, a swarm simulation plays the decision forward,
and the system returns a verdict + an India-specific go-to-market strategy.

## Hard constraints

- **Time:** Hacking 11:00 AM Jun 13 → submission window closes ~3:30 PM Jun 14. ~20 productive hours.
- **Team:** 2 people. Everything non-core must be mocked.
- **Track fit (GenAI/ML):** judges reward visible multi-agent *reasoning*, not breadth.
- **Golden rule:** 80% mocked + 20% genuinely deep. Integrate the seams early.

## The pipeline (one story: Upload → Interrogate → Critique → Simulate → Strategize)

### 1. Upload + adaptive intake  *(REAL — delivered)*
- User uploads a strategic doc (business plan / pitch / IPO prospectus / market-entry memo).
- pdfplumber / python-docx parses it; LLM extracts the core decision + stated beliefs/assumptions.
- 3–5 adaptive follow-up questions (MCQ + text) target the gaps; user answers → `DecisionContext`.
- This intake grounds every downstream agent in the company's actual situation.

### 2. Past / Present — adversarial agent layer  *(REAL — delivered)*
Five agents attack from distinct angles, running in parallel via asyncio fan-out:
- **CFO Agent** — financial inconsistencies, invented/inflated metrics, runway gaps.
- **Market Agent** — weak demand assumptions, missing moat, TAM inflation. *(live Firecrawl search)*
- **Competitor Agent** — why existing players already win. *(live Firecrawl search)*
- **Legal Agent** — conflicts of interest, governance/compliance failures.
- **Execution Agent** — why *this* org can't execute *this* plan.
- All stream findings over SSE as `VULNERABILITY / SEVERITY / ATTACK / QUESTION` blocks.

### 3. Future — MiroFish swarm simulation  *(REAL — delivered, new-tab view)*
- Seed composed from DecisionContext + top findings → MiroFish 7-step bridge.
- OASIS engine: personality-driven agents on simulated social platforms → structured report.
- Output: bull / base / bear narrative + opinion dynamics + swarm report (3 downloadable MDs).
- MiroFish Vue UI opens in a new tab on `sim_started` SSE event.
- Zep Cloud free tier 403 → bridge returns stub so pipeline never blocks.

### 4. GTM strategy + verdict  *(REAL — delivered)*
- Synthesis LLM call fuses critique + simulation into a JSON report with deterministic fallback.
- Verdict: **Proceed / Caution / Do Not Proceed** with severity score (0–100).
- 3 questions the team must answer before moving forward.
- India-specific go-to-market strategy (channels, pricing posture, sequencing).
- Remediation Roadmap: top findings → concrete action per agent → verdict (SVG flow diagram).

### 5. Knowledge Base  *(REAL — delivered, beyond original plan)*
- `/knowledge-base` page: drag-and-drop upload of internal docs (strategy memos, data exports).
- Extracted text stored in MongoDB; chunked into the `internal` RAG layer automatically.
- List view: download as .md, view in popup, delete.

### 6. Live agent side panel  *(REAL — delivered, beyond original plan)*
- Right-side sticky panel with per-agent status cards, live event timeline, D3 findings graph,
  and D3 RAG knowledge graph (domain clusters + source doc nodes).

---

## What was planned vs. what shipped

| Component | Planned | Shipped |
|---|---|---|
| Adaptive intake (upload + Q&A) | REAL | ✅ REAL |
| 5 adversarial agents (SSE) | REAL | ✅ REAL |
| Web search grounding (Market/Competitor) | REAL | ✅ REAL (Firecrawl) |
| Two-layer RAG | REAL | ✅ REAL (keyword fallback active) |
| MiroFish swarm simulation | REAL, pre-run | ✅ REAL, live bridge + new-tab view |
| Synthesis → verdict + GTM | REAL | ✅ REAL |
| Remediation Roadmap | REAL | ✅ REAL (SVG flow) |
| Salesforce / Confluence connectors | MOCK | ✅ MOCK (PluginsPage toggles) |
| Landing / signup screens | MOCK | ✅ MOCK (animated LandingPage) |
| Knowledge Base page | not planned | ✅ built (upload, view, download, delete) |
| Live agent side panel | not planned | ✅ built (4 features inc. 2 D3 graphs) |
| RAG knowledge graph endpoint | not planned | ✅ built (`GET /rag/graph/{id}`) |
| History page | not planned | ✅ built (mock history list) |
| Demo mode (one-click pre-seeded) | planned | ❌ not implemented (fresh upload instead) |

---

## Team split (2 people)

- **Builder** — drives Claude Code through the entire build (see ROADMAP.md): scaffolding,
  intake, the five agents, MiroFish bridge, synthesis, mock screens, knowledge base, side panel.
- **Tester** — verifies each task at its STOP gate; owns the demo dataset, the Indian
  cautionary-tale case, the fallback recording, and the README walkthrough on a second machine.

## Partner-prize strategy

- **MongoDB** — decisions, agent transcripts, verdicts, simulation reports, knowledge docs,
  RAG chunks. Core persistence for the entire pipeline.
- **Firecrawl** — web grounding for Market + Competitor agents; results cited in findings.
- **MiroFish / OASIS** — swarm simulation engine (hackathon partner).
- **LLM:** `meta/llama-3.3-70b-instruct` via OpenRouter (active). Env-swappable to Gemini,
  GPT-4o, or any OpenAI-SDK-compatible endpoint with zero code changes.

## Demo script (~90 sec)

1. Upload a recognizable Indian business plan (overreach-style doc).
2. System asks 2 sharp follow-up questions; user answers in 15 seconds.
3. Five agents light up and stream fatal flaws (inflated metrics, no moat, governance risk).
4. Right panel shows live event feed + D3 findings graph building in real time.
5. MiroFish "runs" — simulation phases stream via SSE; new tab shows live world.
6. Verdict: **Do Not Proceed** + 3 questions + India GTM.
7. Download 3 reports (agents, swarm, GTM) for takeaway.

## Biggest risks & mitigations (post-hoc)

| Risk | What happened |
|---|---|
| MiroFish won't run live | Bridge works. Zep 403 caught → stub; Vue UI opens in new tab |
| Scope creep across 5 stages | Stayed focused on happy path; extras added after core done |
| Agents sound generic | RAG grounding + intake context feed specific doc content |
| Integration done too late | End-to-end SSE pipeline built in T5.2; rest layered on top |
| LLM `response_format` not supported | Switched to regex parser + deterministic fallback |
