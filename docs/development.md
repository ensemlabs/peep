# Development and testing

Notes for working on Peep. Everything runs in Docker. The host needs no Node or Python.

## Make targets

Run `make help` for the list.

| Target | What it does |
| :--- | :--- |
| `make env` | Creates `.env` (with freshly generated secrets, including `SECRETS_KEY`; an existing `.env` is never touched) and `config/models.yaml` if missing. |
| `make up`, `make down` | Start (build if needed) and stop the stack. |
| `make logs`, `make ps`, `make build` | Follow logs, list services, build images. |
| `make test-be` | Backend tests. |
| `make test-fe` | Frontend tests, type check and build. |
| `make e2e`, `make e2e-down` | Playwright suite against the live stack, and stop it. |
| `make clean` | Stop the stack and delete the volumes. |

### Local compose overlay

If `docker-compose.local.yml` exists (it is git-ignored), every `make` target that starts the stack adds it as the last
`-f` file. Use it for machine-specific settings, for example joining an external Docker network where a local
OpenAI-compatible model server runs:

```yaml
# docker-compose.local.yml
services:
  app:
    environment:
      LLM_BASE_URL: http://my-llm-host:8000/v1   # reachable on the network below
    networks: [backend, llm]

networks:
  llm:
    name: my-llm-network   # an existing Docker network
    external: true
```

## Unit tests

- `make test-be` runs `pytest` in the `api-test` container (profile `test`, target `test` of the root `Dockerfile`) against real
  Postgres and MinIO from compose. It creates and uses the database `ensemble_chat_test` and the bucket
  `ensemble-chat-test`, and refuses to run on a database whose name does not end in `_test`.
- `make test-fe` runs `npm ci && npm test && npm run build` (vitest, `tsc --noEmit`, Vite build) in a
  `node:24.15.0-alpine` container.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests: a `backend` job (`make test-be`, real Postgres
and MinIO through compose) and a `frontend` job (`make test-fe`). `make env` generates a throwaway `.env` with random
secrets on the runner (the tests make their own Fernet key), so CI needs no stored secrets. The Playwright e2e suite is **not** run in CI because
part of it needs a live model endpoint; run `make e2e` locally before merging UI-affecting changes.

## Releases

Branches: day-to-day work goes to `dev`; a version is cut as `dev-<version>` from `dev`; a release merges that
branch into `main` and tags the merge (see [CONTRIBUTING.md](../CONTRIBUTING.md#branches-and-releases)).

```bash
git switch dev && git pull && git switch -c dev-v0.1.1 && git push -u origin dev-v0.1.1   # cut the version
# ...wait for CI on dev-v0.1.1 to be green...
git switch main && git pull && git merge --no-ff dev-v0.1.1 -m "release: v0.1.1"
git tag -a v0.1.1 -m "Peep v0.1.1" && git push origin main v0.1.1                          # publish it
```

Pushing a tag that starts with `v` runs `.github/workflows/release.yml`:

It builds the single `Dockerfile` image for `linux/amd64` and `linux/arm64`, pushes it to
`ghcr.io/ensemlabs/peep` tagged `0.1.0` and `latest` (a pre-release tag such
as `v0.2.0-rc.1` does not move `latest`), then creates a GitHub Release with generated notes. Users run the image
with `docker-compose.ghcr.yml` (see the README). After the first release, set the GHCR package to public.

## End-to-end tests

`make e2e` brings the stack up with `docker-compose.yml` and `docker-compose.e2e.yml` (plus `docker-compose.local.yml`
when present), waits for `/api/health`, runs the Playwright suite in
`e2e/` in the `e2e` container (Playwright 1.65.0, image `mcr.microsoft.com/playwright:v1.65.0-noble`, browser at
`http://peep:8000`, a network alias of the `app` service: Chromium upgrades the single-label host `app` to https), then
runs `e2e/check-db.sh`. `make e2e-down` stops the stack. The `ADMIN_EMAIL` and `ADMIN_PASSWORD`
from `.env` are used to sign in as admin.

- **Models file:** `docker-compose.e2e.yml` sets `MODELS_CONFIG=/app/config-e2e/models.e2e.yaml` and mounts `e2e/config/`.
  `e2e/config/models.e2e.yaml` declares one live model (`usage: estimate`, thinking levels Off and High) whose endpoint
  comes from the variables below, with `dev.model_switcher: true`, so tests can also pick the `replay:*` demo models
  (`REPLAY_ENABLED=true`). The file holds no secrets.
- **Live-model specs** (tag `@live-llm`: A5, A6 and one A12 test): they call a real model through any OpenAI-compatible
  endpoint and are **skipped with a message** unless `E2E_LLM_BASE_URL` is set. Set these in `.env` or the shell:
  `E2E_LLM_BASE_URL` (for example `https://api.example.com/v1`, reachable from the `app` container),
  `E2E_LLM_API_KEY` (if the endpoint needs one) and `E2E_LLM_MODEL` (model id; default `live-llm`). The model must
  accept `reasoning_effort: high` for the thinking spec and be able to return an image for A6.
- **Throttles:** the overlay raises `IP_LOGIN_MAX` and `REG_MAX` to 1000 so a whole suite from one IP is not
  throttled, keeps `LOGIN_MAX_FAILURES` at 5 so the lockout test works, and adds `http://peep:8000` to `APP_ORIGINS`.
- **Projects** (`e2e/playwright.config.ts`): `desktop` (Chromium 1440x900) runs every spec; `tablet` (Chromium
  768x1024) and `mobile` (the iPhone 13 device, WebKit) run only the responsive spec `a10-responsive.spec.ts`.
- **Specs:** `e2e/tests/a01`-`a15` (redirect, pending, login throttle, admin approval, thinking, image, attachments,
  replay agent, reload, responsive, context ring, plugins and skills, sidebar status). Tests that call the real model
  have `@live-llm` in their name and are retried with a long timeout. If the endpoint is down, those tests fail for
  reasons unrelated to the app.
- **Filtering:** `ARGS` is passed to `playwright test`, for example `make e2e ARGS="--grep @live-llm"`,
  `--grep-invert @live-llm` for the replay-only tests, or `--project=desktop`.
- **Database checks** (`e2e/check-db.sh`, run after the suite, a failure fails `make e2e`): every stored password hash
  starts with `$argon2id$` and at least one user exists, and no plugin header value used by the specs is stored in
  plaintext.
- The `@live-llm` specs depend on an external endpoint and can be blocked when it hangs. To check everything else,
  run `make e2e ARGS="--grep-invert @live-llm"`.
- Playwright's Chromium has no H.264/AAC: playback and seeking tests use WebM and MP3. The mp4 demo file is only
  checked for Range requests and downloads.
- Reports and traces go to `e2e/playwright-report/` and `e2e/test-results/`; ad-hoc screenshots to `e2e/artifacts/`
  (all git-ignored).
- Besides the suite, visual checks across phones, tablets and desktops (light and dark, English and Vietnamese) were
  done with the `playwright-skill` helper; they are not part of `make e2e`.
