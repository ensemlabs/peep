# ADR 0001: Tech stack

- **Status:** accepted
- **Date:** 2026-11-23

## Decision

| Area | Choice | Why |
|---|---|---|
| Backend | FastAPI, Python 3.13, uv, SQLAlchemy 2 (async) + asyncpg, Alembic | Async fits streaming. FastAPI has SSE built in (`fastapi.sse`), so no extra package is needed. Same Python and uv setup as coding-agent. |
| LLM client | `openai` SDK against any OpenAI-compatible `base_url`, configured per provider and model in `config/models.yaml` (thinking levels as request patches) | One code path for any OpenAI-compatible provider (OpenAI, Gemini, DeepSeek, OpenRouter, vLLM, Ollama). The SDK keeps `reasoning_content` (in `model_extra`) and raises on stream error chunks. |
| Database | Postgres 18 | Users, sessions, login throttle, conversations, and the part tree as JSONB. One database also holds the login counters, so no Redis. |
| File storage | MinIO through boto3 (generic S3) | Uploads and generated media outside the database. Only S3 calls are used, so the server can be swapped. |
| Auth | Email and password, argon2id, server-side sessions in an HttpOnly cookie, Origin check for CSRF | Standard, revocable at once (disable a user, change a password), no email or SSO needed. Login attempts are limited in Postgres. |
| Frontend | React 19, TypeScript, Vite, Tailwind v4 | Light single-page app, same family as coding-agent. |
| UI parts | Radix primitives, lucide icons, react-markdown + remark-gfm, shiki, yet-another-react-lightbox | Accessible dialogs and menus; markdown without raw HTML; syntax highlighting loaded per language; a lightbox with zoom, thumbnails, video and download. |
| State and data | TanStack Query (server state), zustand (running replies), a pure `applyEvent` reducer | The stream state is a plain reducer over SSE events and is unit-tested. |
| Streaming | SSE over `fetch` with `eventsource-parser` | Needs POST and cookies, which `EventSource` cannot do. Replies run in the API process and clients attach and detach. |
| Web server | nginx serving the SPA and proxying `/api/` | One origin: no CORS, cookies work. The only published port. Rewrites `X-Forwarded-For` for the throttle. |
| i18n | Typed dictionaries (`en.ts`, `vi.ts`) and a `useT()` hook | Two languages only. TypeScript forces both files to have the same keys. No library. |
| Secrets | Fernet (`cryptography`) with a key in `SECRETS_KEY` | Plugin header values are encrypted at rest and never returned. No external secret store to run. |
| Token counts | `tiktoken` (`o200k_base`, baked in the image at build) plus the provider's own usage when reported | Context numbers work offline; real numbers win when available. |
| Tests | pytest on real Postgres and MinIO, vitest, Playwright | No mocks for the database or storage. The browser suite runs against the whole stack. |
| Packaging | Docker Compose, a Makefile | One command starts the stack. An optional compose file joins a development provider's network. |

## Rejected alternatives

| Alternative | Why not |
|---|---|
| JWT sessions | Cannot be revoked at once when an admin disables a user. |
| Presigned MinIO URLs | Would need S3 reachable from the browser and lose the per-request owner check. Files are streamed through the API instead. |
| `sse-starlette` | FastAPI already has SSE. Kept only as a fallback. |
| Streamdown | Renders raw HTML by default and its API changes between minor versions. |
| A fake OIDC provider | SSO was dropped, so it is not needed. |
| Redis | Not needed with one API process. Login throttling lives in Postgres. |
| An i18n library | Two languages and a typed dictionary are enough. |

## Consequences

- Replies run inside the API process (`RunRegistry`), so the API runs one uvicorn worker. Two workers or replicas
  would need a shared event bus (Redis pub/sub). A restart marks running replies as `interrupted`.
- The MinIO project is archived and its upstream images cannot be pulled. Compose uses the Chainguard build
  (`cgr.dev/chainguard/minio`) pinned by digest, which only has a `latest` tag. Replacing it (a fork, RustFS) means
  changing the `minio` service and the `S3_*` variables, not the code.
- Some providers return generated images as base64 in the text stream, and must be extracted and stored before they are shown
  (some providers do this; see [development.md](../development.md)).
- The app has no agent logic. Tool and sub-agent cards are demonstrated by recorded streams (`replay:*`). A real
  agent is added as another provider (`backend/app/providers/`).
- Playwright's Chromium has no H.264/AAC, so media tests use WebM and MP3.
- No SSO, no email verification and no automatic password reset. An admin approves accounts and resets passwords.
