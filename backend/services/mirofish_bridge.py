"""
MiroFish Bridge
Simplifies the handoff from the Foresight 5-agent layer to MiroFish.
It takes the compiled agent findings and sends them to MiroFish's first step
(Ontology Generation). It returns the project_id so the UI can redirect the user.
"""
import requests
import logging

logger = logging.getLogger(__name__)

MIROFISH_BASE = "http://localhost:5001/api"
_REQUEST_TIMEOUT = 300

def _is_available() -> bool:
    try:
        r = requests.get(f"http://localhost:5001/health", timeout=5)
        return r.ok
    except Exception:
        return False

async def start_mirofish_project(seed_md: str, requirement: str) -> dict:
    """
    Starts a MiroFish project by uploading the seed document.
    Returns a dict containing the project_id.
    """
    if not _is_available():
        logger.warning("MiroFish backend is unavailable at localhost:5001")
        return {"project_id": None, "error": "MiroFish is unreachable"}

    try:
        logger.info("Initializing MiroFish project with seed document...")
        resp = requests.post(
            f"{MIROFISH_BASE}/graph/ontology/generate",
            data={
                "project_name": "Foresight Analysis",
                "simulation_requirement": requirement,
                "additional_context": "",
            },
            files={"files": ("seed.md", seed_md.encode("utf-8"), "text/markdown")},
            timeout=_REQUEST_TIMEOUT,
        )
        
        if resp.status_code != 200:
            logger.error(f"MiroFish returned {resp.status_code}: {resp.text}")
            resp.raise_for_status()
        
        result = resp.json()
        if not result.get("success"):
            logger.error(f"MiroFish ontology generation failed: {result}")
            return {"project_id": None, "error": result.get("error", "Unknown error")}
            
        project_id = result["data"]["project_id"]
        logger.info(f"MiroFish project initialized successfully: {project_id}")
        return {"project_id": project_id, "error": None}
        
    except Exception as e:
        logger.exception("Failed to initialize MiroFish project")
        return {"project_id": None, "error": str(e)}
