# Architecture

## Components

```
browser ──► web (nginx :80, host 127.0.0.1:${WEB_PORT:-8090})
              ├─ /            static SPA (React build)
              └─ /api/        proxy ──► api (FastAPI, uvicorn, 1 worker, :8000, not published)
                                          ├─► postgres 18  (state)
                                          ├─► minio        (S3: files)
                                          └─► LLM          (OpenAI-compatible /v1)
```

| Service | Image / build | Role |
| :--- | :--- | :--- |
| `web` | `frontend/Dockerfile`: Node build, then `nginx:1.29.8-alpine` | Serves the SPA, proxies `/api/` to the API, sets security headers. Only published port. |
| `api` | `backend/Dockerfile` (`python:3.13-slim`, uv), target `runtime`, user `app` (uid 1000) | REST and SSE API, runs the replies in process. |
| `postgres` | `postgres:18.6-alpine` | Users, sessions, login throttle, conversations, messages (with the part tree as JSONB), file metadata. Volume at `/var/lib/postgresql`. |
| `minio` | `cgr.dev/chainguard/minio`, pinned by digest | S3 storage for uploaded and generated files. Healthcheck `mc ready local`. |
| `api-test` | `backend/Dockerfile`, target `test`, profile `test` | `pytest` against real Postgres and MinIO (database `ensemble_chat_test`, bucket `ensemble-chat-test`). |
| LLM | external, for example llm-proxy | Chat completions. Reached with `LLM_BASE_URL`. |

All services share the compose network `backend`. With `GEMINI=1` the API also joins the external network
`llm-proxy_default` (`docker-compose.gemini.yml`) and `LLM_BASE_URL` becomes `http://llm-proxy-ts:8000/v1`.

### nginx

`frontend/nginx/default.conf.template` (the image substitutes `MAX_UPLOAD_MB`, set from `NGINX_MAX_BODY_MB`):

- `/api/` goes to `api:8000` with `proxy_buffering off` and `proxy_request_buffering off` (SSE and large uploads
  stream through), timeouts of 3600 s, and `Range`, `If-Range` and `If-None-Match` forwarded.
- `X-Forwarded-For` is set to `$remote_addr`, replacing what the client sent. `X-Forwarded-Proto` is set too.
- `client_max_body_size` is `NGINX_MAX_BODY_MB` (default 220), above the app's `MAX_UPLOAD_MB` (200).
- Headers on the app: CSP (`default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'
  'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri
  'self'; form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- `/assets/` is cached for a year (immutable, hashed names). `index.html` and the SPA fallback are `no-cache`.

Everything is one origin, so no CORS is needed and the session cookie works as is.

### Backend layout

| Path | Role |
| :--- | :--- |
| `app/main.py` | App, lifespan (startup tasks), Origin middleware, `/api/health`, routers. Docs endpoints are off. |
| `app/config.py` | Settings from environment (`pydantic-settings`). |
| `app/models.py`, `alembic/` | Tables: `users`, `sessions`, `auth_throttle`, `conversations`, `messages`, `files`. Migration `0001_initial`. |
| `app/security.py` | argon2id, email and password rules, session token, client IP. |
| `app/deps.py` | Dependencies `current_session`, `current_user`, `active_user`, `admin_user`. |
| `app/middleware.py` | Origin/Referer check. |
| `app/errors.py` | `ApiError` and the JSON error handlers. |
| `app/routers/` | `auth`, `admin`, `models`, `conversations`, `messages`, `files`. |
| `app/services/runs.py` | `RunState`, `RunRegistry`, SSE helpers. |
| `app/services/storage.py` | boto3 S3 client, bucket creation, range reads, deletes. |
| `app/services/media.py` | Upload ingestion, kind detection, thumbnails, `FileMeta`. |
| `app/services/history.py` | Builds the OpenAI message list for a run. |
| `app/services/llm_models.py` | Model catalogue (upstream list, allowlist, replay). |
| `app/services/sessions.py`, `throttle.py`, `startup.py` | Sessions, login throttling, startup tasks. |
| `app/providers/` | `base.py` (`RunContext`, `Provider`), `openai_provider.py`, `replay_provider.py`, `datauri.py`. |

Providers are the extension point. A provider is an object with `async def run(ctx: RunContext)` that emits parts.
The code chooses `ReplayProvider` for model ids that start with `replay:` and `OpenAIProvider` for the rest.

### Frontend layout

React 19, TypeScript, Vite, Tailwind. Server state is in TanStack Query. The state of running replies (and the
selected model, thinking level) is in zustand; model, thinking level and language are kept in `localStorage`
(`ec_model`, `ec_reasoning`, `ec_lang`). Routes: `/login`, `/register`, `/`, `/c/:id`, `/settings`, `/admin/users`.
The event reducer `applyEvent` (`features/chat/applyEvent.ts`) turns SSE events into the part tree. Strings live in
`src/i18n/en.ts` and `vi.ts`; the Vietnamese file must have exactly the same keys. The API's error `code` is
translated in the browser.

## Sending a message

1. `POST /api/conversations/{id}/messages` checks the conversation owner, the message and the model.
2. `RunRegistry.reserve(conversation_id)` claims the conversation synchronously. A second send gets 409
   `run_in_progress`. The same check blocks deleting the conversation during a reply.
3. The attachments are checked (yours, not yet attached, no other conversation), the user message and an empty
   assistant message (`status: streaming`) are inserted, the title is set, and the transaction is committed.
4. A `RunState` is created, the request subscribes to it, and `registry.start()` runs the provider in an
   `asyncio` task. The first SSE event is `message`.
5. The provider calls `ctx.emit_part`, `emit_delta`, `emit_update`. `RunState` updates its in-memory part tree
   (an index by part id, including nested parts) and puts one SSE event on the queue of every subscriber.
6. When the provider returns, raises or is cancelled, the run closes parts still `running`, writes the final
   status and `updated_at` of the conversation, sends `done`, and releases the conversation.

The SSE connection is only a subscriber. If the client disconnects, its queue is dropped and the run goes on. The
queues are unbounded, so a slow client does not slow the run. A `: ping` comment goes out after 15 seconds
without events.

### OpenAI provider

`OpenAIProvider` builds the history (`services/history.py`) and calls
`AsyncOpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, timeout=LLM_TIMEOUT_SECONDS, max_retries=0).chat.completions.create(stream=True)`.
With thinking on it adds `reasoning_effort="high"`.

- History: text of earlier user and assistant messages (the assistant's root `text` parts; thinking, tools and
  images are not replayed), then the last user message. Its images (at most 16, each at most 20 MB) become
  `image_url` data URIs. Other attachments become a line `[Attached file: name (mime, size)]`. Images of earlier
  turns are not re-sent.
- Stream mapping: `delta.reasoning_content` goes to a `thinking` part (closed with `done` when the first content
  arrives or the stream ends). `delta.content` goes to a `text` part through the data-URI extractor. Chunks without
  choices are skipped.
- Errors (`openai.OpenAIError`) become a `ProviderError`: timeout "The model did not respond in time", connection
  failure "Could not reach the model service", HTTP errors "Model service error <status>: <message>". The message is
  stored in `messages.error` and sent in `done`.

### Data-URI image extraction

Some endpoints (llm-proxy) return generated images inline in the text as
`![alt](data:image/png;base64,...)`, in one delta that can be several MB. `StreamingImageExtractor`
(`providers/datauri.py`) splits the text stream into plain text and decoded images, so the base64 never reaches the
database or the browser.

- It scans for `![`, and holds back only what could still become a `data:image/<type>;base64,` image (a partial
  `![alt](data:ima` at the end of a chunk is kept until the next chunk decides). Anything else is released as text
  at once.
- Inside the payload it collects base64 characters until the closing `)`, then decodes with strict validation.
  Only one image is held in memory at a time.
- Bad base64, a payload over 150M characters, or a stream that ends inside a payload becomes the text
  `[invalid image]`. A non-matching `![` is plain text. An alt text over 200 characters is not an image.
- Each decoded image is stored with `ctx.store_file(data, mime, "image-N.<ext>")` (source `generated`, so it gets a
  thumbnail like an upload) and emitted as a `files` part. Text after the image goes to a new `text` part.

### Persistence cadence

Parts are written to `messages.parts` (JSONB) together with `messages.content` (the root text) by `RunState.flush()`:

- at once when a part is created with a `status` (thinking, tool, sub-agent) or is a `files` part, and on every
  `update` that carries a `status`;
- at most once per second (`FLUSH_INTERVAL = 1.0`) for pure text and output deltas, by a background task that
  flushes when something changed;
- on completion, together with the final `status`/`error` of the message.

A crash loses at most about one second of streamed text. The in-memory state is the source for live subscribers.

### Reconnect

`GET /api/messages/{id}/events` looks the message up in the registry. If the run is live, it subscribes and builds
the `snapshot` in the same synchronous step, so no event falls between them, then streams the rest. If the run is
not live (finished, or lost in a restart), it sends `snapshot` from the database and `done`. The web app calls this
when it opens a conversation whose last assistant message is `streaming`. After a dropped stream without `done` it
waits 1.5 seconds and reloads the conversation.

### Stop

`POST /api/messages/{id}/stop` cancels the asyncio task. The run ends with `status: "stopped"`; running parts are
closed (`thinking` as `done`, the rest as `error`). The web app sends it from the Stop button.

## Files

- Upload: `POST /api/files` streams the multipart body into a spooled temporary file (memory up to 1 MiB, then
  disk), counting bytes and hashing as they arrive, and refuses with 413 as soon as the limit is passed. The kind is
  detected (images by Pillow, video and audio by MIME and extension, the rest as `file`), the file is uploaded with
  boto3's managed (multipart) transfer, and for images a WebP thumbnail (at most 768 px) is made.
- Layout in the bucket: `u/<user_id>/<file_id>/<sanitised name>` and `thumbs/<file_id>.webp`. Metadata (kind, MIME,
  size, size in pixels, SHA-256, keys, `source` `upload`/`generated`, owner, conversation, message) is in the
  `files` table. Deleting a conversation deletes its files; deleting a user deletes the prefix `u/<user_id>/` and the
  thumbnails.
- Serving: the API reads from S3 with a `Range` when the client asked for one, and streams the body in 64 KiB chunks
  from a thread pool, so the event loop is not blocked. There is no presigned URL: every read goes through the API,
  which checks the owner. One range is supported (`a-b`, `a-`, `-n`), as 206. See [api.md](api.md#get-apifilesidcontent).
- Safety: only verified raster images, video and audio are `inline`. The rest, and anything that a browser could
  run (SVG, HTML, XML, JS), download as `attachment` with `nosniff` and `Content-Security-Policy: default-src 'none';
  sandbox`.
- Attachments to the model are read back from S3 and sent as data URIs only for the last user message.

## Auth flow

1. Register: per-IP counter (10 per hour), validation, argon2id hash, user `pending`, session, cookie. Login:
   per-IP counter (30 per 15 minutes), per `email|ip` lock check, verification (a dummy hash for unknown emails), then
   the same lock bookkeeping, `check_needs_rehash`, session, cookie.
2. Each request: `current_session` hashes the cookie token (SHA-256) and loads the session and user. It deletes expired
   sessions, refuses disabled users, and re-sends the cookie when the idle timer was extended (at most hourly).
3. Dependencies: `current_user` (any status but disabled), `active_user` (403 `account_pending` otherwise),
   `admin_user`.
4. CSRF: the Origin middleware runs before routing for non-GET `/api` requests.
5. Throttle counters are single atomic SQL statements on the `auth_throttle` table, so they hold under concurrency and
   after restarts.
6. Revocation: logout deletes one session. A password change keeps only the current session. An admin disabling,
   resetting the password of, or deleting a user removes all of that user's sessions.
7. The pending state is enforced in the API (403). The UI also shows a banner and an overlay that blocks clicks, and
   polls `/api/auth/me` every 30 seconds.

Details and numbers: [api.md](api.md#auth) and the Security section of the [README](../README.md#security-notes).

## Startup tasks

The API lifespan (`app/main.py`) runs these in order, and does not serve requests until they finish:

1. `alembic upgrade head` (in a worker thread, because Alembic's async environment needs its own event loop).
2. `ensure_bucket()`: create the S3 bucket if missing, retrying with backoff for up to `S3_STARTUP_TIMEOUT_SECONDS`
   (MinIO may still be starting).
3. `seed_admin()`: if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, create an active admin (display name "Admin"), or
   promote an existing user with that email to active admin without touching its password.
4. `mark_interrupted_messages()`: every message still `streaming` becomes `error` with the error `interrupted`
   (their runs died with the previous process).

On shutdown, running tasks are cancelled (waiting up to 10 seconds) and the database engine is closed.

The compose healthcheck of `api` calls `GET /api/health`, which runs `SELECT 1`. `web` starts after `api` is healthy.

## Design limits

- One uvicorn worker (`--workers 1`, `--no-proxy-headers`), because runs, subscribers and the busy set are in process
  memory. See Limitations in the [README](../README.md#limitations).
- The API container is not published; only nginx is, on `127.0.0.1`.
- Storage code is plain S3 (boto3, path-style addressing, region `us-east-1`), so the MinIO image can be replaced.
