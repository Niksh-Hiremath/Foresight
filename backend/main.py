from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import health
from routers.intake import router as intake_router
from routers.agents import router as agents_router
from routers.simulate import router as simulate_router
from routers.synthesize import router as synthesize_router
from routers.analyze import router as analyze_router
from routers.reports import router as reports_router
from rag.store import load_from_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await load_from_db()
    yield


app = FastAPI(title="Foresight API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(intake_router)
app.include_router(agents_router)
app.include_router(simulate_router)
app.include_router(synthesize_router)
app.include_router(analyze_router)
app.include_router(reports_router)
