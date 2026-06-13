"""
End-to-end MiroFish pipeline driver.

Phases:
  1. Upload doc → generate ontology       POST /api/graph/ontology/generate
  2. Build knowledge graph               POST /api/graph/build  (poll task)
  3. Create + prepare simulation         POST /api/simulation/create
                                         POST /api/simulation/prepare  (poll task)
  4. Run simulation                      POST /api/simulation/start  (poll run-status)
  5. Generate report                     POST /api/report/generate  (poll task)
  6. Download report → save to file      GET  /api/report/<id>/download

Seed doc: ../infosys-ai-native-strategy-demo.txt
"""

import sys
import time
import pathlib
import requests

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "http://localhost:5001/api"
SEED_DOC = pathlib.Path(__file__).parent.parent / "infosys-ai-native-strategy-demo.txt"
OUTPUT_DIR = pathlib.Path(__file__).parent

SIMULATION_REQUIREMENT = (
    "Simulate how Infosys employees, executives, board members, and external "
    "stakeholders (analysts, clients, competitors, journalists) react to and "
    "discuss the company's proposed AI-native transformation strategy on social "
    "media. Explore sentiment, adoption concerns, competitive implications, and "
    "internal culture shifts as the memo leaks into the public discourse."
)

MAX_ROUNDS = 5  # keep small for a quick demo; raise for richer output
POLL_INTERVAL = 5  # seconds between status polls
TIMEOUT = 1800  # seconds to wait for any async phase


# ── Helpers ───────────────────────────────────────────────────────────────────


def api(method: str, path: str, req_timeout: int = 1800, **kwargs) -> dict:
    url = BASE_URL + path
    r = requests.request(method, url, timeout=req_timeout, **kwargs)
    try:
        body = r.json()
    except Exception:
        r.raise_for_status()
        raise
    if not body.get("success"):
        raise RuntimeError(f"{method} {path} failed: {body.get('error') or body}")
    return body["data"]


def poll(
    status_fn,
    done_statuses=("completed",),
    fail_statuses=("failed",),
    label="task",
    timeout=TIMEOUT,
):
    """
    Repeatedly call status_fn() until the returned dict's 'status' key is in
    done_statuses (success) or fail_statuses (abort).  Returns the final dict.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = status_fn()
        status = data.get("status", "")
        progress = data.get("progress", "")
        message = data.get("message", "")
        prog_str = f" {progress}%" if progress != "" else ""
        print(f"  [{label}]{prog_str} {status} — {message}")
        if status in done_statuses:
            return data
        if status in fail_statuses:
            raise RuntimeError(f"{label} failed: {data}")
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"{label} did not complete within {timeout}s")


# ── Phase 1: Ontology ─────────────────────────────────────────────────────────


def phase1_ontology() -> dict:
    print("\n── Phase 1: Upload document & generate ontology ──")
    if not SEED_DOC.exists():
        raise FileNotFoundError(f"Seed doc not found: {SEED_DOC}")
    with open(SEED_DOC, "rb") as fh:
        data = api(
            "POST",
            "/graph/ontology/generate",
            files={"files": (SEED_DOC.name, fh, "text/plain")},
            data={
                "simulation_requirement": SIMULATION_REQUIREMENT,
                "project_name": "Infosys AI-Native Strategy Sim",
            },
        )
    project_id = data["project_id"]
    entity_types = [e["name"] for e in data.get("ontology", {}).get("entity_types", [])]
    print(f"  project_id = {project_id}")
    print(f"  entity types: {entity_types}")
    return data


# ── Phase 2: Build graph ───────────────────────────────────────────────────────


def phase2_build_graph(project_id: str) -> dict:
    print("\n── Phase 2: Build knowledge graph ──")
    task = api("POST", "/graph/build", json={"project_id": project_id})
    task_id = task["task_id"]
    print(f"  task_id = {task_id}")
    result = poll(
        lambda: api("GET", f"/graph/task/{task_id}"),
        done_statuses=("completed",),
        label="graph-build",
    )
    graph_id = result.get("result", {}).get("graph_id") or result.get("graph_id")
    node_count = result.get("result", {}).get("node_count") or result.get("node_count")
    print(f"  graph_id = {graph_id}  nodes = {node_count}")
    return result


# ── Phase 3: Create + Prepare simulation ──────────────────────────────────────


def phase3_prepare_simulation(project_id: str, graph_id: str) -> dict:
    print("\n── Phase 3: Create & prepare simulation ──")

    # 3a: create
    sim = api(
        "POST",
        "/simulation/create",
        json={
            "project_id": project_id,
            "graph_id": graph_id,
            "enable_twitter": True,
            "enable_reddit": True,
        },
    )
    sim_id = sim["simulation_id"]
    print(f"  simulation_id = {sim_id}")

    # 3b: prepare (async)
    prep = api(
        "POST",
        "/simulation/prepare",
        json={
            "simulation_id": sim_id,
            "use_llm_for_profiles": True,
            "parallel_profile_count": 3,
        },
    )
    task_id = prep["task_id"]
    expected = prep.get("expected_entities_count", "?")
    print(f"  prepare task_id = {task_id}  expected agents = {expected}")

    poll(
        lambda: api("POST", "/simulation/prepare/status", json={"task_id": task_id}),
        done_statuses=("completed", "ready"),
        label="sim-prepare",
    )
    print(f"  simulation ready.")
    return {"simulation_id": sim_id}


# ── Phase 4: Run simulation ───────────────────────────────────────────────────


def phase4_run_simulation(sim_id: str) -> None:
    print(f"\n── Phase 4: Run simulation (max_rounds={MAX_ROUNDS}) ──")
    api(
        "POST",
        "/simulation/start",
        json={
            "simulation_id": sim_id,
            "platform": "parallel",
            "max_rounds": MAX_ROUNDS,
            "enable_graph_memory_update": False,
        },
    )

    def get_status():
        d = api("GET", f"/simulation/{sim_id}/run-status")
        # normalise: treat idle/completed as done
        if (
            d.get("runner_status") in ("completed", "idle")
            and d.get("current_round", 0) >= MAX_ROUNDS
        ):
            d["status"] = "completed"
        elif d.get("runner_status") == "completed":
            d["status"] = "completed"
        elif d.get("runner_status") == "failed":
            d["status"] = "failed"
        else:
            d["status"] = d.get("runner_status", "running")
        round_info = f"round {d.get('current_round', 0)}/{d.get('total_rounds', '?')}"
        actions = d.get("total_actions_count", 0)
        d["message"] = f"{round_info}  actions={actions}"
        d["progress"] = d.get("progress_percent", "")
        return d

    poll(
        get_status,
        done_statuses=("completed",),
        label="simulation",
        timeout=TIMEOUT * 2,
    )
    print("  simulation complete.")


# ── Phase 5: Generate report ──────────────────────────────────────────────────


def phase5_generate_report(sim_id: str) -> str:
    print("\n── Phase 5: Generate report ──")
    gen = api("POST", "/report/generate", json={"simulation_id": sim_id})
    report_id = gen["report_id"]
    task_id = gen["task_id"]
    print(f"  report_id = {report_id}  task_id = {task_id}")

    poll(
        lambda: api("POST", "/report/generate/status", json={"task_id": task_id}),
        done_statuses=("completed",),
        label="report-gen",
    )
    print("  report generated.")
    return report_id


# ── Phase 6: Download report ──────────────────────────────────────────────────


def phase6_download_report(report_id: str, sim_id: str) -> pathlib.Path:
    print("\n── Phase 6: Download report ──")

    # Try the download endpoint first (returns file bytes)
    url = f"{BASE_URL}/report/{report_id}/download"
    r = requests.get(url, timeout=120)
    if r.status_code == 200 and r.content:
        out_path = OUTPUT_DIR / f"mirofish_report_{report_id}.md"
        out_path.write_bytes(r.content)
        print(f"  saved → {out_path}")
        return out_path

    # Fallback: pull markdown_content from the report JSON
    print("  download endpoint unavailable, fetching JSON fallback …")
    report = api("GET", f"/report/{report_id}")
    md = report.get("markdown_content", "")
    if not md:
        # Stitch sections together
        sections_data = api("GET", f"/report/{report_id}/sections")
        sections = sections_data.get("sections", [])
        md = "\n\n".join(s.get("content", "") for s in sections)

    out_path = OUTPUT_DIR / f"mirofish_report_{sim_id}.md"
    out_path.write_text(md, encoding="utf-8")
    print(f"  saved → {out_path}")
    return out_path


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("MiroFish end-to-end pipeline")
    print(f"Seed doc : {SEED_DOC}")
    print(f"Endpoint : {BASE_URL}")
    print("=" * 60)

    # Health check
    try:
        requests.get(BASE_URL.replace("/api", ""), timeout=5)
    except Exception:
        print("\nERROR: Cannot reach MiroFish backend at", BASE_URL)
        print("Start the server first (cd mirofish && npm run backend)")
        sys.exit(1)

    try:
        # Phase 1
        ont = phase1_ontology()
        project_id = ont["project_id"]
        graph_id = ont.get("graph_id")  # may not be set yet

        # Phase 2
        graph_result = phase2_build_graph(project_id)
        if not graph_id:
            graph_id = graph_result.get("result", {}).get(
                "graph_id"
            ) or graph_result.get("graph_id")

        # Phase 3
        sim_data = phase3_prepare_simulation(project_id, graph_id)
        sim_id = sim_data["simulation_id"]

        # Phase 4
        phase4_run_simulation(sim_id)

        # Phase 5
        report_id = phase5_generate_report(sim_id)

        # Phase 6
        out_path = phase6_download_report(report_id, sim_id)

        print("\n" + "=" * 60)
        print("Pipeline complete!")
        print(f"  project_id    = {project_id}")
        print(f"  graph_id      = {graph_id}")
        print(f"  simulation_id = {sim_id}")
        print(f"  report_id     = {report_id}")
        print(f"  report saved  → {out_path}")
        print("=" * 60)

    except KeyboardInterrupt:
        print("\nAborted by user.")
        sys.exit(1)
    except Exception as exc:
        print(f"\nERROR: {exc}")
        raise


if __name__ == "__main__":
    main()
