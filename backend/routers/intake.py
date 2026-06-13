from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from db.repositories import create_decision
from models.schemas import Decision
from rag import chunk_and_tag
from services.document_parser import parse_document
from services.intake_service import analyze_decision, save_answers

router = APIRouter(prefix="/intake", tags=["intake"])

_ALLOWED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
}


@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    data = await file.read()
    text = parse_document(file.filename or "", data)

    if not text.strip():
        raise HTTPException(422, "Could not extract text from the uploaded document")

    decision = Decision(filename=file.filename or "upload", raw_text=text)
    await create_decision(decision)
    await chunk_and_tag(text, layer="decision", source=file.filename or "upload", decision_id=decision.id)

    return {"decision_id": decision.id, "filename": decision.filename, "char_count": len(text)}


class AnalyzeRequest(BaseModel):
    decision_id: str


@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    try:
        return await analyze_decision(req.decision_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"LLM analysis failed: {exc}")


class AnswersRequest(BaseModel):
    decision_id: str
    answers: dict[str, Any]


@router.post("/answers")
async def submit_answers(req: AnswersRequest):
    try:
        intake_id = await save_answers(req.decision_id, req.answers)
        return {"status": "ok", "intake_id": intake_id}
    except ValueError as exc:
        raise HTTPException(404, str(exc))
