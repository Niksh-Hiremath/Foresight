"""
One-shot script: pull simulation for a given decision_id from MongoDB,
translate Chinese fields (bull, base, bear, swarm_report_md) to English,
and write them back.
"""
import sys
import os
from pathlib import Path

# ── Load .env from repo root ──────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / ".env"
for line in env_path.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    os.environ.setdefault(k.strip(), v.strip())

import pymongo
from openai import OpenAI

DECISION_ID = sys.argv[1] if len(sys.argv) > 1 else "6a2e2773386c3d20640b0d46"
MONGODB_URI  = os.environ["MONGODB_URI"]
LLM_API_KEY  = os.environ["LLM_API_KEY"]
LLM_BASE_URL = os.environ["LLM_BASE_URL"]
LLM_MODEL    = os.environ["LLM_MODEL_NAME"]

client = pymongo.MongoClient(MONGODB_URI)
db = client["foresight"]
col = db["simulations"]

doc = col.find_one({"decision_id": DECISION_ID})
if not doc:
    print(f"No simulation found for decision_id={DECISION_ID}")
    sys.exit(1)

print(f"Found simulation id={doc.get('id')} for decision_id={DECISION_ID}")

llm = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)

def translate(text: str, label: str) -> str:
    if not text or not text.strip():
        return text
    # Quick heuristic: if no Chinese characters, skip
    if not any('一' <= c <= '鿿' for c in text):
        print(f"  {label}: no Chinese detected, skipping")
        return text
    print(f"  {label}: translating {len(text)} chars ...")
    resp = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional translator. Translate the following text from Chinese to English. "
                    "Preserve all markdown formatting, headings, bullet points, bold/italic markers, and structure exactly. "
                    "Preserve the original meaning and business context faithfully. "
                    "Return ONLY the translated text — no preamble, no explanation."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.2,
        max_tokens=8192,
    )
    translated = resp.choices[0].message.content.strip()
    print(f"  {label}: done ({len(translated)} chars)")
    return translated

fields = ["bull", "base", "bear", "swarm_report_md"]
updates = {}
for f in fields:
    original = doc.get(f, "")
    translated = translate(original, f)
    if translated != original:
        updates[f] = translated

if not updates:
    print("Nothing to update — no Chinese content found.")
    sys.exit(0)

result = col.update_one(
    {"decision_id": DECISION_ID},
    {"$set": updates},
)
print(f"\nUpdated {result.modified_count} document(s). Fields updated: {list(updates.keys())}")
