# Usage

## First admin and approvals

1. Start the stack with `ADMIN_EMAIL` and `ADMIN_PASSWORD` set and sign in with them.
2. Other people register on the sign-up page. They land in the app with a "waiting for approval" banner, and a
   transparent overlay blocks the whole app except "Log out" and "Check again". The API answers 403
   `account_pending` to everything but `/api/auth/*`. The page checks `/api/auth/me` every 30 seconds and unlocks
   when the account is approved.
3. The admin opens **Manage users** in the account menu (`/admin/users`), searches, and presses Approve. The same page disables
   users, changes roles, resets passwords and deletes users together with their files. Admins cannot change or
   delete their own account.

There is no email: password resets are done by an admin, or by the user in Settings.

## Models

Users chat with the one `active` model from `config/models.yaml`. With `dev.model_switcher: true` the chat header also
shows a model picker with every configured model plus the `replay:*` demo models (`REPLAY_ENABLED=true`). Demo
models replay a recorded event stream and call no LLM.

- `replay:agent-demo` replays an agent building a launch kit for Peep: a thinking block, a plan, `read_file`
  (the brand guide), an `art-director` sub-agent with a nested `web_search` tool and a nested `copywriter`
  sub-agent, `generate_images` returning 5 real Gemini-generated images, `make_clip` returning a short promo
  clip assembled from those images (WebM and MP4), `make_chime` returning a synthesized chime, and a final
  summary with a table and a code block.
- `replay:error-demo` writes some text, runs a `deploy` tool, then ends with an error message.

## Thinking levels

The **Thinking** selector in the composer lists the levels the model defines in `thinking.levels`, and starts at
`thinking.default`. The chosen level is remembered per model in the browser. A model with a single level shows an
"always on" label, and a model without `thinking` shows no selector. The level's `patch` decides what is sent to the
provider (for example `reasoning_effort`). Reasoning text the model streams appears as a live thinking block, if the
model's `read_from` settings say where to find it. Replay models have no levels.

## Plugins and skills

**Settings > Plugins & Skills** (`/settings/integrations`, also in the account menu) is per user.

- **Skills:** upload a `SKILL.md` or a `.zip` with `SKILL.md` at its root. The file needs YAML frontmatter with `name`
  (a-z, 0-9, `-`, up to 64 characters) and `description`. Uploading an existing name asks before replacing it. You can
  view, enable or disable and delete skills.
- **Plugins:** register MCP servers (name, `http` or `sse`, URL, headers) or import a `.mcp.json`. Header values are
  hidden in the list and encrypted in the database.

A banner on the page says it plainly: these are stored for a future agent and the current chat does not use them.
The server never contacts a plugin URL and never runs skill code. Limits and errors: [api.md](api.md#skills).
