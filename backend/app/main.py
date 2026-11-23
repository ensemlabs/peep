import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, get_engine
from app.errors import ApiError, register_error_handlers
from app.middleware import OriginCheckMiddleware
from app.routers import admin, auth, context, conversations, files, messages, models, plugins, skills
from app.services.model_registry import close_clients, get_registry
from app.services.runs import registry
from app.services.startup import check_secrets, mark_interrupted_messages, run_migrations, seed_admin
from app.services.storage import ensure_bucket

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_registry()  # fail fast on an invalid models config
    await run_migrations()
    await check_secrets()
    await ensure_bucket()
    await seed_admin()
    await mark_interrupted_messages()
    log.info("startup complete")
    yield
    await registry.shutdown()
    await close_clients()
    await get_engine().dispose()


app = FastAPI(title="ensemble-chat", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(OriginCheckMiddleware)
register_error_handlers(app)


@app.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:
        log.warning("health check failed: %s", type(e).__name__)
        raise ApiError(503, "unhealthy", "Database unavailable") from None
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(models.router)
app.include_router(files.router)
app.include_router(conversations.router)
app.include_router(messages.router)
app.include_router(context.router)
app.include_router(skills.router)
app.include_router(plugins.router)
