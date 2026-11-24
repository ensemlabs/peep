# Contributing to Peep

Thanks for helping. Peep is MIT licensed; by contributing you agree your work is released under the same license.
For anything bigger than a small fix, open an issue or a Discussion first so we can agree on the approach.

## Dev setup

You need Docker with Compose v2. Nothing else runs on the host (no Node or Python).

```bash
git clone git@github.com:ensemlabs/peep.git && cd peep
make env     # creates .env and config/models.yaml from the examples
# edit .env: set SECRETS_KEY and replace the change-me values (see the README quick start)
make up      # build and start the stack at http://127.0.0.1:8090
make down
```

`make help` lists every target. Never commit `.env` or `config/models.yaml`. More in
[docs/development.md](docs/development.md).

## Tests

Run these before opening a pull request:

| Command | What it checks |
| :--- | :--- |
| `make test-be` | Backend tests (pytest against real Postgres and MinIO) |
| `make test-fe` | Frontend unit tests, type check and build |

CI runs both on every pull request. Add or update tests for new behaviour and bug fixes.

The Playwright suite (`make e2e`) is **not** run in CI: part of it needs a live model endpoint (those specs skip without one). Run it locally if
you change user-visible flows, or say in the pull request that you did not. See the end-to-end section of
[docs/development.md](docs/development.md).

## Commits

The history uses Conventional Commits: `type(scope): short summary` in lower case, no trailing period.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- Scopes: `backend`, `frontend`, `e2e` (or none for repo-wide changes).
- Examples: `feat(backend): per-user token limits`, `fix(frontend): 4:3 gallery tiles`, `docs: account management guide`.

## Branches and releases

```
dev            day-to-day work: commits and pull requests go here
 └─ dev-v0.1.1 cut from dev when a version is decided (dev-<version>)
      └─ merged into main, then main is tagged v0.1.1 → image + GitHub Release
```

- Open pull requests against `dev`, not `main`. `main` only ever receives merges from a `dev-<version>` branch, so
  it always matches the latest release.
- To cut a version: `git switch dev && git pull && git switch -c dev-v0.1.1 && git push -u origin dev-v0.1.1`.
  Fixes for that version go on `dev-v0.1.1` (and back into `dev`).
- To publish it: merge `dev-v0.1.1` into `main` with `--no-ff`, tag the merge commit `v0.1.1` and push the tag
  (see [docs/development.md](docs/development.md#releases)). Version tags follow semver: `vMAJOR.MINOR.PATCH`.

## Pull requests

- Target `dev`. Keep a pull request to one change; unrelated cleanups go in their own.
- Fill in the template: what and why, how you tested it, screenshots for UI changes.
- Update the docs (and the Vietnamese README if you touch the English one) when behaviour changes.
- Tests pass, and no secrets, `.env` files or generated artifacts are included.
- Be kind in reviews. A maintainer merges once CI is green and the review is done.

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
