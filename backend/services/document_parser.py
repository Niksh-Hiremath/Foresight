import io
import pdfplumber
from docx import Document


def parse_pdf(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n\n".join(p for p in pages if p.strip())


def parse_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def parse_document(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        return parse_pdf(data)
    if name.endswith(".docx") or name.endswith(".doc"):
        return parse_docx(data)
    return data.decode("utf-8", errors="replace")
