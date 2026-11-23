"""Точка входа FastAPI-приложения Gecko Next."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import models
from .config import PROJECT_ROOT
from .database import Base, engine
from .routers import (
    admin,
    ai,
    analytics,
    auth,
    export,
    media,
    projects,
    segments,
    tasks,
    terms,
    transcripts,
    verification,
)
from .seed import seed_demo_data

FRONTEND_DIR = PROJECT_ROOT / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_demo_data()
    yield


app = FastAPI(
    title="Gecko Next — сервис аудио/видеоразметки",
    version="1.0.0",
    description="Веб-платформа разметки, верификации и контроля качества речевых данных",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API-роутеры (все под префиксом /api)
API_PREFIX = "/api"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(projects.router, prefix=API_PREFIX)
app.include_router(tasks.router, prefix=API_PREFIX)
app.include_router(media.router, prefix=API_PREFIX)
app.include_router(segments.router, prefix=API_PREFIX)
app.include_router(transcripts.router, prefix=API_PREFIX)
app.include_router(terms.router, prefix=API_PREFIX)
app.include_router(verification.router, prefix=API_PREFIX)
app.include_router(export.router, prefix=API_PREFIX)
app.include_router(analytics.router, prefix=API_PREFIX)
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(ai.router, prefix=API_PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "gecko-next"}


# Статика фронтенда
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
