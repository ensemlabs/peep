# Build context: backend/. Targets: runtime (default, last stage), test (adds dev deps + tests).
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN pip install --no-cache-dir uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH"

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
RUN useradd --uid 1000 app

FROM base AS test
RUN uv sync --frozen
COPY tests ./tests
USER app
CMD ["pytest", "-q"]

FROM base AS runtime
USER app
EXPOSE 8000
# One worker on purpose: runs live in-process. Client IP / XFF is handled by the app, not uvicorn.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
