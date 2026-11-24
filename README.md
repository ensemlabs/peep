<p align="center"><img src="docs/images/ensemble-labs-logo.png" alt="Ensemble Labs" width="160"></p>

<h1 align="center">ensemble-chat</h1>

<p align="center">A web chat UI that shows what an agent is doing: live thinking, tool calls, sub-agents, code and media.</p>

<p align="center">Built by Ensemble Labs.</p>

<p align="center"><img src="docs/images/chat-agent-demo.png" alt="Desktop chat with a demo agent run: Thought row, markdown, inline tool rows" width="820"></p>

## Overview

`ensemble-chat` is a ChatGPT/Claude-style web app for any OpenAI-compatible chat API (OpenAI, Gemini, DeepSeek,
Anthropic compat, OpenRouter, vLLM, Ollama, and others). It renders the whole stream of an agent run, not only the
final text.
Conversations, uploads and users are stored in Postgres and MinIO. It is a UI only: there is no agent logic and no
tool execution. Tool and sub-agent cards come from recorded demo streams (`replay:*` models), so the UI can be
built and tested before a real agent is plugged in (see [docs/api.md](docs/api.md#replay-fixtures)).

## Features

- **ChatGPT-style conversation:** answers are plain text on the page, not boxed cards. Reasoning is a quiet
  "Thinking..." row that streams its last few lines with a fade and, when done, collapses to "Thought for Ns"
  (click to expand). Tool calls and sub-agents are inline rows ("Ran `read_file`", with input and output when
  expanded); sub-agents nest. Images, video and audio from tools are shown directly in the flow.
- **Thinking levels per model:** each model in `config/models.yaml` declares its own levels (for example Off, Low,
  High, Max). The Thinking selector in the composer shows exactly those. A model with one level shows an
  "always on" label, and a model without levels shows no selector.
- **Stop:** the send button turns into a Stop button while a reply runs. Esc stops it too while the focus is in the
  message box (Esc in other text fields, dialogs and menus does not).
- **Context ring:** a small pie gauge in the composer shows how much of the model's context window the conversation
  uses. Hover, click or tap for a breakdown (system, your messages, replies, attachments, tool results, skills,
  free), the last response (input, output, reasoning, cache read, cache write) and conversation totals. Numbers are
  marked "estimated" (tiktoken) or "from provider" when the provider reports real usage.
- **Markdown, code and math:** GitHub-flavoured markdown (raw HTML is not rendered), syntax highlighting, language
  label, Copy and wrap buttons, and LaTeX math rendered with KaTeX.
- **Media:** image gallery with a zoom lightbox (next/previous, thumbnails), video with seeking, audio player,
  and a download button on everything.
- **Uploads:** attach images, video, audio and any file (the + button, drag and drop, paste). Files are stored in MinIO,
  images are sent to the model, text files open in a code preview.
- **Conversation list:** each conversation shows its state (running spinner, unread dot when a reply finished
  while you were elsewhere, red dot on error), a one-line preview, search over titles and message text, and pinning.
  Groups: Pinned, Today, Previous 7 days, Previous 30 days, Older.
- **Plugins & Skills:** Settings has a "Plugins & Skills" tab where each user uploads skills (`SKILL.md` or a zip)
  and registers MCP servers (URL, transport, headers; `.mcp.json` import). They are stored for a future agent
  backend and are **not used by the chat yet**.
- **Accounts:** email and password sign-up. New accounts are `pending` until an admin approves them on the admin
  page (search, approve, disable, change role, reset password, delete).
- **Languages and themes:** Vietnamese and English with a switch; light, dark or system theme.
- **Mobile and PWA:** built for phones as well as desktops: the sidebar is a drawer below 768 px, safe areas
  (notches), dynamic viewport height and on-screen keyboards are handled, and inputs are 16 px so iOS does not zoom.
  A web app manifest with icons lets you install it to the home screen (standalone display). There is no service
  worker, so it is not available offline.
- **Mascot and branding:** the Ensemble logo (theme-aware SVG) in the sidebar, the login page and the favicon.
  Peep, a yellow chick, greets you when a new chat opens and then idles. It also shows as a small "waiting"
  indicator before the first token of a reply arrives, and in an error pose next to a failed reply.
- **Dev model picker:** when `dev.model_switcher` is on, a model picker appears in the composer on desktop and in
  the drawer on phones (see [Models configuration](#models-configuration)).
- **Reconnect:** a reply keeps running if you close the tab. Reload the page and the stream resumes.

<p align="center">
  <img src="docs/images/chat-dark.png" alt="Dark theme: inline tool rows with an image gallery shown directly in the flow" width="520">
  <img src="docs/images/chat-code.png" alt="Light theme: answer with a highlighted code block, conversation list and the context gauge" width="520">
</p>

<p align="center">
  <img src="docs/images/peep-empty.png" alt="New chat with Peep greeting the user and suggestion chips" width="400">
  <img src="docs/images/peep-states.png" alt="Peep poses" width="300">
  <img src="docs/images/mobile-chat.png" alt="Phone layout, dark theme" width="170">
</p>

## Architecture

```
browser
   |  http://127.0.0.1:8090  (only published port)
web  (nginx: serves the SPA, proxies /api/ to api:8000)
   |
api  (FastAPI, one uvicorn worker)
   |-- postgres  (users, sessions, conversations, messages, file metadata, login throttle)
   |-- minio     (uploaded and generated files, S3 API)
   '-- LLM       (any OpenAI-compatible /v1 endpoint, set in config/models.yaml)
```

Details, request flow and startup tasks: [docs/architecture.md](docs/architecture.md). HTTP and SSE contract:
[docs/api.md](docs/api.md). Development and testing: [docs/development.md](docs/development.md). Why this stack:
[ADR 0001](docs/adr/0001-tech-stack.md).

## Quick start

Requires Docker with Compose v2.

1. Create the config files (`make env` does the same):

   ```bash
   cp .env.example .env
   cp config/models.example.yaml config/models.yaml
   ```

   Both are git-ignored. Never commit them.

2. Edit `.env`. Replace every `change-me` value:

   | Variable | What to set |
   | :--- | :--- |
   | `POSTGRES_PASSWORD` | Database password. Also put it in `DATABASE_URL` (`postgresql+asyncpg://ensemble:<password>@postgres:5432/ensemble_chat`). |
   | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | MinIO root credentials. |
   | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | What the API uses to reach MinIO. Use the same values as the root credentials. |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin, created on startup. The password must be 10-128 characters. |
   | `SECRETS_KEY` | Fernet key that encrypts plugin header values (see below). Needed to save plugin headers. |
   | the variable named by `api_key_env` in `config/models.yaml` | API key of your LLM provider. |

   Generate `SECRETS_KEY` once and keep it (losing it makes stored plugin headers unreadable):

   ```bash
   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   # or, without a local Python:
   docker compose run --rm --no-deps api python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

3. Edit `config/models.yaml`. The file ships with a placeholder provider; either edit it or uncomment one of the
   presets (OpenAI, Gemini official, DeepSeek, Anthropic compat, OpenRouter, vLLM/Ollama). Set the provider's
   `base_url`, put the model's real name in `upstream`, set `active` to the id of the model users should get, and
   put the provider's key in `.env` under the name given by `api_key_env` (the placeholder uses `LLM_BASE_URL` and
   `LLM_API_KEY`). Check the preset against your provider's current documentation. See
   [Models configuration](#models-configuration).

4. Start the stack:

   ```bash
   make up
   ```

   `make up` creates the two files if they are missing, then builds and starts postgres, minio, api and web. The
   models file is read once at startup: after editing it, run `docker compose restart api`. A mistake in it stops the
   API with an error in `make logs`.

5. Open http://127.0.0.1:8090 and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

Check the stack with `make ps` and `make logs`. The API health endpoint is `GET /api/health` (through the web
port: `curl http://127.0.0.1:8090/api/health`).

## Models configuration

The API reads its models from `config/models.yaml` (path in `MODELS_CONFIG`, default `/app/config/models.yaml`;
`./config` is mounted read-only into the `api` container). `config/models.example.yaml` documents every option and has
presets for OpenAI, Gemini official, DeepSeek, Anthropic compat, OpenRouter and vLLM/Ollama. Provider APIs change:
check the current documentation before relying on a preset.

Users get one model, the `active` one. The model picker appears only when `dev.model_switcher` is true (for
development and tests; it also offers the `replay:*` demo models, see [Usage](#usage)).

```yaml
active: my-model                      # the model users get; must be defined below
dev:
  model_switcher: false
providers:
  - id: my-provider
    base_url: https://api.example.com/v1
    api_key_env: MY_PROVIDER_API_KEY  # name of an env var in .env; never put the key in this file
    usage: provider                   # provider: trust the usage the API returns; estimate: always use tiktoken
    models:
      - id: my-model
        upstream: provider-model-name # name sent to the provider (default: id)
        label: My Model               # or {en: ..., vi: ...}
        vision: true
        context_window: 128000
        image_tokens: 765             # estimated tokens per attached image
        token_ratio: 1.0              # multiplier for tiktoken estimates
        thinking:                     # omit for models without reasoning controls
          default: "off"
          returns_text: true          # the provider streams reasoning text
          read_from:
            delta_fields: [reasoning_content, reasoning]
            parse_tags: false         # true: split <think>...</think> out of the content
          levels:
            - {id: "off",  label: {en: Off, vi: Tắt}, patch: {}}
            - {id: high, label: {en: High, vi: Cao}, patch: {reasoning_effort: high}}
```

- `${VAR}` and `${VAR:-default}` in values are replaced from the environment. A missing variable stops startup.
- Unknown keys, duplicate ids, or an `active` model that is not defined stop startup with a clear error.
- A level's `patch` is merged into the chat request. Keys the OpenAI SDK knows (`reasoning_effort`, `temperature`,
  ...) are sent as normal parameters; `extra_body` and any other key go into the JSON body.
- Without `config/models.yaml`, the API builds a registry from the `LLM_*` variables (see below): one provider,
  token usage always estimated, and thinking levels Off and High (High sends `reasoning_effort: "high"`).

## Configuration

All variables go in `.env`. The API reads them through `backend/app/config.py` (names are case-insensitive). The
compose-only variables are read by `docker-compose.yml`. The `LLM_*` variables (except the timeout) are used only
when `config/models.yaml` does not exist; `.env.example` has them commented out.

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
| `SECRETS_KEY` | empty | Fernet key that encrypts plugin header values at rest. Without it, saving a plugin with headers fails with 503 `secrets_not_configured`. If plugins already exist and the key is missing or invalid, the API refuses to start. |
| `MODELS_CONFIG` | `/app/config/models.yaml` | Path of the models file inside the container (`./config` is mounted read-only at `/app/config`). |
| `DEV_MODEL_SWITCHER` | `false` | Fallback mode only: same as `dev.model_switcher` in the file. |
| `LLM_BASE_URL` | empty | Fallback only: OpenAI-compatible base URL, ending in `/v1`. |
| `LLM_API_KEY` | empty | Fallback only: API key sent to the endpoint. |
| `LLM_DEFAULT_MODEL` | empty | Fallback only: the active model. Required, with `LLM_BASE_URL`, when there is no models file. |
| `LLM_MODELS` | empty | Fallback only: extra model ids, comma-separated, order kept. |
| `LLM_TIMEOUT_SECONDS` | `300` | Timeout of a model request (always applies). |
| `REPLAY_ENABLED` | `true` | Allow the `replay:*` demo models (they are offered only with `dev.model_switcher`, or when `active` is a `replay:*` id). |
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

Run `make help` for the list. Development options: [docs/development.md](docs/development.md).

| Target | What it does |
| :--- | :--- |
| `make env` | Creates `.env` and `config/models.yaml` from the examples if missing. |
| `make up` | Starts the stack in the background, building images if needed. |
| `make down` | Stops the stack. |
| `make logs` | Follows service logs. |
| `make ps` | Shows running services. |
| `make build` | Builds all images. |
| `make test-be` | Backend tests (`pytest`) in the `api-test` container, against real Postgres and MinIO from compose. Uses the database `ensemble_chat_test` and bucket `ensemble-chat-test`. |
| `make test-fe` | Frontend unit tests, type check and build in a `node:24.15.0-alpine` container (`npm ci && npm test && npm run build`). |
| `make e2e` | Runs the Playwright suite in `e2e/` against the live stack, using the development provider. See below. |
| `make e2e-down` | Stops the stack started by `make e2e`. |
| `make clean` | Stops the stack and deletes the volumes (destroys local data). |

### End-to-end tests

`make e2e` runs the Playwright suite in `e2e/` against the whole compose stack (with the e2e overrides and its own
`e2e/config/models.e2e.yaml`). Pass extra Playwright arguments with `ARGS`, for example
`make e2e ARGS="--grep A8"`. `make e2e-down` stops the stack. Details: [docs/development.md](docs/development.md).

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

Users chat with the one `active` model from `config/models.yaml`. With `dev.model_switcher: true` the chat header also
shows a model picker with every configured model plus the `replay:*` demo models (`REPLAY_ENABLED=true`). Demo
models replay a recorded event stream and call no LLM.

- `replay:agent-demo` shows a full agent run: a thinking block, markdown, two tool calls (`read_file`,
  `run_tests`), a `researcher` sub-agent with its own tool and a nested `summarizer` sub-agent, a tool that
  returns a 5-image gallery, a tool that returns video (WebM and MP4), and a tool that returns audio.
- `replay:error-demo` writes some text, runs a `deploy` tool, then ends with an error message.

### Thinking levels

The **Thinking** selector in the composer lists the levels the model defines in `thinking.levels`, and starts at
`thinking.default`. The chosen level is remembered per model in the browser. A model with a single level shows an
"always on" label, and a model without `thinking` shows no selector. The level's `patch` decides what is sent to the
provider (for example `reasoning_effort`). Reasoning text the model streams appears as a live thinking block, if the
model's `read_from` settings say where to find it. Replay models have no levels.

### Plugins and skills

**Settings > Plugins & Skills** (`/settings/integrations`, also in the account menu) is per user.

- **Skills:** upload a `SKILL.md` or a `.zip` with `SKILL.md` at its root. The file needs YAML frontmatter with `name`
  (a-z, 0-9, `-`, up to 64 characters) and `description`. Uploading an existing name asks before replacing it. You can
  view, enable or disable and delete skills.
- **Plugins:** register MCP servers (name, `http` or `sse`, URL, headers) or import a `.mcp.json`. Header values are
  hidden in the list and encrypted in the database.

A banner on the page says it plainly: these are stored for a future agent and the current chat does not use them.
The server never contacts a plugin URL and never runs skill code. Limits and errors: [docs/api.md](docs/api.md#skills).

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
- **Plugin secrets:** header values of plugins are encrypted at rest with Fernet (`SECRETS_KEY`), never returned by
  the API (only a mask), and never logged. Back the key up with the database: without it they cannot be read.
- **No outbound calls for plugins and skills:** plugin URLs are only stored, so they add no server-side request
  forgery surface. Skill archives are checked (path traversal, symlinks, size and file-count limits, encrypted
  archives refused) and never executed. Besides Postgres and MinIO, the `api` container only calls the configured model providers.
- **Secrets:** never commit `.env` or `config/models.yaml`. It is git-ignored; only `.env.example` is tracked. Use real passwords, not the
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
- **LLM features follow the provider.** The app uses plain chat completions: no tool calling is sent, and what
  the model can read or produce depends on the provider.
- **Test codecs.** Playwright's Chromium has no H.264/AAC, so automated playback tests use WebM and MP3.
- **Uploads are not virus-scanned,** and there is no per-user quota.

## Project layout

```
backend/                FastAPI app (Python 3.13, uv)
  app/                  main.py, config.py, db.py, models.py, security.py, deps.py, errors.py, middleware.py
    routers/            auth, admin, conversations, messages, files, models, context, skills, plugins
    services/           runs (RunRegistry, SSE), storage (S3), media, history, sessions, throttle,
                        model_registry, usage, tokens, skills, secrets, startup
    providers/          base, openai_provider, replay_provider, datauri, tagsplit
    replay/             fixtures/*.json (replay:* models) and assets/ (see assets/README.md)
  alembic/              database migrations (run on startup)
  tests/                pytest suite
  Dockerfile            targets: runtime (default), test
frontend/               React 19 + TypeScript + Vite
  src/                  api, components, features (auth, chat, media, admin, settings), i18n, layout, lib
  nginx/                default.conf.template (SPA, /api proxy, security headers)
  Dockerfile            build, then nginx
e2e/                    Playwright suite
config/                 models.example.yaml (copy to models.yaml, git-ignored)
docs/                   architecture.md, api.md, development.md, dev/, adr/, images/
docker-compose.yml      postgres, minio, api, web (+ profile test: api-test)
docker-compose.e2e.yml  e2e overlay
Makefile  .env.example
```

## Development and testing

See [docs/development.md](docs/development.md).

## License

MIT, see [LICENSE](LICENSE).
