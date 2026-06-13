"""
Intake service: LLM-driven DecisionContext extraction + adaptive follow-up questions.
Uses OpenAI SDK with env-configured provider. Falls back to regex JSON extraction if
response_format isn't supported.
"""
from __future__ import annotations

import json
import re

from config import settings
from db.repositories import (
    get_decision,
    create_intake_context,
    get_intake_context,
    update_intake_context,
)
from models.schemas import IntakeContext
from services.llm_client import get_llm_client

_SYSTEM_PROMPT = """You are a rigorous business analyst reviewing a strategic decision document for an adversarial red-team exercise.

Extract the key components and identify the most critical gaps that need clarification before the red-team attack.

Respond with ONLY a valid JSON object matching this schema exactly:
{
  "core_decision": "<2-3 sentence summary of the business decision being made>",
  "market": "<target market, geography, customer segment, and market size claims>",
  "stated_beliefs": "<key assumptions and beliefs the decision-maker is relying on>",
  "financial_posture": "<financial situation, investment level, revenue targets, runway mentioned>",
  "gaps": "<critical unknowns, missing data, or logical weaknesses in the plan>",
  "follow_up_questions": [
    {
      "id": "q1",
      "type": "mcq",
      "question": "<targeted question addressing a gap>",
      "options": ["<option A>", "<option B>", "<option C>"]
    },
    {
      "id": "q2",
      "type": "text",
      "question": "<open-ended question targeting another gap>"
    }
  ]
}

Rules:
- follow_up_questions must have 3 to 5 items
- Use "mcq" type when the answer has discrete options; "text" for open-ended
- Questions must target the identified gaps, not general facts already in the document
- Be specific, adversarial, and focused on India-market dynamics if applicable
- Return ONLY the JSON object, no other text"""


def _extract_json(text: str) -> dict:
    """Try direct parse, then extract first {...} block with regex."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Find the outermost JSON object
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        return json.loads(match.group())
    raise ValueError("No valid JSON found in LLM response")


async def analyze_decision(decision_id: str) -> dict:
    """
    Call LLM to extract DecisionContext + follow-up questions from a stored decision.
    Persists an IntakeContext record and returns the analysis for the frontend.
    """
    decision = await get_decision(decision_id)
    if not decision:
        raise ValueError(f"Decision {decision_id} not found")

    # Truncate to ~12 000 chars to stay within context limits
    text = decision.raw_text[:12_000]

    client = get_llm_client()

    resp = await client.chat.completions.create(
        model=settings.llm_model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Analyze this decision document:\n\n{text}"},
        ],
        temperature=0.3,
    )

    raw_content = resp.choices[0].message.content or ""
    parsed = _extract_json(raw_content)

    questions = parsed.pop("follow_up_questions", [])

    intake = IntakeContext(
        decision_id=decision_id,
        core_decision=parsed.get("core_decision", ""),
        market=parsed.get("market", ""),
        stated_beliefs=parsed.get("stated_beliefs", ""),
        financial_posture=parsed.get("financial_posture", ""),
        gaps=parsed.get("gaps", ""),
        follow_up_questions=questions,
    )
    await create_intake_context(intake)

    return {
        "intake_id": intake.id,
        "decision_context": {
            "core_decision": intake.core_decision,
            "market": intake.market,
            "stated_beliefs": intake.stated_beliefs,
            "financial_posture": intake.financial_posture,
            "gaps": intake.gaps,
        },
        "follow_up_questions": questions,
    }


async def save_answers(decision_id: str, answers: dict) -> str:
    """Attach follow-up answers to the existing IntakeContext record."""
    intake = await get_intake_context(decision_id)
    if not intake:
        raise ValueError(f"No intake context found for decision {decision_id}")
    intake.follow_up_answers = answers
    await update_intake_context(intake)
    return intake.id
