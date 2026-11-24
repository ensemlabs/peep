# Development and testing

Notes for working on Peep. Everything runs in Docker. The host needs no Node or Python.

## Make targets

Run `make help` for the list.

| Target | What it does |
| :--- | :--- |
| `make env` | Creates `.env` and `config/models.yaml` from the examples if missing. |
| `make up`, `make down` | Start (build if needed) and stop the stack. |
| `make logs`, `make ps`, `make build` | Follow logs, list services, build images. |
| `make test-be` | Backend tests. |
| `make test-fe` | Frontend tests, type check and build. |
| `make e2e`, `make e2e-down` | Playwright suite against the live stack, and stop it. |
| `make clean` | Stop the stack and delete the volumes. |

The Makefile variable `GEMINI` (default `0`) adds `docker-compose.gemini.yml` when it is `1`. That file joins the
`api` service to the network of the free development proxy described in
[dev/llm-proxy.md](dev/llm-proxy.md). Use the same value for every target, for example
`make up GEMINI=1` and `make down GEMINI=1`. `make e2e` and `make e2e-down` always include it.

To develop against the proxy, uncomment the `llm-proxy` provider at the end of `config/models.yaml` (it is in
`config/models.example.yaml`), set `active: gemini-pro` and `LLM_API_KEY` in `.env`, then `make up GEMINI=1`. Set
`dev.model_switcher: true` if you want the model picker and the `replay:*` demo models in the UI.

## Unit tests

- `make test-be` runs `pytest` in the `api-test` container (profile `test`, Dockerfile target `test`) against real
  Postgres and MinIO from compose. It creates and uses the database `ensemble_chat_test` and the bucket
  `ensemble-chat-test`, and refuses to run on a database whose name does not end in `_test`.
- `make test-fe` runs `npm ci && npm test && npm run build` (vitest, `tsc --noEmit`, Vite build) in a
  `node:24.15.0-alpine` container.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests: a `backend` job (`make test-be`, real Postgres
and MinIO through compose) and a `frontend` job (`make test-fe`). The example env values are enough for the tests
(they generate their own Fernet key), so CI needs no secrets. The Playwright e2e suite is **not** run in CI because
it needs the Gemini development proxy; run `make e2e` locally before merging UI-affecting changes.

## Releases

Pushing a tag that starts with `v` runs `.github/workflows/release.yml`:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

It builds the `api` and `web` images for `linux/amd64` and `linux/arm64`, pushes them to
`ghcr.io/ensemlabs/peep-api` and `ghcr.io/ensemlabs/peep-web` tagged `0.1.0` and `latest` (a pre-release tag such
as `v0.2.0-rc.1` does not move `latest`), then creates a GitHub Release with generated notes. Users run the images
with `docker-compose.ghcr.yml` (see the README). After the first release, set the two GHCR packages to public.

## End-to-end tests

`make e2e` brings the stack up with `docker-compose.yml`, `docker-compose.gemini.yml` and `docker-compose.e2e.yml`
(it always joins the development provider, whatever `GEMINI` is), waits for `/api/health`, runs the Playwright suite in
`e2e/` in the `e2e` container (Playwright 1.65.0, image `mcr.microsoft.com/playwright:v1.65.0-noble`, browser at
`http://web`), then runs `e2e/check-db.sh`. `make e2e-down` stops the stack. The `ADMIN_EMAIL` and `ADMIN_PASSWORD`
from `.env` are used to sign in as admin.

- **Models file:** `docker-compose.e2e.yml` sets `MODELS_CONFIG=/app/config-e2e/models.e2e.yaml` and mounts `e2e/config/`.
  `e2e/config/models.e2e.yaml` points at the development provider (`gemini-pro`, `usage: estimate`, thinking levels
  Off and High) with `dev.model_switcher: true`, so tests can also pick the `replay:*` demo models
  (`REPLAY_ENABLED=true`). The file holds no secrets; the key comes from `LLM_API_KEY` in `.env`.
- **Throttles:** the overlay raises `IP_LOGIN_MAX` and `REG_MAX` to 1000 so a whole suite from one IP is not
  throttled, keeps `LOGIN_MAX_FAILURES` at 5 so the lockout test works, and adds `http://web` to `APP_ORIGINS`.
- **Projects** (`e2e/playwright.config.ts`): `desktop` (Chromium 1440x900) runs every spec; `tablet` (Chromium
  768x1024) and `mobile` (the iPhone 13 device, WebKit) run only the responsive spec `a10-responsive.spec.ts`.
- **Specs:** `e2e/tests/a01`-`a15` (redirect, pending, login throttle, admin approval, thinking, image, attachments,
  replay agent, reload, responsive, context ring, plugins and skills, sidebar status). Tests that call the real model
  have `@gemini` in their name and are retried once with a long timeout. If the development provider is down, those
  tests fail for reasons unrelated to the app.
- **Filtering:** `ARGS` is passed to `playwright test`, for example `make e2e ARGS="--grep @gemini"`,
  `--grep-invert @gemini` for the replay-only tests, or `--project=desktop`.
- **Database checks** (`e2e/check-db.sh`, run after the suite, a failure fails `make e2e`): every stored password hash
  starts with `$argon2id$` and at least one user exists, and no plugin header value used by the specs is stored in
  plaintext.
- The `@gemini` specs depend on the free development proxy and can be blocked when it hangs. To check everything else,
  run `make e2e ARGS="--grep-invert @gemini"`.
- Playwright's Chromium has no H.264/AAC: playback and seeking tests use WebM and MP3. The mp4 demo file is only
  checked for Range requests and downloads.
- Reports and traces go to `e2e/playwright-report/` and `e2e/test-results/`; ad-hoc screenshots to `e2e/artifacts/`
  (all git-ignored).
- Besides the suite, visual checks across phones, tablets and desktops (light and dark, English and Vietnamese) were
  done with the `playwright-skill` helper; they are not part of `make e2e`.

## Development provider

[dev/llm-proxy.md](dev/llm-proxy.md): how to use the free llm-proxy proxy while developing
and testing, what it does not support, and how the app copes.
