"""
Quick probe of each MiroFish endpoint to confirm live status strings.
Run AFTER MiroFish is up: python spikes/mirofish_probe.py
"""
import json
import sys
import time
import requests

BASE = "http://localhost:5001/api"
SEED = "# Probe\n\nDecision: Launch AI product in India.\nRisk: High competition.\n"


def p(label, r):
    print(f"\n{'='*60}\n{label}")
    try:
        d = r.json()
        print(json.dumps(d, indent=2, ensure_ascii=False)[:800])
    except Exception:
        print(r.text[:400])


def poll(method, url, json_body=None, key="status", done={"completed"}, interval=3, limit=30):
    for _ in range(limit):
        r = requests.request(method, url, json=json_body, timeout=30)
        data = (r.json().get("data") or {})
        val = data.get(key, "")
        print(f"  polling {key}={val!r}")
        if str(val).lower() in done:
            return data
        if str(val).lower() in {"failed", "error"}:
            raise RuntimeError(f"Failed: {r.json()}")
        time.sleep(interval)
    raise TimeoutError(f"Gave up after {limit * interval}s")


# Health
r = requests.get("http://localhost:5001/health", timeout=5)
p("HEALTH", r)
if not r.ok:
    sys.exit("MiroFish not reachable")

# Step 1
r = requests.post(f"{BASE}/graph/ontology/generate",
                  data={"project_name": "probe-run", "simulation_requirement": "probe",
                        "additional_context": ""},
                  files={"files": ("seed.md", SEED.encode(), "text/markdown")}, timeout=60)
p("1 ontology/generate", r)
pid = r.json()["data"]["project_id"]

# Step 2
r = requests.post(f"{BASE}/graph/build", json={"project_id": pid}, timeout=30)
p("2 graph/build (task_id)", r)
tid = r.json()["data"]["task_id"]
print("  Polling graph/task status…")
poll("GET", f"{BASE}/graph/task/{tid}", key="status", done={"completed"})

# Step 3
r = requests.post(f"{BASE}/simulation/create",
                  json={"project_id": pid, "enable_twitter": True, "enable_reddit": True}, timeout=30)
p("3 simulation/create", r)
sid = r.json()["data"]["simulation_id"]

# Step 4
r = requests.post(f"{BASE}/simulation/prepare",
                  json={"simulation_id": sid, "use_llm_for_profiles": True, "parallel_profile_count": 3},
                  timeout=60)
p("4 simulation/prepare (task_id)", r)
ptid = (r.json().get("data") or {}).get("task_id")
print("  Polling prepare/status…")
poll("POST", f"{BASE}/simulation/prepare/status",
     json_body={"simulation_id": sid, "task_id": ptid}, key="status", done={"ready", "completed"})

# Step 5
r = requests.post(f"{BASE}/simulation/start",
                  json={"simulation_id": sid, "platform": "parallel",
                        "max_rounds": 3, "enable_graph_memory_update": False}, timeout=60)
p("5 simulation/start", r)
print("  Polling run-status (key=runner_status)…")
poll("GET", f"{BASE}/simulation/{sid}/run-status",
     key="runner_status", done={"completed", "stopped"}, interval=5, limit=60)

# Step 6
r = requests.post(f"{BASE}/report/generate", json={"simulation_id": sid}, timeout=60)
p("6 report/generate", r)
print("  Polling report/check (key=report_status)…")
poll("GET", f"{BASE}/report/check/{sid}", key="report_status", done={"completed"})

# Step 7
r = requests.get(f"{BASE}/report/by-simulation/{sid}", timeout=30)
p("7 report/by-simulation (FINAL)", r)
print("\n=== PROBE COMPLETE ===")
