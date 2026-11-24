# Architecture

How Peep is built: components, request flow, storage and startup.

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
| `postgres` | `postgres:18.6-alpine` | Users, sessions, login throttle, conversations, messages (with the part tree as JSONB), file metadata, token usage ledger, admin audit log. Volume at `/var/lib/postgresql`. |
| `minio` | `cgr.dev/chainguard/minio`, pinned by digest | S3 storage for uploaded and generated files. Healthcheck `mc ready local`. |
| `api-test` | `backend/Dockerfile`, target `test`, profile `test` | `pytest` against real Postgres and MinIO (database `ensemble_chat_test`, bucket `ensemble-chat-test`). |
| LLM provider | external, any OpenAI-compatible API | Chat completions. Endpoints and keys come from `config/models.yaml` (or the `LLM_*` fallback). |

All services share the compose network `backend`. For local development the API can also join the network of a
dev provider, see [development.md](development.md).

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
| `app/models.py`, `alembic/` | Tables: `users`, `sessions`, `auth_throttle`, `conversations`, `messages`, `files`, `token_usage`, `admin_audit`. Migrations `0001_initial`, `0002_models_usage_skills_plugins` and `0003_account_management` (see [Database](#database)). |
| `app/security.py` | argon2id, email and password rules, session token, client IP. |
| `app/deps.py` | Dependencies `current_session`, `current_user`, `active_user`, `admin_user`. |
| `app/middleware.py` | Origin/Referer check. |
| `app/errors.py` | `ApiError` and the JSON error handlers. |
| `app/routers/` | `auth`, `admin`, `models`, `context`, `conversations`, `messages`, `files`, `skills`, `plugins`. |
| `app/services/runs.py` | `RunState`, `RunRegistry`, SSE helpers. |
| `app/services/storage.py` | boto3 S3 client, bucket creation, range reads, deletes. |
| `app/services/media.py` | Upload ingestion, kind detection, thumbnails, `FileMeta`. |
| `app/services/history.py` | Builds the OpenAI message list for a run. |
| `app/services/model_registry.py` | Model registry: loads `config/models.yaml` (or builds one from the `LLM_*` variables), resolves providers, models and thinking levels, builds the OpenAI clients. |
| `app/services/quota.py` | Token windows (UTC), usage sums, `record_usage`, `log_admin` (audit rows). |
| `app/services/usage.py`, `tokens.py` | Usage normalisation, tiktoken estimates. |
| `app/services/skills.py`, `secrets.py` | Skill package parsing and validation, Fernet encryption of plugin headers. |
| `app/services/sessions.py`, `throttle.py`, `startup.py` | Sessions, login throttling, startup tasks. |
| `app/providers/` | `base.py` (`RunContext`, `Provider`), `openai_provider.py`, `replay_provider.py`, `datauri.py`, `tagsplit.py` (think-tag splitter). |

Providers are the extension point. A provider is an object with `async def run(ctx: RunContext)` that emits parts.
The code chooses `ReplayProvider` for model ids that start with `replay:` and `OpenAIProvider` for the rest.

### Frontend layout

React 19, TypeScript, Vite, Tailwind. Server state is in TanStack Query. The state of running replies (and the
selected model, thinking level) is in zustand; model, thinking level and language are kept in `localStorage`
(`ec_model`, `ec_levels` (level per model), `ec_lang`, `ec_sidebar_collapsed`). Routes: `/login`, `/register`, `/`, `/c/:id`, `/settings`, `/settings/integrations`, `/admin/users`.
The event reducer `applyEvent` (`features/chat/applyEvent.ts`) turns SSE events into the part tree. Strings live in
`src/i18n/en.ts` and `vi.ts`; the Vietnamese file must have exactly the same keys. The API's error `code` is
translated in the browser.

## Sending a message

1. `POST /api/conversations/{id}/messages` checks the conversation owner, the message and the model, then the user's
   token limit (429 `quota_exceeded`).
2. `RunRegistry.reserve(conversation_id)` claims the conversation synchronously. A second send gets 409
   `run_in_progress`. The same check blocks deleting the conversation during a reply.
3. The attachments are checked (yours, not yet attached, no other conversation), the user message and an empty
   assistant message (`status: streaming`) are inserted, the title is set, and the transaction is committed.
4. A `RunState` is created, the request subscribes to it, and `registry.start()` runs the provider in an
   `asyncio` task. The first SSE event is `message`.
5. The provider calls `ctx.emit_part`, `emit_delta`, `emit_update`. `RunState` updates its in-memory part tree
   (an index by part id, including nested parts) and puts one SSE event on the queue of every subscriber.
6. When the provider returns, raises or is cancelled, the run closes parts still `running`, writes the final
   status and `updated_at` of the conversation (and the `token_usage` row, see
   [Token limits](#token-limits-and-the-audit-log)), sends `done`, and releases the conversation.

The SSE connection is only a subscriber. If the client disconnects, its queue is dropped and the run goes on. The
queues are unbounded, so a slow client does not slow the run. A `: ping` comment goes out after 15 seconds
without events.

### Model registry

`services/model_registry.py` loads `config/models.yaml` once at startup (`MODELS_CONFIG`). The file is validated with
strict models (unknown keys, duplicate ids, a missing `active` model or an unset `${VAR}` stop the API at startup).
If the file does not exist, a registry is built from the `LLM_*` variables (one provider, `usage: estimate`, levels
Off and High); if those are not set either, startup fails with an explanatory error.

- A provider has `base_url`, `api_key_env` (the key is read from that environment variable) and `usage`
  (`provider` or `estimate`). A model has `id`, `upstream` (name sent to the provider), `label` (string or per
  language), `vision`, `context_window`, `image_tokens`, `token_ratio`, and `thinking`.
- `selectable()` decides which models users may use: the `active` model, plus every model and the `replay:*`
  fixtures when `dev.model_switcher` is on (replay needs `REPLAY_ENABLED`). `choose_model()` in the conversations
  router applies it: outside switcher mode the `model` sent by a client is ignored.
- One `AsyncOpenAI` client is kept per `(base_url, key, timeout)` and closed on shutdown.

### Thinking levels and the request patch

`thinking.levels` is a list of `{id, label, patch}`. `choose_level()` picks the level for a request: none for a model
without `thinking`, `thinking.default` when the client sent nothing, else the requested id (unknown ids give 422
`invalid_reasoning_level`).

`OpenAIProvider.build_request()` starts from `{model: upstream, messages, stream: true, stream_options:
{include_usage: true}}` and calls `build_request_params()`:

1. `patch.extra_body` is taken out and kept as the start of `extra_body`.
2. The rest of the patch is deep-merged into the request.
3. Each key of the merged request that the OpenAI SDK accepts as an argument (`reasoning_effort`, `temperature`,
   `top_p`, `max_tokens`, `seed`, `stop`, ...) or that was already in the base is passed as a keyword argument. Every
   other key (for example `thinking`, `google`, `reasoning`, `chat_template_kwargs`) goes into `extra_body`, which the
   SDK merges into the JSON body.

### OpenAI provider

`OpenAIProvider` builds the history (`services/history.py`) and calls
`client.chat.completions.create(**kwargs)` with the request above and `max_retries=0`, timeout
`LLM_TIMEOUT_SECONDS`.

- History: `load_turns()` is the single source for both the run and `GET /api/context`. It contains the text of
  earlier user and assistant messages (the assistant's root `text` parts; thinking, tools and images are not
  replayed), then the last user message. Its images (at most 16, each at most 20 MB) become `image_url` data URIs.
  Other attachments become a line `[Attached file: name (mime, size)]`. Images of earlier turns are not re-sent.
- Stream mapping: the first non-empty delta field among the model's `read_from.delta_fields` (default
  `reasoning_content`, `reasoning`) goes to a `thinking` part (closed with `done` when the first answer text arrives
  or the stream ends). `delta.content` goes to a `text` part through the data-URI extractor. Chunks without choices are
  skipped, except that a chunk with `usage` is remembered.
- Tag splitter: with `read_from.parse_tags: true`, `delta.content` first goes through `ThinkTagSplitter`
  (`providers/tagsplit.py`). It is a streaming state machine that moves text between `<tag>` and `</tag>` (for the
  configured `tag_names`, default `think`, `thought`) into the thinking part, holds back a possibly incomplete tag at
  the end of a chunk, and drops whitespace after a closing tag. Everything else is answer text.
- Errors (`openai.OpenAIError`) become a `ProviderError`: timeout "The model did not respond in time", connection
  failure "Could not reach the model service", HTTP errors "Model service error <status>: <message>". The message is
  stored in `messages.error` and sent in `done`.

### Usage and token estimates

After a successful stream the provider emits one `usage` event (`ctx.emit_usage`), which `RunState` stores and writes
to `messages.usage` (JSONB) when the run finishes.

- With `usage: provider` and a usage chunk from the API, `normalize_usage()` maps it to the `Usage` shape (input,
  output, reasoning from `completion_tokens_details`, cache read from `prompt_tokens_details.cached_tokens`,
  `prompt_cache_hit_tokens` or `cache_read_input_tokens`, cache write from `cache_creation_input_tokens`;
  `source: "provider"`).
- With `usage: estimate`, or when the API sent nothing usable, the usage is estimated (`source: "estimate"`): input is
  `tokens.count_messages()` over the request messages (text with tiktoken `o200k_base`, each image counts the model's
  `image_tokens`), output is the answer plus thinking text, and `reasoning_tokens` the thinking text. Counts are
  multiplied by `token_ratio`. Cache fields are `null`.
- Replay runs estimate from the emitted parts, with `input_tokens` 0.
- tiktoken needs its BPE file. The backend Dockerfile downloads `o200k_base` at build time into `TIKTOKEN_CACHE_DIR`
  (`/opt/tiktoken`), so the running container needs no network access.
- `GET /api/context` estimates the next request with the same turns and, when the last message is a provider-reported
  assistant reply, uses its real input and output counts instead (see [api.md](api.md#get-apicontext)).

### Data-URI image extraction

Some providers return generated images inline in the text as
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

## Database

Tables: `users`, `sessions`, `auth_throttle`, `conversations`, `messages`, `files`, `skills`, `plugins`, `token_usage`,
`admin_audit`.

Migration `0002` adds `messages.usage` (JSONB), `conversations.pinned` and `conversations.last_read_at` (existing
conversations are set as read), and the tables `skills` (unique per user and name; file list as JSONB) and `plugins`
(unique per user and lower-cased name; headers as JSONB `[{name, value_enc}]`).

Migration `0003` adds `users.token_limit` (BIGINT, null = unlimited, check `> 0`) and `users.token_period` (`day` or
`month`, default `month`), and two tables:

- `token_usage` (`user_id` cascades with the user, `message_id` is set to null when the message goes, `tokens`,
  `created_at`; index on `user_id, created_at`). It is the ledger for token limits.
- `admin_audit` (`actor_id` set to null when the admin goes, `actor_email`, `target_id` without a foreign key,
  `target_email`, `action`, `detail` JSONB, `created_at`). Emails are snapshots, so rows outlive the accounts.

The conversation list computes `status`, `unread` and `preview` with lateral subqueries over the last assistant
message and the last non-empty message of each conversation, so it needs no extra columns. Paging uses the cursor
`<pinned 0|1>~<updated_at ISO>` over the order (pinned, `updated_at` descending).

## Token limits and the audit log

`app/services/quota.py` holds the window maths (`period_bounds`: UTC day or month), the sums (`used_tokens`, and
`used_tokens_many`, one grouped query for the admin list) and the writers (`record_usage`, `log_admin`).

- Recording: `RunState.finish` adds one `token_usage` row (the message's `usage.total_tokens`, when greater than 0)
  in the same transaction that writes the final message status, so a reply is counted once and with its message. The
  usage may be an estimate (`ensure_usage` runs first for stopped runs and providers that send none).
- Checking: `POST /api/conversations/{id}/messages` sums the user's rows in the current window before reserving the
  run and answers 429 `quota_exceeded` when `token_limit` is set and reached. It is a soft limit: a run in progress is
  never cut. Because usage is booked only when a run ends, a user with a `token_limit` also gets a single run slot
  (`RunRegistry.reserve_limited`): a second send while one is running answers 409 `run_in_progress`.
  `GET /api/auth/me` returns the same sum as `quota`.
- Deleting users (single or bulk) commits the DB delete and its audit rows first, then removes the user's MinIO
  objects best-effort; a failed object delete is logged and leaves only an orphaned object.
- Audit: every admin change (`user.create`, `user.status`, `user.role`, `user.password_reset`, `user.delete`,
  `user.quota`) adds an `admin_audit` row through `log_admin` in the same transaction as the change. Bulk actions run
  in one transaction and tag each row with `bulk: true`.

## Skills and plugins

Both are stored for a future agent backend. Nothing in the chat path reads them.

- Skills: an upload is parsed in a worker thread (`services/skills.py`): `.md` or `.zip`, path traversal, symlinks,
  encrypted entries and duplicate entries rejected, size and count limits, frontmatter validated. Files are written
  to S3 under `u/<user id>/skills/<skill id>/`; the database keeps name, description, version, size and the file list.
  `read_upload()` (shared with the file upload) enforces the 5 MB limit while streaming.
- Plugins: URL and header names are validated and stored; the API never makes a request to them. Header values are
  encrypted with Fernet (`services/secrets.py`) using `SECRETS_KEY` and stored as `value_enc`; responses show only a
  mask. Updating headers with `value: null` keeps the old ciphertext. Without a valid key, storing a header gives
  503 `secrets_not_configured`.

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

Details and numbers: [api.md](api.md#auth) and the Security section of the [README](../README.md#security).

## Startup tasks

The API lifespan (`app/main.py`) runs these in order, and does not serve requests until they finish:

0. `get_registry()`: load and validate the models file, so a bad config fails fast.
1. `alembic upgrade head` (in a worker thread, because Alembic's async environment needs its own event loop).
2. `check_secrets()`: if `SECRETS_KEY` is set, or plugins already exist, the key must be a valid Fernet key, otherwise
   startup fails. With no key and no plugins it only logs a warning (saving plugin headers is then refused).
3. `ensure_bucket()`: create the S3 bucket if missing, retrying with backoff for up to `S3_STARTUP_TIMEOUT_SECONDS`
   (MinIO may still be starting).
4. `seed_admin()`: if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, create an active admin (display name "Admin"), or
   promote an existing user with that email to active admin without touching its password.
5. `mark_interrupted_messages()`: every message still `streaming` becomes `error` with the error `interrupted`
   (their runs died with the previous process).

On shutdown, running tasks are cancelled (waiting up to 10 seconds), the model clients are closed and the database engine is closed.

The compose healthcheck of `api` calls `GET /api/health`, which runs `SELECT 1`. `web` starts after `api` is healthy.

## Design limits

- One uvicorn worker (`--workers 1`, `--no-proxy-headers`), because runs, subscribers and the busy set are in process
  memory. See Limitations in the [README](../README.md#roadmap-and-limitations).
- The API container is not published; only nginx is, on `127.0.0.1`.
- Storage code is plain S3 (boto3, path-style addressing, region `us-east-1`), so the MinIO image can be replaced.
