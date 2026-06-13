# Agents Used — Foresight

> Every agent in the system, by pipeline layer. Agents 1–7 are **ours** (LLM via the OpenAI SDK,
> provider/model from `.env`, default Gemini). The future layer runs **inside MiroFish** and is
> called, not built. There is no separate "orchestrator agent" — orchestration is a plain asyncio
> fan-out in our code (the Red Team reference defined an ADK orchestrator but never ran it).
> *(The optional post-report Q&A agent is intentionally excluded.)*

## At a glance

| # | Agent | Layer | Built by us? | Grounding | Output |
|---|---|---|---|---|---|
| 1 | Intake / Interrogator | Intake | Yes (LLM) | The uploaded document | `DecisionContext` + follow-up questions |
| 2 | CFO | Adversarial | Yes (LLM) | RAG (both layers) | VULN/SEVERITY/ATTACK/QUESTION |
| 3 | Market | Adversarial | Yes (LLM) | RAG + **Firecrawl** | VULN/SEVERITY/ATTACK/QUESTION |
| 4 | Competitor | Adversarial | Yes (LLM) | RAG + **Firecrawl** | VULN/SEVERITY/ATTACK/QUESTION |
| 5 | Legal | Adversarial | Yes (LLM) | RAG (both layers) | VULN/SEVERITY/ATTACK/QUESTION |
| 6 | Execution | Adversarial | Yes (LLM) | RAG (both layers) | VULN/SEVERITY/ATTACK/QUESTION |
| 7 | Synthesis / GTM | Synthesis | Yes (LLM) | All findings + sim report | JSON verdict + GTM + remediation |
| 8 | MiroFish swarm | Future | No (MiroFish) | Seed knowledge graph | Per-agent social behaviour |
| 9 | MiroFish ReportAgent | Future | No (MiroFish) | Post-simulation world | Prediction report (bull/base/bear) |

---

## 1. Intake / Interrogator agent  *(Intake layer)*

- **Job:** read the uploaded strategic document, extract a structured `DecisionContext` (core
  decision, stated company beliefs, target market, financial posture, and gaps), then generate
  3–5 adaptive follow-up questions (MCQ/text) to fill those gaps.
- **Why it matters:** this is Foresight's differentiator. It grounds every downstream agent in the
  company's actual situation, so critiques are specific rather than generic.
- **Grounding:** the parsed document (also chunked into the RAG `decision` layer).
- **Output:** `DecisionContext` + follow-up questions → the shared seed for all later stages.

## 2–6. The five adversarial agents  *(Adversarial layer — run in parallel)*

Each plays a single-minded attacker with an explicit mandate to find failure — no balancing, no
upside-hunting. Each retrieves from **both RAG layers** (`get_agent_context`) so it cites the real
document, and emits findings in the strict format:

```
VULNERABILITY: <short title>
SEVERITY: CRITICAL | HIGH | MEDIUM
ATTACK: <explanation citing specific data>
QUESTION: <what management must answer>
```

- **2. CFO** — "the most cynical financial mind in the room." Finds why the numbers don't add up:
  inconsistencies, invented/ad-hoc metrics, runway gaps, projection-vs-history deltas. Must surface
  ≥3 concrete financial flaws.
- **3. Market** — "your most skeptical future customer." Attacks demand assumptions, switching
  costs, and where the moat is actually sand. **Firecrawl-grounded** for live market evidence.
- **4. Competitor** — "the CEO of your main rival." Explains exactly how incumbents win, whether the
  valuation gap is justified, and how low the entry barriers really are. **Firecrawl-grounded** for
  current competitor/benchmark data.
- **5. Legal** — "the lawyer hunting conflicts of interest." Finds who really controls the company,
  insider transactions, founder-entrenchment structures, and undisclosed regulatory exposure.
- **6. Execution** — "a COO who's watched plans like this fail." Doesn't attack the strategy — attacks
  *this* org's ability to execute *it*: organizational dysfunction, human single points of failure,
  expansion pace vs. capacity.

**Orchestration:** all five run concurrently via `asyncio`; results stream to the UI over SSE
(`agent_start → agent_complete` with a progress %) as each finishes. **No agent framework.**

**Configurable roster (optional):** the inspiration lets users add/disable attackers ("build your
own expert team"). If adopted, keep the five in a config list rather than hardcoded.

## 7. Synthesis / GTM agent  *(Synthesis layer)*

- **Job:** aggregate the five agents' findings + the MiroFish prediction report into one executive
  output. Merges overlapping vulnerabilities (raising severity when ≥2 agents converge), keeps the
  adversarial tone, and produces a JSON report.
- **Deterministic guardrails:** a Risk Score (0–100) is computed in code, not vibes —
  `CRITICAL 30 / HIGH 15 / MEDIUM 5`, `+10` if ≥2 agents flag CRITICAL, `+5` if ≥3 flag HIGH, capped
  at 100. Verdict thresholds: ≥80 `DO_NOT_PROCEED`, 50–79 `PROCEED_WITH_CAUTION`, <50 `PROCEED`.
  If the LLM's JSON is malformed, a fallback rebuilds the report from the computed score.
- **Output:** Risk Score, verdict, executive summary, the 3 questions the team must answer, an
  India-specific GTM strategy, and a remediation roadmap (each top finding → a recommended action).

## 8–9. MiroFish swarm + ReportAgent  *(Future layer — inside MiroFish, called not built)*

We hand MiroFish a **seed** (the decision + market context + key findings) and it runs its own
multi-agent world:

- **8. Swarm agents** — tens to thousands of persona-driven agents (independent personality,
  long-term memory, behavioural logic, via the OASIS engine) that post, debate, follow, and shift
  positions on simulated social platforms. For the demo, cap the population and rounds.
- **9. ReportAgent** — interacts with the post-simulation world and synthesizes what happened
  (how opinions shifted, what coalitions formed) into a structured prediction report — the
  bull/base/bear outcome bands we ingest into the dashboard.

These are MiroFish's internals; our only contract is the seed in and the report out.

---

## Summary

**7 agents we build** — 1 Intake + 5 Adversarial (parallel) + 1 Synthesis — all on the OpenAI SDK
with an env-configured model. **2 agent roles inside MiroFish** (swarm + ReportAgent) power the
future layer. Orchestration is asyncio, not a framework. Scoring and fallbacks are deterministic so
the verdict is defensible and the demo is bulletproof.
