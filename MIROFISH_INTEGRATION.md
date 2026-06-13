# MiroFish Integration — Foresight

> Based on reading the locally cloned `mirofish/` (backend = **Flask**, frontend = **Vue**).
> MiroFish's simulation engine is **OASIS** (camel-ai/oasis); memory is **Zep Cloud**.

## What MiroFish actually exposes

- **Flask REST API on `http://localhost:5001`**, CORS open for `/api/*`. Health: `GET /health`.
- Three blueprints: **`/api/graph`** (project + GraphRAG), **`/api/simulation`** (create / prepare /
  start / inspect), **`/api/report`** (generate / fetch / chat).
- **LLM via the OpenAI SDK** — `app/utils/llm_client.py` is `OpenAI(api_key=LLM_API_KEY,
  base_url=LLM_BASE_URL)`, model `LLM_MODEL_NAME`, and it uses `response_format={"type":"json_object"}`.
  → Point it at Gemini's OpenAI-compatible endpoint (same values your orchestrator uses). Optional
  `LLM_BOOST_*` lets you route to a second/cheaper model.
- **Required env (startup validates and exits if missing):** `LLM_API_KEY` **and** `ZEP_API_KEY`.
- Response envelope: `{ "success": true, "data": {...} }` or `{ "success": false, "error": "..." }`.
- Vue frontend (`:3000`) talks to `VITE_API_BASE_URL || http://localhost:5001`.

## There is NO one-shot endpoint — it's a 7-step async pipeline

Each long step returns a `task_id` immediately and is **polled** to completion.

```
BASE = http://localhost:5001/api

1) CREATE PROJECT + INGEST SEED        (multipart/form-data)
   POST {BASE}/graph/ontology/generate
     form:  project_name, simulation_requirement, additional_context
     files: files=@seed.md            # PDF / MD / TXT — your DecisionContext + key findings
   -> data.project_id

2) BUILD GRAPHRAG KNOWLEDGE GRAPH      (async)
   POST {BASE}/graph/build  {project_id, chunk_size?, chunk_overlap?}
   -> data.task_id
   poll GET {BASE}/graph/task/{task_id}  until done   -> graph_id

3) CREATE SIMULATION
   POST {BASE}/simulation/create  {project_id, enable_twitter:true, enable_reddit:true}
   -> data.simulation_id (+ graph_id)

4) PREPARE  (generate agent personas + sim config)   (async)
   POST {BASE}/simulation/prepare
        {simulation_id, use_llm_for_profiles:true, parallel_profile_count:5, entity_types?}
   -> data.task_id
   poll POST {BASE}/simulation/prepare/status  {simulation_id}  until ready

5) START SIMULATION  (the slow/expensive step)
   POST {BASE}/simulation/start
        {simulation_id, platform:"parallel", max_rounds:10, enable_graph_memory_update:false}
   poll GET {BASE}/simulation/{simulation_id}/run-status  until finished

6) GENERATE REPORT   (async)
   POST {BASE}/report/generate  {simulation_id}
   -> data.report_id (+ task_id)
   poll GET {BASE}/report/check/{simulation_id}   (or POST {BASE}/report/generate/status)

7) FETCH REPORT  (this is what you ingest)
   GET {BASE}/report/by-simulation/{simulation_id}   -> data (report + verdict-style content)
   GET {BASE}/report/{report_id}/sections            -> section-by-section
```

**Extra endpoints for visualization / interactivity** (optional but great for the demo):
`GET /simulation/{id}/posts | /comments | /timeline | /agent-stats` (the swarm "debating" feed),
`POST /simulation/interview` (talk to one simulated agent), `POST /report/chat` (chat with the
ReportAgent), and SSE log streams `GET /report/{id}/agent-log/stream`.

## The bridge (drop into the orchestrator's Simulation service)

A thin `requests` client that chains the 7 steps. Reuses the SAME Gemini env as your agents.

```python
import time, requests
BASE = "http://localhost:5001/api"

def _poll(method, url, *, json=None, key, done_states={"completed","success","ready","finished","done"},
          interval=3, timeout=1800):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.request(method, url, json=json, timeout=30).json()
        status = (r.get("data") or {}).get(key) or r.get(key)
        if str(status).lower() in done_states:
            return r["data"]
        if str(status).lower() in {"failed","error"}:
            raise RuntimeError(f"MiroFish step failed: {r}")
        time.sleep(interval)
    raise TimeoutError(url)

def run_simulation(seed_md: str, requirement: str, *, max_rounds=10) -> dict:
    # 1. project + seed
    p = requests.post(f"{BASE}/graph/ontology/generate",
                      data={"project_name": "Foresight Run",
                            "simulation_requirement": requirement,
                            "additional_context": ""},
                      files={"files": ("seed.md", seed_md, "text/markdown")}).json()["data"]
    pid = p["project_id"]

    # 2. build graph
    t = requests.post(f"{BASE}/graph/build", json={"project_id": pid}).json()["data"]
    _poll("GET", f"{BASE}/graph/task/{t['task_id']}", key="status")

    # 3. create sim
    sim = requests.post(f"{BASE}/simulation/create",
                        json={"project_id": pid, "enable_twitter": True,
                              "enable_reddit": True}).json()["data"]
    sid = sim["simulation_id"]

    # 4. prepare
    requests.post(f"{BASE}/simulation/prepare",
                  json={"simulation_id": sid, "use_llm_for_profiles": True,
                        "parallel_profile_count": 5})
    _poll("POST", f"{BASE}/simulation/prepare/status", json={"simulation_id": sid}, key="status")

    # 5. start + run
    requests.post(f"{BASE}/simulation/start",
                  json={"simulation_id": sid, "platform": "parallel", "max_rounds": max_rounds})
    _poll("GET", f"{BASE}/simulation/{sid}/run-status", key="status")

    # 6. report
    requests.post(f"{BASE}/report/generate", json={"simulation_id": sid})
    _poll("GET", f"{BASE}/report/check/{sid}", key="status")

    # 7. fetch
    return requests.get(f"{BASE}/report/by-simulation/{sid}").json()["data"]
```

> Verify the exact `status` field names / done-states per endpoint against the live responses
> (probe each once in a terminal first) — the poll helper is written defensively but MiroFish's
> state strings should be confirmed. The seed you POST is your `DecisionContext` + top findings as
> markdown; `simulation_requirement` is the natural-language ask, e.g. *"Predict market and
> stakeholder reaction over the next 12 months if <company> executes <decision> in India."*

## Integration modes (pick by risk)

| Mode | How | Effort | Use when |
|---|---|---|---|
| **B. Sidecar + bridge + embed (default)** | Run MiroFish as-is; the bridge above drives the 7 steps; show results by iframing MiroFish's own `:3000` world **or** rendering the fetched report JSON in your dashboard | Low–Med | 2-person team, want it "real" |
| **A. Full programmatic** | Same bridge, but render everything in your dashboard; never run their Vue | Med–High | If you have spare time for polish |
| **C. Output-only fallback** | Pre-run once (UI or `scripts/run_parallel_simulation.py --config ...`), export the report JSON, hardcode it | Lowest | If the live run is flaky on stage |

**Recommendation:** build Mode B's bridge, but **pre-run the demo scenario and cache the report
JSON** — the live demo reads the cache. Keep a recording as the ultimate fallback (Mode C).

## Controlling cost & time (this is the real constraint)

- `max_rounds` on `/simulation/start` (and `OASIS_DEFAULT_MAX_ROUNDS`, default 10) — keep it ~5–10.
- **Agent population derives from entities** the GraphRAG extracts → keep the seed **short and
  focused** (one decision, a handful of stakeholders) to keep the agent count small. Optionally pass
  `entity_types` to `/prepare` to narrow it.
- `parallel_profile_count` (persona-gen concurrency) — mind Gemini rate limits.
- Report agent: `REPORT_AGENT_MAX_TOOL_CALLS` (5), `REPORT_AGENT_MAX_REFLECTION_ROUNDS` (2),
  `REPORT_AGENT_TEMPERATURE` (0.5).
- Use **gemini-flash** as `LLM_MODEL_NAME`; consider `LLM_BOOST_*` for the heaviest calls.

## Setup checklist

- [ ] Node 18+, Python 3.11–3.12, `uv` installed.
- [ ] `mirofish/.env`: `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL_NAME` = your Gemini OpenAI-compat
      values; `ZEP_API_KEY` from app.getzep.com (free tier).
- [ ] `npm run setup:all` → `npm run dev` (Flask :5001 + Vue :3000). Your app stays on 5173/8000.
- [ ] Smoke test: `GET http://localhost:5001/health` → `{status: ok}`.
- [ ] One tiny end-to-end run (small seed, max_rounds≈5); record runtime + token cost; set demo caps.
- [ ] Pre-run the Indian demo scenario; cache `report/by-simulation/{id}` JSON for the live demo.
