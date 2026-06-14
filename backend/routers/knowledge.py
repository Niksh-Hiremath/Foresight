from fastapi import APIRouter, File, HTTPException, UploadFile

from db.repositories import (
    create_knowledge_doc,
    delete_knowledge_doc,
    get_knowledge_doc,
    list_knowledge_docs,
)
from models.schemas import KnowledgeDoc
from services.document_parser import parse_document

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.post("/upload")
async def upload_knowledge_doc(file: UploadFile = File(...)):
    data = await file.read()
    text = parse_document(file.filename or "", data)

    if not text.strip():
        raise HTTPException(422, "Could not extract text from the uploaded document")

    doc = KnowledgeDoc(
        filename=file.filename or "upload",
        extracted_text=text,
        char_count=len(text),
    )
    await create_knowledge_doc(doc)

    return {
        "id": doc.id,
        "filename": doc.filename,
        "char_count": doc.char_count,
        "created_at": doc.created_at.isoformat(),
    }


@router.get("/")
async def list_docs():
    docs = await list_knowledge_docs()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "char_count": d.char_count,
            "created_at": d.created_at.isoformat(),
        }
        for d in docs
    ]


@router.get("/{doc_id}/content")
async def get_doc_content(doc_id: str):
    doc = await get_knowledge_doc(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return {"id": doc.id, "filename": doc.filename, "extracted_text": doc.extracted_text}


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str):
    deleted = await delete_knowledge_doc(doc_id)
    if not deleted:
        raise HTTPException(404, "Document not found")
    return {"status": "deleted", "id": doc_id}
