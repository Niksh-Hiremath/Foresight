# Inspirations from the Red Team Agent repo (galatro/hackaton-ai-week-2026)

> Extracted from the **actual cloned code**, adapted to Foresight's stack
> (OpenAI SDK · env-driven LLM · MongoDB Atlas · Firecrawl · MiroFish).
> Source: `redteam/redteam-agent/` (backend = FastAPI + Python, frontend = React/Vite/TS).

## Key architectural lesson

Their `agents/orchestrator.py` defines a Google ADK `SequentialAgent(ParallelAgent(...), synthesis)`
graph — but **`main.py` never imports or runs it.** At runtime they hand-roll orchestration with
`asyncio` and call the LLM directly, reusing only the `*_SYSTEM_PROMPT` string constants. The ADK
agent objects are dead code. **Takeaway: do not adopt an orchestration SDK — a plain asyncio
fan-out is all this topology needs.**

Other reliability theme worth copying: **everything has a deterministic fallback** — RAG falls back
to keyword search, the demo falls back to a hardcoded context string, synthesis falls back to a
computed report if JSON parsing fails. Build the same safety nets; the demo never breaks on stage.

---

## 1. Parallel agent fan-out + SSE event stream (adapt to OpenAI SDK)

The heart of the demo. Stream each agent's result as it finishes, with a progress %.

```python
# orchestrator: run N agents in parallel, emit SSE events as each completes
import asyncio, json
from openai import AsyncOpenAI   # configured from LLM_* env vars
client = AsyncOpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)

AGENTS = ["cfo", "market", "legal", "competitor", "execution"]

async def run_agent(name: str, document_context: str, grounding: str) -> list[dict]:
    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPTS[name]},
            {"role": "user", "content": f"DOCUMENT:\n{document_context}\n\nEVIDENCE:\n{grounding}"},
        ],
    )
    return parse_vulnerabilities(resp.choices[0].message.content, name)

async def event_stream(session_id: str, document_text: str):
    def sse(d): return f"data: {json.dumps(d, ensure_ascii=False)}\n\n"
    yield sse({"event": "ingesting", "agent": "system"})

    tasks = {asyncio.create_task(run_agent(n, document_text, "")): n for n in AGENTS}
    for n in AGENTS:
        yield sse({"event": "agent_start", "agent": n})

    findings, pending, done_count = [], set(tasks), 0
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            vulns = t.result() or []
            findings.extend(vulns); done_count += 1
            yield sse({"event": "agent_complete", "agent": tasks[t],
                       "vulnerabilities": vulns,
                       "progress": int(done_count / len(AGENTS) * 80)})

    yield sse({"event": "synthesizing", "agent": "synthesis"})
    report = await run_synthesis(findings)
    yield sse({"event": "complete", "report": report, "progress": 100})
```

FastAPI returns it as `StreamingResponse(event_stream(...), media_type="text/event-stream",
headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})`.

## 2. Regex parser for agent free-text findings

Their agents emit `VULNERABILITY / SEVERITY / ATTACK / QUESTION` blocks; this parses them.
(You can instead use the OpenAI SDK's structured/JSON output — but keep this as a robust fallback.)

```python
import re
PATTERN = re.compile(
    r"VULNERABILITY:\s*(.+?)\s*\n"
    r"SEVERITY:\s*(CRITICAL|HIGH|MEDIUM)\s*\n"
    r"ATTACK:\s*(.*?)\s*\n"
    r"QUESTION:\s*(.*?)(?=\nVULNERABILITY:|\Z)", re.DOTALL)

def parse_vulnerabilities(text: str, agent: str) -> list[dict]:
    out = []
    for i, m in enumerate(PATTERN.finditer(text), 1):
        out.append({"id": f"{agent}_{i}", "agent": agent, "title": m.group(1).strip(),
                    "severity": m.group(2).strip(), "attack": m.group(3).strip(),
                    "question": m.group(4).strip()})
    return out
```

## 3. Deterministic severity scoring (drop-in, pure Python)

```python
SEVERITY_WEIGHTS = {"CRITICAL": 30, "HIGH": 15, "MEDIUM": 5}
VERDICT_THRESHOLDS = {"DO_NOT_PROCEED": 80, "PROCEED_WITH_CAUTION": 50, "PROCEED": 0}

def calculate_risk_score(vulns: list[dict]) -> int:
    base = sum(SEVERITY_WEIGHTS.get(v["severity"], 0) for v in vulns)
    if len({v["agent"] for v in vulns if v["severity"] == "CRITICAL"}) >= 2:
        base += 10                      # cross-agent CRITICAL convergence
    if len({v["agent"] for v in vulns if v["severity"] == "HIGH"}) >= 3:
        base += 5
    return min(base, 100)

def get_verdict(score: int) -> str:
    if score >= 80: return "DO_NOT_PROCEED"
    if score >= 50: return "PROCEED_WITH_CAUTION"
    return "PROCEED"
```

## 4. In-memory RAG with keyword fallback (skip the vector DB for the demo)

Their `get_agent_context` tries Vertex, then falls back to naive keyword-overlap scoring over
chunked text held in memory. For a 36-hour build this is often *enough* — you may not need Atlas
Vector Search at all. Two-layer = `decision` (uploaded doc) + `internal` (connector/company docs).

```python
_store = {"decision": [], "internal": []}

def chunk_text(text, size=512, overlap=64):
    words, chunks, i = text.split(), [], 0
    while i < len(words):
        chunks.append(" ".join(words[i:i+size]))
        if i+size >= len(words): break
        i += size - overlap
    return chunks

def keyword_search(layer, query, top_k=5):
    qs = set(query.lower().split())
    def score(c): return len(qs & set(c["text"].lower().split())) / max(len(qs), 1)
    return sorted(_store.get(layer, []), key=score, reverse=True)[:top_k]

def get_agent_context(query, top_k=5):
    hits = keyword_search("decision", query, top_k) + keyword_search("internal", query, top_k)
    return "\n\n".join(f"[{i}] ({c['source']})\n{c['text']}" for i, c in enumerate(hits, 1))
```

> Upgrade path if you have time: swap `keyword_search` for **MongoDB Atlas Vector Search**
> (you already run Atlas) — same interface, real embeddings. Keep keyword search as the fallback.

Domain tagging (optional, lets each agent pull its own slice):
```python
DOMAIN_KEYWORDS = {
  "financial": ["revenue","ebitda","loss","valuation","margin","debt","cash"],
  "market": ["customer","demand","growth","churn","retention","product"],
  "legal": ["governance","founder","control","board","conflict","trademark"],
  "competitor": ["competitor","incumbent","benchmark","moat","comparison"],
  "execution": ["operations","expansion","headcount","leadership","scale"],
}
```

## 5. Triple-fallback demo mode

`demo_mode=True` bypasses upload and loads a pre-baked context. Falls back to a hardcoded string
if RAG is empty — so the on-stage run is bulletproof. Build the equivalent for an **Indian case**
(e.g. Byju's / BharatPe), as a `data/<case>/context.md` plus a hardcoded fallback string.

## 6. Synthesis with deterministic fallback

```python
async def run_synthesis(findings):
    try:
        resp = await client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role":"system","content":SYNTHESIS_PROMPT},
                      {"role":"user","content":json.dumps(findings, ensure_ascii=False)}])
        return json.loads(re.search(r"\{.*\}", resp.choices[0].message.content, re.DOTALL).group())
    except Exception:
        score = calculate_risk_score(findings)
        return {"risk_score": score, "executive_summary": "...",
                "vulnerabilities": findings,
                "top_3_questions": [v["question"] for v in findings[:3]],
                "verdict": get_verdict(score)}
```

## 7. Frontend: POST-based SSE reader (EventSource can't POST FormData)

```ts
// useSSE.ts — fetch + ReadableStream, parse `data: ` lines
const res = await fetch(url, { method: 'POST', body: formData, signal })
const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
while (true) {
  const { done, value } = await reader.read(); if (done) break
  buf += dec.decode(value, { stream: true })
  const lines = buf.split('\n'); buf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim(); if (!raw || raw === '[DONE]') continue
    onEvent(JSON.parse(raw))   // {event, agent, vulnerabilities, progress, report}
  }
}
```

Per-agent UI state machine: `waiting → thinking → complete → error` (one card per agent).

## 8. Remediation Roadmap (their best un-spec'd feature)

`RemediationDiagram.tsx` renders an SVG 3-column flow: **top findings → a remediation action per
agent → the verdict**. It maps each agent to a fix (e.g. CFO → "Independent financial audit",
Legal → "External legal & compliance review"). This is the natural bridge from critique to your
**GTM/strategy output** — adopt the concept: every CRITICAL/HIGH finding gets a recommended action,
and those roll up into the go-to-market plan.

## 9. Dashboard model worth copying

- **Sections:** `overview / sources / agents / history`.
- **Data sources as context:** Notion, GDrive, Confluence, Salesforce, Slack, Jira, SharePoint,
  Upload — each a toggle card with `connected`, `lastSync`, `docsCount`. Copy line:
  *"Connected sources are automatically included as context in every analysis."*
- **Configurable agents:** `Agent { isBuiltIn, enabled, color, icon }` — lets users disable defaults
  or add their own attacker (matches the inspiration's "build your own expert team").
- **History:** past analyses with `riskScore`, `verdict`, `tags` — trivial win backed by your Mongo store.

## What to skip

- Google ADK, Vertex AI Vector Search, Firestore, Cloud Run, GCS, IAM/ADC — all Google-stack lock-in
  you've explicitly designed away from. The runtime code already proves you don't need ADK.
- `text-embedding-004` / Vertex embeddings — use Atlas Vector Search or the keyword fallback instead.

## Foresight-specific additions (not in their repo)

- **Firecrawl grounding** for Market + Competitor agents → live external evidence (theirs had none).
- **MiroFish future simulation** → outcome bands, the whole "future" layer they lack.
- **Adaptive intake follow-up questions** → richer DecisionContext than their single-doc upload.
