<p align="center">English | <a href="README.vi.md">Tiếng Việt</a></p>

<p align="center"><img src="docs/images/peep.svg" alt="Peep, the yellow chick mascot, waving hello" width="140"></p>

<h1 align="center">Peep</h1>

<p align="center"><img src="docs/images/peep-mark.svg" alt="Ensemble Labs" width="18" valign="middle">&nbsp;<sub>by Ensemble Labs</sub></p>

<p align="center">A ChatGPT-style web UI for AI agents: watch them think, call tools and make things, live.</p>

<p align="center"><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a></p>

<p align="center"><img src="docs/images/hero-dark.jpg" alt="Peep in dark theme: a prompt, a Thought row, a plan, tool and sub-agent rows, and a gallery of five AI-generated images" width="100%"></p>

<p align="center"><sub><i>One agent run, live: thinking, a plan, tools, a sub-agent and generated images. Demo media were made with Gemini.</i></sub></p>

## What is Peep

Peep is a self-hosted chat web app that shows the whole run of an AI agent, not only its final answer: thinking, tool
calls, sub-agents, images, video, audio and how much of the context window is used, all streaming live. It works with
any OpenAI-compatible chat API (OpenAI, Gemini, DeepSeek, Anthropic compat, OpenRouter, vLLM, Ollama and others).
Peep is a UI: it has no agent logic of its own yet, and ships recorded demo runs so you can see every part of it
without a model.

## Highlights

**Conversation**
- Thinking streams into a quiet row and collapses to "Thought for 12s". Tool calls and nested sub-agents are inline
  rows with input and output; images, video and audio appear right in the flow.
- Markdown, syntax-highlighted code with Copy, and LaTeX math.
- Per-model thinking levels (Off, Low, High, ...) defined in your config, a Stop button, and replies that keep
  running if you close the tab.
- Attach images, video, audio and files; browse images in a zoom lightbox.
- The demo you see in the screenshots uses real AI output: the pictures were generated with Gemini and the short clip is
  assembled from them.

**Know where you are**
- A context gauge shows how much of the model's context window is used, with a breakdown and cache tokens.
- The sidebar shows which chats are running, unread or failed, with search and pinning.

**Everyone gets in safely**
- Email and password accounts. New accounts wait for an admin to approve them in the admin page.
- Plugins and Skills page: users store MCP server entries and skill packages for a future agent (not used by the
  chat yet). Plugin secrets are encrypted at rest.

**Everywhere**
- Phone, tablet and desktop; installable as a PWA.
- Vietnamese and English, light and dark theme.
- Peep, the yellow chick, greets you in a new chat and keeps you company while a reply is on its way.

## Screenshots

<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/hero-light.jpg" alt="Light theme: a demo agent run with a Thought row, plan, tool rows and an image gallery" width="100%"><br><b>Light and dark</b><br><sub>Both themes, same layout.</sub></td>
<td width="50%" valign="top"><img src="docs/images/gallery-lightbox.jpg" alt="Image lightbox on a sticker sheet of the Peep mascot, with thumbnails and zoom" width="100%"><br><b>Gallery and lightbox</b><br><sub>Zoom, step through, download.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/images/empty-peep.jpg" alt="A new chat: Peep greets the user above the composer and suggestion cards" width="100%"><br><b>A new chat</b><br><sub>Peep says hello; one tap to start.</sub></td>
<td width="50%" valign="top"><img src="docs/images/thinking-live.jpg" alt="The Thinking row streaming its reasoning live, with a running spinner in the sidebar" width="100%"><br><b>Live thinking</b><br><sub>Reasoning streams in as it happens.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/images/context-ring.jpg" alt="Context ring popover: token breakdown, last response and conversation totals" width="100%"><br><b>Context ring</b><br><sub>See what fills the context window.</sub></td>
<td width="50%" valign="top"><img src="docs/images/video-clip.jpg" alt="A video card playing an 8-second clip in the conversation" width="100%"><br><b>Video in the flow</b><br><sub>Seekable player, download included.</sub></td>
</tr>
<tr>
<td colspan="2" align="center" valign="top"><img src="docs/images/integrations.jpg" alt="Settings, Plugins and Skills tab with skill packages and MCP servers" width="50%"><br><b>Plugins &amp; Skills</b><br><sub>Stored for a future agent.</sub></td>
</tr>
</table>

**On your phone**

<table>
<tr>
<td align="center" valign="top"><img src="docs/images/mobile-empty.jpg" alt="Phone, dark theme: new chat with Peep" width="260"><br><b>New chat</b><br><sub>Dark theme.</sub></td>
<td align="center" valign="top"><img src="docs/images/mobile-chat.jpg" alt="Phone, light theme: demo run with tool rows and gallery" width="260"><br><b>Conversation</b><br><sub>Rows and media fit the screen.</sub></td>
<td align="center" valign="top"><img src="docs/images/mobile-drawer.jpg" alt="Phone: the sidebar drawer with pinned, unread and failed chats" width="260"><br><b>Drawer</b><br><sub>Search, pin, status dots.</sub></td>
</tr>
</table>

## Quick start

You need Docker with Compose v2.

```bash
git clone git@github.com:ensemlabs/peep.git && cd peep
cp .env.example .env
cp config/models.example.yaml config/models.yaml
```

1. Edit `.env`: replace every `change-me` (database, MinIO, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) and set `SECRETS_KEY`:

   ```bash
   python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Keep that key: without it, stored plugin headers cannot be read.
2. Edit `config/models.yaml`: point `active` at a model of your provider (the file has presets to copy), and put the
   provider's API key in `.env` under the name given by `api_key_env`.
3. Start it:

   ```bash
   make up
   ```

4. Open http://127.0.0.1:8090 and log in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

`make up` also creates the two files if they are missing. After changing `config/models.yaml`, run
`docker compose restart api`. The built-in `replay:*` demo runs need no provider (see [docs/usage.md](docs/usage.md)).

## Configuration

Peep reads its models from `config/models.yaml`. Users get the `active` model:

```yaml
active: my-model
providers:
  - id: my-provider
    base_url: https://api.example.com/v1
    api_key_env: MY_PROVIDER_API_KEY   # name of a variable in .env; keys never go in this file
    models:
      - id: my-model
        upstream: provider-model-name
        context_window: 128000
        thinking:                       # optional
          default: "off"
          levels:
            - {id: "off",  label: Off, patch: {}}
            - {id: high, label: High, patch: {reasoning_effort: high}}
```

[`config/models.example.yaml`](config/models.example.yaml) has presets for OpenAI, Gemini, DeepSeek, Anthropic compat,
OpenRouter and vLLM/Ollama. Provider settings change, so check each preset against the provider's documentation.

The variables you will most likely touch:

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | empty | First admin, created on startup |
| `SECRETS_KEY` | empty | Fernet key for plugin secrets |
| `APP_ORIGINS` | `http://localhost:8090,http://127.0.0.1:8090` | Allowed origins; add your public URL |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `WEB_PORT` | `8090` | Host port, bound to `127.0.0.1` |
| `MAX_UPLOAD_MB` | `200` | Upload limit |
| `MODELS_CONFIG` | `/app/config/models.yaml` | Models file inside the container |

Everything else (sessions, login throttling, S3, replay): [docs/configuration.md](docs/configuration.md).

Internal names keep the project's earlier name: the Docker Compose project, database and bucket are `ensemble-chat`
/ `ensemble_chat`, the session cookie is `ec_session`, and browser settings use `ec_*` keys in `localStorage`.

## Architecture

```
browser ── web (nginx: SPA + /api proxy, the only published port)
              └── api (FastAPI, one worker)
                     ├── postgres   users, chats, messages, plugins, skills
                     ├── minio      uploaded and generated files (S3)
                     └── LLM        any OpenAI-compatible endpoint
```

Details and request flow: [docs/architecture.md](docs/architecture.md). HTTP and SSE contract:
[docs/api.md](docs/api.md). Why this stack: [ADR 0001](docs/adr/0001-tech-stack.md).

## Development and testing

| Command | What it does |
| :--- | :--- |
| `make up` / `make down` | Start and stop the stack |
| `make logs`, `make ps`, `make build` | Logs, status, build images |
| `make test-be` | Backend tests against real Postgres and MinIO |
| `make test-fe` | Frontend tests, type check and build |
| `make e2e` | Playwright suite against the live stack |
| `make clean` | Stop and delete all data volumes |

`make help` lists everything. More in [docs/development.md](docs/development.md).

## Security

- Passwords are hashed with argon2id. Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie; only a
  hash is stored. Mutating requests must come from an allowed origin (CSRF check).
- Login attempts are throttled: 5 failures lock an email and IP pair for 15 minutes, doubling up to 24 hours.
- Files are only readable by their owner. Only verified images, video and audio display inline; everything else
  downloads, with `nosniff` and a locked-down CSP.
- Plugin header values are encrypted at rest (Fernet) and never returned. Peep never calls plugin URLs or runs skill
  code.
- Never commit `.env` or `config/models.yaml`.

Full list and numbers: [docs/configuration.md](docs/configuration.md) and [docs/api.md](docs/api.md#auth).

## Roadmap and limitations

- Peep runs one API worker: replies live in the process, so a restart marks running replies as interrupted.
  Scaling out needs a shared event bus.
- Plugins and Skills are stored but not used by the chat yet: connecting a real agent backend is the next step.
- No SSO, email verification or password-reset emails; an admin resets passwords.
- Uploads are not virus-scanned and have no per-user quota.
- The PWA has no service worker, so there is no offline mode.

## License

MIT, see [LICENSE](LICENSE). © 2026 Ensemble Labs.
