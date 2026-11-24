# One application image: FastAPI (API + built SPA) served by a single uvicorn process.
# Build context: repo root. Targets: runtime (default, last stage), test (backend dev deps + tests, used by `make test-be`).
FROM node:24.15.0-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build \
    # Pre-compress text assets; the app serves the .gz when the client accepts gzip.
    && find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.svg' -o -name '*.html' \) -exec gzip -9 -k {} +

FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv==0.13.9
WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken
# Fetch the BPE file at build time so the runtime needs no network.
RUN python -c "import tiktoken; tiktoken.get_encoding('o200k_base')" && chmod -R a+rX /opt/tiktoken

COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
RUN useradd --uid 1000 app

FROM base AS test
RUN uv sync --frozen
COPY backend/tests ./tests
USER app
CMD ["pytest", "-q"]

FROM base AS runtime
COPY --from=frontend /app/dist ./static
USER app
EXPOSE 8000
# One worker on purpose: runs live in-process. Client IP / XFF is handled by the app (TRUSTED_PROXIES), not uvicorn.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
