# RedTeam (working name) — Build Plan

> Strategic-decision stress-test platform for Indian startups, VCs, and businesses
> facing high-stakes moves (market pivots, product launches, financial decisions).
> HackPrix S3 · GenAI & ML track · 2-person team · 13–14 June 2026.

## One-liner

The people who propose a strategy are the same ones who defend it. RedTeam stress-tests
a strategic decision from the inside — adversarial AI agents attack the plan using the
company's own context and live market data, a swarm simulation plays the decision forward,
and the system returns a verdict + an India-specific go-to-market strategy.

## Hard constraints

- **Time:** Hacking 11:00 AM Jun 13 → submission window closes ~3:30 PM Jun 14. ~20 productive hours.
- **Team:** 2 people. Everything non-core must be mocked.
- **Track fit (GenAI/ML):** judges reward visible multi-agent *reasoning*, not breadth.
- **Golden rule:** 80% mocked + 20% genuinely deep. Integrate the seams early.

## The pipeline (one story: Upload → Interrogate → Critique → Simulate → Strategize)

### 1. Upload + adaptive intake  *(REAL — this is the differentiator)*
- User uploads a strategic doc (business plan / pitch / IPO prospectus / market-entry memo).
- Parse it; extract the core decision + the company's stated beliefs/assumptions.
- Ask 3–5 adaptive follow-up questions (MCQ + text) to fill gaps and capture context
  (target market, capital position, timeline, risk tolerance).
- This intake grounds every downstream agent in the company's actual situation — it's
  what separates this from "an LLM with a prompt."

### 2. Past / Present — adversarial agent layer  *(REAL core engine)*
Five agents attack from distinct angles, running in parallel, visibly disagreeing:
- **CFO Agent** — financial inconsistencies, invented/inflated metrics, runway gaps.
- **Market Agent** — weak demand assumptions, missing moat, TAM inflation. *(live web search)*
- **Competitor Agent** — why existing players already win. *(live web search)*
- **Legal Agent** — conflicts of interest, governance/compliance failures.
- **Execution Agent** — why *this* org can't execute *this* plan.
- Live web search on Market + Competitor agents = grounded, non-hallucinated critique.
- Connectors (Salesforce/Confluence) + RSS: **MOCKED** behind a real-looking connect screen
  with one hardcoded realistic dataset.

### 3. Future — MiroFish swarm simulation  *(REAL but pre-run for demo)*
- MiroFish (open source, GitHub 666ghj/MiroFish): feed seed info → GraphRAG knowledge graph
  → thousands of personality-driven agents debate on simulated social platforms → ReportAgent
  synthesizes a structured prediction report.
- Seed = the decision + market context from stages 1–2.
- Output: bull / base / bear outcome bands with probabilities + opinion-dynamics narrative.
- **CRITICAL for demo:** pre-run the simulation and cache results; cap agents at ~50–200.
  A live 1M-agent run will not finish on stage. Show a "running" animation over cached output.

### 4. GTM strategy + verdict  *(REAL — the headline deliverable)*
- Synthesis agent fuses critique (stage 2) + simulation (stage 3).
- Verdict: **Proceed / Caution / Do Not Proceed** with severity scores.
- The 3 questions the team must answer before moving forward.
- An India-specific go-to-market strategy (channels, pricing posture, sequencing).

## What's real vs. mocked

| Component | Status | Notes |
|---|---|---|
| Adaptive intake (upload + follow-up Q&A) | REAL | The differentiator |
| 5 adversarial agents | REAL | Core engine; make them visibly disagree |
| Web search grounding (Market/Competitor) | REAL | Stops hallucination |
| MiroFish future simulation | REAL, pre-run | Cap agents; cache for demo |
| Synthesis → verdict + GTM | REAL | Headline output |
| Salesforce / Confluence connectors | MOCK | Real connect screen, hardcoded dataset |
| RSS feeds | MOCK | One curated feed if time allows |
| Landing / signup / auth screens | MOCK | Static, polished |

## Team split (2 people)

- **Builder** — drives Claude Code through the entire build (see ROADMAP.md): scaffolding,
  intake, the five agents, MiroFish bridge, synthesis, mock screens.
- **Tester** — verifies each task at its STOP gate; owns the demo dataset, the Indian
  cautionary-tale case, the fallback recording, and the README walkthrough on a second machine.
- Never skip a gate; integrate end-to-end early. The seams are the #1 risk, not any single stage.

## Partner-prize strategy (target 2)

- **Gemini** (Google swag) — the default LLM provider, accessed through the OpenAI SDK with
  `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` from `.env`. Powers intake, the five agents, and
  synthesis. Provider is env-swappable, but Gemini is the default → keeps prize eligibility.
- **MongoDB** — store decisions, agent transcripts, verdicts, simulation reports.
- Optional flourishes if time: **n8n** (visual orchestration), **ElevenLabs** (voiced verdict readout).
- (Sarvam AI dropped — consolidated on a single env-configured LLM.)

## Suggested timeline

| Window | Person A | Person B |
|---|---|---|
| Jun 13, 11 AM–2 PM | Scaffold app, screens, upload UI | Stand up agent framework + 1 working agent |
| 2–6 PM | Adaptive Q&A flow + dashboard shell | All 5 agents + web search grounding |
| 6–10 PM | Wire stages 1→2, mock connectors | MiroFish integration + first pre-run |
| 10 PM–2 AM | Outcome-band viz, synthesis UI | Synthesis/GTM agent, cache sim results |
| Jun 14, 8 AM–12 PM | Polish, demo dataset, India example | Tighten prompts, verdict scoring |
| 12–3 PM | **Full dry-run x3**, record fallback video | Same — lock cached demo path |
| 3–3:30 PM | Submit | Submit |

## Demo script (~90 sec)

1. Upload a recognizable Indian cautionary tale's "plan" (Byju's / BharatPe / Dunzo-style overreach).
2. System asks 2 sharp follow-up questions; user answers.
3. Five agents light up and flag the fatal flaws (inflated metrics, no moat, governance risk).
4. MiroFish "runs" — market sentiment turns; bear band dominates.
5. Verdict: **Do Not Proceed** + the 3 questions + what the India GTM should have been.

## Biggest risks & mitigations

- **MiroFish won't run live** → pre-run + cache + capped agents + "running" animation. Always have a recorded fallback.
- **Scope creep across 5 stages** → mock aggressively; one polished happy-path beats five half-paths.
- **Agents sound generic** → feed them the intake context; make disagreement explicit in the UI.
- **Integration done too late** → end-to-end skeleton by the halfway mark, even if every stage is stubbed.

## Open questions to resolve early

- Can MiroFish run on your laptop / a Vultr instance in time, or do you mock it entirely and just *integrate the report format*?
- Which Indian failure case gives the cleanest, most recognizable demo?
- LLM provider mix: Sarvam for India agents + Gemini for synthesis — confirm API access early.
