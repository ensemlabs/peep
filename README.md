<p align="center"><img src="docs/images/ensemble-labs-logo.png" alt="Ensemble Labs" width="160"></p>

<h1 align="center">ensemble-chat</h1>

<p align="center">A web chat UI that shows what an agent is doing: live thinking, tool calls, sub-agents, code and media.</p>

<p align="center">Built by Ensemble Labs.</p>

<p align="center"><img src="docs/images/chat-agent-demo.png" alt="Chat with the replay:agent-demo model: thinking block, markdown, tool card" width="820"></p>

## Overview

`ensemble-chat` is a ChatGPT/Claude-style web app for any OpenAI-compatible chat API. It was built to run against
[llm-proxy](../llm-proxy) and to render the whole stream of an agent run, not only the final text.
Conversations, uploads and users are stored in Postgres and MinIO. It is a UI only: there is no agent logic and no
tool execution. Tool and sub-agent cards come from recorded demo streams (`replay:*` models), so the UI can be
built and tested before a real agent is plugged in (see [docs/api.md](docs/api.md#replay-fixtures)).

## Features

- **Live thinking panel:** the model's reasoning streams into an open panel inside the chat, with the mascot and a
  timer. When it ends it collapses to "Thought for Ns".
- **Tool and sub-agent cards:** name, input, output, status and run time. Sub-agents nest, and their steps can
  contain tools and text.
- **Markdown and code:** GitHub-flavoured markdown (raw HTML is not rendered), syntax highlighting, language
  label, Copy and wrap buttons.
- **Media:** image gallery with a zoom lightbox (next/previous, thumbnails), video with seeking, audio player,
  and a download button on everything.
- **Uploads:** attach images, video, audio and any file (button, drag and drop, paste). Files are stored in MinIO,
  images are sent to the model, text files open in a code preview.
- **Accounts:** email and password sign-up. New accounts are `pending` until an admin approves them on the admin
  page (search, approve, disable, change role, reset password, delete).
- **Languages and themes:** Vietnamese and English with a switch, light and dark theme that follow the system.
- **Responsive:** phone to desktop. The sidebar becomes a drawer below 768 px.
- **Mascot:** an octopus that animates while the assistant works (idle, thinking, working, error).
- **Reconnect and stop:** a reply keeps running if you close the tab. Reload the page and the stream resumes.
  A Stop button cancels it.

<p align="center">
  <img src="docs/images/gallery-lightbox.png" alt="Gallery lightbox" width="440">
  <img src="docs/images/mobile-chat.png" alt="Mobile view" width="190">
</p>

<p align="center"><img src="docs/images/mascot-states.png" alt="Mascot states: idle, thinking, working, error" width="340"></p>

## Architecture

```
browser
   |  http://127.0.0.1:8090  (only published port)
web  (nginx: serves the SPA, proxies /api/ to api:8000)
   |
api  (FastAPI, one uvicorn worker)
   |-- postgres  (users, sessions, conversations, messages, file metadata, login throttle)
   |-- minio     (uploaded and generated files, S3 API)
   '-- LLM       (OpenAI-compatible /v1, e.g. llm-proxy)
```

Details, request flow and startup tasks: [docs/architecture.md](docs/architecture.md). HTTP and SSE contract:
[docs/api.md](docs/api.md). What llm-proxy does not support and how the app copes:
[docs/llm-proxy-gaps.md](docs/llm-proxy-gaps.md). Why this stack: [ADR 0001](docs/adr/0001-tech-stack.md).

## Quick start

Requires Docker with Compose v2.

1. Create the config file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`. Replace every `change-me` value:

   | Variable | What to set |
   | :--- | :--- |
   | `POSTGRES_PASSWORD` | Database password. Also put it in `DATABASE_URL` (`postgresql+asyncpg://ensemble:<password>@postgres:5432/ensemble_chat`). |
   | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | MinIO root credentials. |
   | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | What the API uses to reach MinIO. Use the same values as the root credentials. |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin, created on startup. The password must be 10-128 characters. |
   | `LLM_API_KEY` | API key of the LLM endpoint. For llm-proxy this is its `API_KEY`. |
   | `LLM_BASE_URL` | OpenAI-compatible base URL, ending in `/v1`. Used when `GEMINI=0`. |

3. Pick the LLM:

   - `GEMINI=1` (default): [llm-proxy](../llm-proxy) must already be running. The API joins its
     Docker network `llm-proxy_default` and talks to `http://llm-proxy-ts:8000/v1`.
     `docker-compose.gemini.yml` sets this URL and overrides `LLM_BASE_URL` from `.env`.
   - `GEMINI=0`: no external network. Set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_DEFAULT_MODEL` and `LLM_MODELS` in
     `.env` to another OpenAI-compatible endpoint that the `api` container can reach. The `replay:*` demo models
     work without any LLM.

4. Start the stack:

   ```bash
   make up                # GEMINI=1
   make up GEMINI=0       # without llm-proxy
   ```

   `make up` creates `.env` from `.env.example` if it is missing, then builds and starts postgres, minio, api and web.

5. Open http://127.0.0.1:8090 and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

Check the stack with `make ps` and `make logs`. The API health endpoint is `GET /api/health` (through the web
port: `curl http://127.0.0.1:8090/api/health`).

Use the same `GEMINI=` value for every make command in a session (`make down GEMINI=0`), because it selects the
compose files.

## Configuration

All variables go in `.env`. The API reads them through `backend/app/config.py` (names are case-insensitive). The
compose-only variables are read by `docker-compose.yml`.

### API

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `DATABASE_URL` | (required) | SQLAlchemy URL, `postgresql+asyncpg://user:password@host:5432/db`. |
| `APP_ORIGINS` | `http://localhost:8090,http://127.0.0.1:8090` | Comma-separated origins allowed to send state-changing `/api` requests (Origin or Referer check). Add your public URL when you publish the app. |
| `COOKIE_SECURE` | `false` | Set `true` when the site is served over HTTPS. Adds `Secure` to the session cookie. |
| `SESSION_IDLE_DAYS` | `7` | Sliding session lifetime. |
| `SESSION_ABSOLUTE_DAYS` | `30` | Hard session lifetime. |
| `SESSION_REFRESH_SECONDS` | `3600` | A session is extended at most once per this interval. |
| `TRUSTED_PROXIES` | `172.16.0.0/12,10.0.0.0/8,192.168.0.0/16` | CIDRs whose `X-Forwarded-For` is trusted (the nginx container). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | empty | If both are set, an active admin is created on startup, or an existing user with that email is promoted (its password is not changed). |
| `S3_ENDPOINT` | `http://minio:9000` | S3 endpoint. |
| `S3_BUCKET` | `ensemble-chat` | Bucket, created on startup if missing. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | empty | S3 credentials. |
| `S3_STARTUP_TIMEOUT_SECONDS` | `30` | How long startup waits for S3 before failing. |
| `LLM_BASE_URL` | `http://llm-proxy-ts:8000/v1` | OpenAI-compatible base URL. Overridden by `docker-compose.gemini.yml` when `GEMINI=1`. |
| `LLM_API_KEY` | empty | API key sent to the LLM endpoint. |
| `LLM_DEFAULT_MODEL` | `gemini-pro` | Default model. If it is not in the list, the first model is used. |
| `LLM_MODELS` | empty (`.env.example`: `gemini-pro,gemini-flash-lite,gemini-4-hydrogen,gemini-carbon`) | Comma-separated allowlist, order kept. Empty means every model the endpoint lists. |
| `LLM_TIMEOUT_SECONDS` | `300` | Timeout of a model request. |
| `REPLAY_ENABLED` | `true` | Show the `replay:*` demo models. |
| `REPLAY_TIME_SCALE` | `1.0` | Multiplies the delays of replay fixtures. `0` plays them instantly. |
| `MAX_UPLOAD_MB` | `200` | Maximum upload size enforced by the API. |
| `THROTTLE_WINDOW_SECONDS` | `900` | Window for failed-login and per-IP login counting. |
| `LOGIN_MAX_FAILURES` | `5` | Failed logins per email and IP before a lock. |
| `LOCK_BASE_SECONDS` | `900` | First lock duration. It doubles on each further lock. |
| `LOCK_MAX_SECONDS` | `86400` | Longest lock. |
| `IP_LOGIN_MAX` | `30` | Login attempts per IP per window. |
| `REG_MAX` | `10` | Registrations per IP per `REG_WINDOW_SECONDS`. |
| `REG_WINDOW_SECONDS` | `3600` | Registration window. |
| `APP_ENV` | `production` | Read into settings but not used by the code. `make test-be` sets it to `test`. |

### Compose only

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | (required) | Database user and password. |
| `POSTGRES_DB` | `ensemble_chat` | Database name. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | (required) | MinIO root credentials. |
| `WEB_PORT` | `8090` | Host port of the web service, bound to `127.0.0.1`. |
| `NGINX_MAX_BODY_MB` | `220` | nginx `client_max_body_size`. Keep it above `MAX_UPLOAD_MB`, because multipart adds overhead. |

## Make targets

Run `make help` for the list. Set `GEMINI=0` to leave out `docker-compose.gemini.yml`.

| Target | What it does |
| :--- | :--- |
| `make env` | Creates `.env` from `.env.example` if missing. |
| `make up` | Starts the stack in the background, building images if needed. |
| `make down` | Stops the stack. |
| `make logs` | Follows service logs. |
| `make ps` | Shows running services. |
| `make build` | Builds all images. |
| `make test-be` | Backend tests (`pytest`) in the `api-test` container, against real Postgres and MinIO from compose. Uses the database `ensemble_chat_test` and bucket `ensemble-chat-test`. |
| `make test-fe` | Frontend unit tests, type check and build in a `node:24.15.0-alpine` container (`npm ci && npm test && npm run build`). |
| `make e2e` | Runs the Playwright suite in `e2e/` against the live stack. See below. |
| `make e2e-down` | Stops the stack started by `make e2e`. |
| `make clean` | Stops the stack and deletes the volumes (destroys local data). |

### End-to-end tests

<!-- TODO(e2e): verify after Step 5 -->

`make e2e` runs the Playwright suite in `e2e/` (Playwright 1.65.0, container
`mcr.microsoft.com/playwright:v1.65.0-noble`) against the whole compose stack. Pass extra Playwright arguments with
`ARGS`, for example `make e2e ARGS="--grep @gemini"`. Tests tagged `@gemini` call the real model through
llm-proxy. The overlay `docker-compose.e2e.yml` raises the per-IP login and registration throttles for the
suite. See `e2e/README.md` if present.

Playwright's Chromium has no H.264/AAC codecs, so playback and seeking tests use WebM and MP3. The mp4 demo file is
only checked for Range requests and downloads.

## Usage

### First admin and approvals

1. Start the stack with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set and sign in with them.
2. Other people register on the sign-up page. They land in the app with a "waiting for approval" banner, and a
   transparent overlay blocks the whole app except "Log out" and "Check again". The API answers 403
   `account_pending` to everything but `/api/auth/*`. The page checks `/api/auth/me` every 30 seconds and unlocks
   when the account is approved.
3. The admin opens **Manage users** in the account menu (`/admin/users`), searches, and presses Approve. The same page disables
   users, changes roles, resets passwords and deletes users together with their files. Admins cannot change or
   delete their own account.

There is no email: password resets are done by an admin, or by the user in Settings.

### Models

The model menu in the chat header lists two groups.

- **Models:** what the LLM endpoint offers (`/v1/models`), filtered by `LLM_MODELS`. With llm-proxy these
  are `gemini-pro`, `gemini-flash-lite`, `gemini-4-hydrogen` and `gemini-carbon`.
- **Demo (recorded):** `replay:*` models, shown when `REPLAY_ENABLED=true`. They replay a recorded event stream and
  call no LLM.
  - `replay:agent-demo` shows a full agent run: a thinking block, markdown, two tool calls (`read_file`,
    `run_tests`), a `researcher` sub-agent with its own tool and a nested `summarizer` sub-agent, a tool that
    returns a 5-image gallery, a tool that returns video (WebM and MP4), and a tool that returns audio.
  - `replay:error-demo` writes some text, runs a `deploy` tool, then ends with an error message.

### Thinking toggle

The **Thinking** switch in the header (Off or High) sends `reasoning: "high"` with the message. The backend then
requests `reasoning_effort: "high"` from the model, and any `reasoning_content` it streams appears as a live
thinking block. The switch is disabled for `replay:*` models (they always show what the fixture contains). The
choices of model, thinking and language are kept in the browser (`localStorage`).

## Security notes

- **Passwords:** argon2id (argon2-cffi default parameters), 10-128 characters, not equal to the email. Hashing runs
  in a thread pool. An unknown email still costs a hash verification, and the login error is always the same
  `invalid_credentials`.
- **Sessions:** cookie `ec_session` holds 32 random bytes. Only its SHA-256 is stored. Flags: `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Secure` when `COOKIE_SECURE=true`. A session expires after 7 idle days (sliding) and
  at 30 days at the latest. Logout deletes it. Changing a password revokes the user's other sessions. Disabling or
  deleting a user, or an admin password reset, revokes all of them.
- **CSRF:** every `/api` request other than GET, HEAD or OPTIONS must carry an `Origin` (or `Referer`) listed in
  `APP_ORIGINS`, otherwise 403 `bad_origin`. `/api/health` is exempt.
- **Login throttling** (Postgres table `auth_throttle`, so it survives restarts):
  - 5 failed logins for the same email and IP within 15 minutes lock that pair for 15 minutes. Each further lock
    doubles the time, up to 24 hours. A correct login clears it. While locked, even the right password is refused.
  - At most 30 login attempts per IP per 15 minutes, and 10 registrations per IP per hour.
  - The response is 429 `too_many_attempts` with a `Retry-After` header. Changing a password has the same 5-failure
    lock per user.
- **Client IP:** nginx sets `X-Forwarded-For` to `$remote_addr` (it overwrites, never appends). The API reads the
  first hop only when the connecting peer is inside `TRUSTED_PROXIES`, and uvicorn runs with `--no-proxy-headers`.
  A client cannot fake its IP to dodge the throttle. If you put another proxy in front of the `web` container, nginx
  sees that proxy's address, so all clients share one IP. Adjust `nginx/default.conf.template` for that case.
- **Files:** only the owner can read a file (other users get 404). Images (checked with Pillow, pixel cap 100 MP),
  video and audio are served `inline`. Everything else is `attachment`. SVG, HTML, XML and JavaScript uploads are
  stored as `application/octet-stream` and only download. `?download=1` always forces a download. File responses
  carry `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. The web
  server sends a CSP of `default-src 'self'` (images and media from `self`, `blob:` and `data:` only) and
  `frame-ancestors 'none'` for the app.
- **Markdown:** raw HTML in model output is not rendered.
- **Secrets:** never commit `.env`. It is git-ignored; only `.env.example` is tracked. Use real passwords, not the
  `change-me` placeholders. The API and the database are not published to the host; only `web` is, on `127.0.0.1`.

## Limitations

- **One API worker.** Runs live inside the API process (`RunRegistry`). Run more than one uvicorn worker or API
  replica and reconnect and stop will not find the run. If the API restarts, replies that were streaming are marked
  as errors with `interrupted`. Scaling out would need a shared event bus (for example Redis).
- **No SSO and no email.** Sign-up is email and password only, with no email verification and no reset links.
- **No title generation.** A conversation title is the first 60 characters of the first message. Users can rename it.
- **MinIO image.** The upstream `minio/minio` images can no longer be pulled, so compose uses the Chainguard build
  `cgr.dev/chainguard/minio`, pinned by digest. The code only uses the generic S3 API (boto3, path-style
  addressing), so another S3 server (a MinIO fork, RustFS) can replace it by changing the `minio` service and the
  `S3_*` variables.
- **LLM features follow the endpoint.** llm-proxy has no tool calling, no video or audio in chat and sends
  generated images as base64. See [docs/llm-proxy-gaps.md](docs/llm-proxy-gaps.md).
- **Test codecs.** Playwright's Chromium has no H.264/AAC, so automated playback tests use WebM and MP3.
- **Uploads are not virus-scanned,** and there is no per-user quota.

## Project layout

```
backend/                FastAPI app (Python 3.13, uv)
  app/                  main.py, config.py, db.py, models.py, security.py, deps.py, errors.py, middleware.py
    routers/            auth, admin, conversations, messages, files, models
    services/           runs (RunRegistry, SSE), storage (S3), media, history, sessions, throttle,
                        llm_models, startup
    providers/          base, openai_provider, replay_provider, datauri
    replay/             fixtures/*.json (replay:* models) and assets/ (see assets/README.md)
  alembic/              database migrations (run on startup)
  tests/                pytest suite
  Dockerfile            targets: runtime (default), test
frontend/               React 19 + TypeScript + Vite
  src/                  api, components, features (auth, chat, media, admin, settings), i18n, layout, lib
  nginx/                default.conf.template (SPA, /api proxy, security headers)
  Dockerfile            build, then nginx
e2e/                    Playwright suite
docs/                   architecture.md, api.md, llm-proxy-gaps.md, adr/, images/
docker-compose.yml      postgres, minio, api, web (+ profile test: api-test)
docker-compose.gemini.yml   joins the api to the llm-proxy network
docker-compose.e2e.yml  e2e overlay
Makefile  .env.example
```

## License

[MIT](LICENSE) © 2026 Ensemble Labs.
