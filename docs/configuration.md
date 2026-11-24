# Configuration

Everything Peep needs at runtime: the models file and the environment variables. For the shortest path to a running
stack, see the [README](../README.md#quick-start).

## Models configuration

The API reads its models from `config/models.yaml` (path in `MODELS_CONFIG`, default `/app/config/models.yaml`;
`./config` is mounted read-only into the `api` container). `config/models.example.yaml` documents every option and has
presets for OpenAI, Gemini official, DeepSeek, Anthropic compat, OpenRouter and vLLM/Ollama. Provider APIs change:
check the current documentation before relying on a preset.

Users get one model, the `active` one. The model picker appears only when `dev.model_switcher` is true (for
development and tests; it also offers the `replay:*` demo models, see [usage.md](usage.md#models)).

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

## Environment variables

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
| `TRUSTED_PROXIES` | empty | CIDRs of reverse proxies whose `X-Forwarded-For` is trusted. Empty trusts nobody: the TCP peer is the client IP (login throttling keys on it). Set it only if a proxy runs in front of the app, see [Running behind a reverse proxy](architecture.md#running-behind-a-reverse-proxy). |
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
| `STATIC_DIR` | `/app/static` | Where the app looks for the built SPA (set by the image; no SPA is served if it has no `index.html`). |
| `WEB_PORT` | `8090` | Host port of the `app` service (container port 8000), bound to `127.0.0.1`. |

## Internal names

The product is called Peep, but internal names keep the earlier project name `ensemble-chat`: the Docker Compose project
name, the S3 bucket (`S3_BUCKET`), the database (`POSTGRES_DB=ensemble_chat`), the session cookie `ec_session` and the
browser `localStorage` keys `ec_*`.
