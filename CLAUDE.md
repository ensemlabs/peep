# Peep: notes for coding agents

Peep is a self-hosted chat UI for AI agents: FastAPI + Postgres + MinIO backend (`backend/`), React + Vite frontend
(`frontend/`), one Docker image (root `Dockerfile`), Playwright e2e (`e2e/`). Read `README.md`, `CONTRIBUTING.md`
and `docs/` before changing behaviour.

## Branches and releases (follow exactly)
- Commit and push day-to-day work to `dev`. Never commit directly to `main`.
- When the maintainer decides a version, create `dev-<version>` from `dev` (e.g. `dev-v0.1.1`; git does not allow
  `:` in branch names, and `dev/<version>` cannot coexist with a `dev` branch) and push it.
- When the maintainer decides to publish it: merge `dev-<version>` into `main` with `--no-ff`, tag the merge commit
  `v<version>` (annotated) and push `main` and the tag. The tag triggers `.github/workflows/release.yml`, which
  builds `ghcr.io/ensemlabs/peep` and creates the GitHub Release.
- Only cut, merge or tag when the maintainer asks. Wait for CI to be green on the branch first.

## Rules
- Tests: `make test-be`, `make test-fe`, `make e2e ARGS="--grep-invert @live-llm"`.
- Commits: Conventional Commits (see `CONTRIBUTING.md`).
- Never commit `.env`, `config/models.yaml` or `docker-compose.local.yml`, and never print secrets from them.
- Screenshots and clips may only show fictional `@example.com` users.
- Keep the README free of any mention of local development proxies.
