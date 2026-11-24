# API

HTTP and SSE contract of Peep's `api` service, as implemented in `backend/app/routers/`. The browser reaches it
through nginx on the same origin (`/api/...`). There is no `/docs` or `/openapi.json`.

## Conventions

- JSON bodies, UTF-8. Unknown fields in request bodies are ignored.
- Timestamps are ISO 8601 UTC with a `Z` suffix. Ids are UUIDs, except part ids (12 hex characters).
- Authentication: the cookie `ec_session` (set by register and login). Requests without a valid one get 401.
- State-changing requests (any method except GET, HEAD, OPTIONS) to `/api/*` need an `Origin` header (or
  `Referer` when `Origin` is missing) that matches `APP_ORIGINS`, otherwise 403 `bad_origin`. `/api/health` is exempt.
- Errors always have this shape:

  ```json
  {"error": {"code": "invalid_credentials", "message": "Invalid email or password"}}
  ```

  `message` is English and meant for logs. The web app translates by `code`.

### Access levels

| Level | Meaning | Failure |
| :--- | :--- | :--- |
| public | No cookie needed | |
| session | Any valid session of a user who is not `disabled` | 401 `unauthenticated`, 403 `account_disabled` |
| active | `session` and `status = active` | 403 `account_pending` |
| admin | `active` and `role = admin` | 403 `forbidden` |

Files and conversations belong to one user. Another user's id gives 404 `not_found` (admins use the admin API only).

## Endpoints

| Method | Path | Level | Result |
| :--- | :--- | :--- | :--- |
| GET | `/api/health` | public | 200 `{"status":"ok"}`; 503 `unhealthy` when the database does not answer |
| POST | `/api/auth/register` | public | 201 `{user}` + cookie |
| POST | `/api/auth/login` | public | 200 `{user}` + cookie |
| POST | `/api/auth/logout` | public | 204, cookie cleared |
| GET | `/api/auth/me` | session | 200 `{user}` |
| POST | `/api/auth/password` | session | 204 |
| GET | `/api/admin/users` | admin | 200 `{items:[user], total}` |
| PATCH | `/api/admin/users/{id}` | admin | 200 `{user}` |
| POST | `/api/admin/users/{id}/password` | admin | 204 |
| DELETE | `/api/admin/users/{id}` | admin | 204 |
| GET | `/api/models` | active | 200 `{switchable, active, items}` |
| GET | `/api/context` | active | 200 context usage |
| GET | `/api/conversations` | active | 200 `{items, next_before}` |
| POST | `/api/conversations` | active | 201 `{conversation}` |
| GET | `/api/conversations/{id}` | active | 200 `{conversation, messages}` |
| PATCH | `/api/conversations/{id}` | active | 200 `{conversation}` |
| POST | `/api/conversations/{id}/read` | active | 204 |
| DELETE | `/api/conversations/{id}` | active | 204 |
| POST | `/api/conversations/{id}/messages` | active | SSE stream |
| GET | `/api/messages/{id}/events` | active | SSE stream |
| POST | `/api/messages/{id}/stop` | active | 202 |
| POST | `/api/files` | active | 201 `{file: FileMeta}` |
| GET | `/api/files/{id}/content` | active | 200, 206, 304, 416 |
| GET | `/api/files/{id}/thumb` | active | 200 (webp) |
| DELETE | `/api/files/{id}` | active | 204; 409 `file_in_use` |
| GET | `/api/skills` | active | 200 `{items: [Skill]}` |
| POST | `/api/skills` | active | 201 `{skill}` |
| GET | `/api/skills/{id}` | active | 200 `{skill, files, skill_md}` |
| PATCH | `/api/skills/{id}` | active | 200 `{skill}` |
| DELETE | `/api/skills/{id}` | active | 204 |
| GET | `/api/plugins` | active | 200 `{items: [Plugin]}` |
| POST | `/api/plugins` | active | 201 `{plugin}` |
| POST | `/api/plugins/import` | active | 200 `{created, skipped}` |
| PATCH | `/api/plugins/{id}` | active | 200 `{plugin}` |
| DELETE | `/api/plugins/{id}` | active | 204 |

### Objects

**User**

```json
{"id": "uuid", "email": "a@b.c", "display_name": "Ann", "role": "user|admin",
 "status": "pending|active|disabled", "created_at": "...", "last_login_at": "...|null", "approved_at": "...|null"}
```

**Conversation** (full form): `{id, title, model, created_at, updated_at, pinned}`. `title` is `""` until the first
message. `model` can be `null`. The list returns a different shape, see [GET /api/conversations](#get-apiconversations).

**ModelInfo**

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `id` | string | Model id (`replay:<name>` for demo models) |
| `label` | string | Display name, in the language of the request's `Accept-Language` header (`vi...` gives Vietnamese, otherwise English) |
| `provider` | string | Provider id from the models file; `replay` for demo models |
| `vision` | boolean | Accepts images |
| `context_window` | integer | Tokens |
| `image_tokens` | integer \| null | Estimated tokens per image; `null` when `vision` is false |
| `reasoning` | object \| null | `null` when the model has no thinking levels. Otherwise `{levels: [{id, label}], default, returns_text}` |

**Usage**

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `input_tokens` | integer | Prompt tokens |
| `output_tokens` | integer | Completion tokens (include reasoning tokens) |
| `reasoning_tokens` | integer \| null | Part of the output spent on reasoning, when known |
| `cache_read_tokens` | integer \| null | Prompt tokens served from the provider's cache |
| `cache_write_tokens` | integer \| null | Prompt tokens written to the cache |
| `total_tokens` | integer | `input_tokens + output_tokens` |
| `source` | `provider` \| `estimate` | `provider`: normalised from the provider's `usage`. `estimate`: counted with tiktoken |

Provider usage is read from `prompt_tokens`/`completion_tokens` (or `input_tokens`/`output_tokens`),
`completion_tokens_details.reasoning_tokens`, and for the cache from `prompt_tokens_details.cached_tokens`,
`prompt_cache_hit_tokens` or `cache_read_input_tokens` (read) and `cache_creation_input_tokens` (write). Fields the
provider does not send are `null`. An estimate never has cache fields. If a provider is set to `usage: estimate`, or
returns no usable usage, the estimate is used.

**FileMeta**

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `id` | string | File id |
| `kind` | `image` \| `video` \| `audio` \| `file` | Decided by the server, see [File kinds](#file-kinds) |
| `mime` | string | Stored MIME type |
| `filename` | string | Sanitised name (no path, no control characters, at most 200 characters) |
| `size` | integer | Bytes |
| `width`, `height` | integer | Only present for images |
| `url` | string | `/api/files/{id}/content` |
| `thumb_url` | string | `/api/files/{id}/thumb`; only present when a thumbnail exists (images) |
| `download_url` | string | `/api/files/{id}/content?download=1` |

**Message**

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `id` | string | Message id |
| `role` | `user` \| `assistant` | |
| `content` | string | User text; for the assistant, the root-level `text` parts joined with a blank line |
| `attachments` | FileMeta[] | Files the user uploaded for this message (user messages only) |
| `parts` | Part[] | Part tree of an assistant message (empty for user messages) |
| `status` | `streaming` \| `complete` \| `error` \| `stopped` | |
| `model` | string \| null | Model that answered (assistant messages) |
| `usage` | Usage \| null | Token usage of the reply. `null` for user messages, while streaming, and for runs that failed or were stopped |
| `error` | string \| null | Error text when `status = error` |
| `created_at` | string | |

### Part tree

Parts are what an assistant message is made of. Every part has `id` and `type`. Sub-agents nest parts.

| `type` | Fields |
| :--- | :--- |
| `thinking` | `text`, `status` (`running` \| `done`), `started_at`, `ended_at?` |
| `text` | `text` (markdown) |
| `tool` | `name`, `input` (any JSON), `output` (string or `null`), `files` (FileMeta[]), `status` (`running` \| `done` \| `error`), `started_at`, `ended_at?` |
| `subagent` | `name`, `task`, `status` (`running` \| `done` \| `error`), `parts` (Part[]), `started_at`, `ended_at?` |
| `files` | `files` (FileMeta[]). Used for images the model generated in its answer. |

When a part is created without them, the server fills in: `id` (random), `status: "running"` and `started_at` (for
`thinking`, `tool`, `subagent`), `text: ""`, `input: null`, `output: null`, `files: []`, `name: ""`, `task: ""`,
`parts: []`. A status change to `done` or `error` sets `ended_at` if it is missing. When a run ends, parts still
`running` are closed: `thinking` becomes `done`, others become `done` if the run completed and `error` otherwise.

## Auth

### POST /api/auth/register

Body `{email, password, display_name}`. The email is trimmed and lower-cased. The new user has `status = pending`,
`role = user`, and is signed in at once.

| Status | `code` | When |
| :--- | :--- | :--- |
| 201 | | `{user}` and cookie |
| 422 | `invalid_email` | Not an address, longer than 254 characters, or has whitespace |
| 422 | `invalid_display_name` | Not 1-80 characters after trimming |
| 422 | `weak_password` | Not 10-128 characters, or equal to the email |
| 409 | `email_taken` | Email exists (case-insensitive) |
| 429 | `too_many_attempts` | More than 10 registrations from the IP in an hour |

### POST /api/auth/login

Body `{email, password}`. Every attempt counts towards the per-IP limit. A wrong password or unknown email gives the
same 401. A user with `status = disabled` gets 403 only after a correct password.

| Status | `code` | When |
| :--- | :--- | :--- |
| 200 | | `{user}` and cookie |
| 401 | `invalid_credentials` | Wrong email or password (also passwords over 1024 characters) |
| 403 | `account_disabled` | Correct password, disabled account |
| 429 | `too_many_attempts` | Locked or over a limit, see [Throttling](#throttling) |

### POST /api/auth/logout

Always 204 and clears the cookie. Deletes the session if the cookie was valid.

### GET /api/auth/me

`{user}`. Works for `pending` users (the app polls it). 401 `unauthenticated`, 403 `account_disabled`.

### POST /api/auth/password

Body `{current_password, new_password}`. Revokes all other sessions of the user; the current one stays.

| Status | `code` | When |
| :--- | :--- | :--- |
| 204 | | Changed |
| 400 | `invalid_current_password` | Current password wrong |
| 422 | `weak_password` | New password not 10-128 characters, or equal to the email |
| 429 | `too_many_attempts` | 5 wrong current passwords: locked (key per user) |

### Cookie

`ec_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<SESSION_IDLE_DAYS in seconds>`, plus `Secure` when
`COOKIE_SECURE=true`. The token is 32 random bytes (URL-safe); the database stores only its SHA-256. A session ends
after `SESSION_IDLE_DAYS` without use, or `SESSION_ABSOLUTE_DAYS` after login. The idle timer is extended (and the
cookie re-sent) at most once per `SESSION_REFRESH_SECONDS`.

### Throttling

Stored in the Postgres table `auth_throttle`. Over a limit the API returns 429 `too_many_attempts` with a
`Retry-After` header (seconds, at least 1).

| Key | Counts | Limit | Effect |
| :--- | :--- | :--- | :--- |
| `acct:<email>\|<ip>` | failed logins | `LOGIN_MAX_FAILURES` (5) within `THROTTLE_WINDOW_SECONDS` (15 min) | Lock for `LOCK_BASE_SECONDS` (15 min) x 2^(locks so far), at most `LOCK_MAX_SECONDS` (24 h). A correct login resets it. While locked the right password is refused. |
| `ip:<ip>` | all login attempts | `IP_LOGIN_MAX` (30) per window | 429 until the window ends |
| `reg:<ip>` | registrations | `REG_MAX` (10) per `REG_WINDOW_SECONDS` (1 h) | 429 until the window ends |
| `pw:<user id>` | wrong current passwords | same as `acct` | Lock as for `acct` |

The client IP is the TCP peer. When the peer is inside `TRUSTED_PROXIES`, it is the first address of
`X-Forwarded-For` (nginx overwrites that header with the address it sees).

## Admin

### GET /api/admin/users

Query: `q` (substring of email or display name, case-insensitive), `status` (`pending` \| `active` \| `disabled`),
`limit` (1-100, default 50), `offset` (default 0). Returns `{items: [User], total}`. Pending users come first, then
newest first. A bad `status` gives 422 `invalid_request`.

### PATCH /api/admin/users/{id}

Body `{status?, role?}` (`status`: `pending` \| `active` \| `disabled`; `role`: `user` \| `admin`). Setting `active`
records `approved_at` and the approving admin. Setting `disabled` revokes the user's sessions. Returns `{user}`.

| Status | `code` | When |
| :--- | :--- | :--- |
| 400 | `cannot_modify_self` | The id is the caller's own |
| 404 | `not_found` | No such user |

### POST /api/admin/users/{id}/password

Body `{new_password}`. 204. Revokes all sessions of that user. Errors: 400 `cannot_modify_self`, 404 `not_found`,
422 `weak_password`.

### DELETE /api/admin/users/{id}

204. Deletes the user's stored objects, then the user (conversations, messages, files and sessions cascade). Errors:
400 `cannot_modify_self`, 404 `not_found`.

## Models

### GET /api/models

Send `Accept-Language` so that labels come in the user's language.

```json
{"switchable": false,
 "active": {"id": "my-model", "label": "My Model", "provider": "my-provider", "vision": true,
            "context_window": 128000, "image_tokens": 765,
            "reasoning": {"levels": [{"id": "off", "label": "Off"}, {"id": "high", "label": "High"}],
                          "default": "off", "returns_text": true}},
 "items": ["same as active"]}
```

- `active` is the `active` model of `config/models.yaml` (or of the `LLM_*` fallback).
- `switchable` is `dev.model_switcher`. When it is `false`, `items` holds only `active`. When it is `true`, `items`
  holds every configured model plus the `replay:*` demo models (when `REPLAY_ENABLED=true`).
- Replay models have `provider: "replay"`, `vision: false`, `reasoning: null` and a 128000-token context window.

## Conversations

### GET /api/conversations

Query: `limit` (1-100, default 50), `q` (search, at most 200 characters), `before` (cursor, at most 64 characters).

Returns `{items, next_before}`. Each item:

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `id`, `title`, `model` | | As in Conversation |
| `updated_at` | string | |
| `status` | `idle` \| `streaming` \| `complete` \| `error` \| `stopped` | Status of the last assistant message; `idle` when there is none |
| `unread` | boolean | The last assistant message finished (`complete`, `error` or `stopped`) after the conversation's last read time (see `POST .../read`). Conversations that existed before the update count as read |
| `preview` | string | Up to 100 characters of the last assistant text (or, if none, the last message text), with markdown removed |
| `pinned` | boolean | |

- Order: pinned conversations first, then `updated_at` descending.
- `q` matches the title and the text of any message, case-insensitively (substring).
- Paging: `next_before` is `null` on the last page. Otherwise pass it as `before` to get the next page. Treat it as
  an opaque token (it currently looks like `0~<ISO time>`). A bare ISO 8601 timestamp is still accepted and means
  "unpinned conversations with `updated_at` before this time". A value that is neither gives 422 `invalid_request`.

### POST /api/conversations

Body `{title?, model?}` (`title` at most 200 characters). Without `dev.model_switcher`, `model` is ignored and the
active model is stored. With it, `model` must be one of `/api/models` `items`, otherwise 422 `invalid_model`.
Returns 201 `{conversation}`.

### GET /api/conversations/{id}

Returns `{conversation, messages: [Message]}`, oldest first (user message before its assistant message).

### PATCH /api/conversations/{id}

Body `{title?, pinned?}`. `title`: at most 200 characters, not blank. At least one field is required, otherwise 422
`invalid_request`. Returns `{conversation}`.

### POST /api/conversations/{id}/read

204. Sets the conversation's last read time to now, which clears `unread`. The web app calls it when you open a
conversation and when a reply finishes while it is open.

### DELETE /api/conversations/{id}

204. Deletes the conversation, its messages and its files (also from storage). 409 `run_in_progress` while a reply is
being generated.

## Sending a message

### POST /api/conversations/{id}/messages

Body:

| Field | Type | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `content` | string | `""` | At most 100000 characters |
| `attachment_ids` | UUID[] | `[]` | At most 32 files uploaded with `POST /api/files`. Duplicates are dropped. |
| `model` | string | the active model | Only honoured with `dev.model_switcher` (then it must be one of `/api/models` `items`, default: the conversation's model, then the active one). Otherwise ignored |
| `reasoning` | string | the model's default level | Thinking level id from the model's `reasoning.levels` (at most 32 characters) |

`reasoning` semantics:

- Omitted or `null`: the model's `reasoning.default` level.
- A model without thinking levels (`reasoning: null`, including every `replay:*` model) ignores the field, whatever its value.
- A model with levels and an id that is not one of them: 422 `invalid_reasoning_level`. The old values `off` and
  `high` are only accepted when the model has levels with those ids.
- The level's `patch` from the models file is merged into the provider request.

Effects: stores the user message and an empty assistant message (`status: streaming`), attaches the files, sets the
conversation title (first 60 characters of the text with whitespace collapsed, or the first attachment's file name)
if it has none, stores the model on the conversation, and starts the run. The response is an SSE stream, see
[SSE protocol](#sse-protocol). Closing the connection does not stop the run.

| Status | `code` | When |
| :--- | :--- | :--- |
| 200 | | SSE stream |
| 404 | `not_found` | Not your conversation |
| 409 | `file_in_use` | The file is attached to a message (or generated) and cannot be deleted |
| 409 | `run_in_progress` | This conversation already has a running reply |
| 422 | `empty_message` | No text (after trimming) and no attachment |
| 422 | `invalid_model` | Unknown model (only with `dev.model_switcher`) |
| 422 | `invalid_reasoning_level` | The model has no such thinking level |
| 422 | `invalid_attachment` | A file id is not yours, already attached to a message, or belongs to another conversation |
| 422 | `invalid_request` | Body fails validation (for example content too long, `reasoning` longer than 32 characters) |

### GET /api/messages/{id}/events

Re-attach to a reply. If the run is live in this process, the stream starts with `snapshot` and continues with live
events until `done`. Otherwise it sends `snapshot` (from the database) and `done` and ends. 404 `not_found` for a
message that is not yours.

### POST /api/messages/{id}/stop

Cancels the run. Returns 202 (also when nothing is running). The stream then ends with `done` and `status: "stopped"`.

## SSE protocol

Responses have `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`. Each event
is

```
event: <name>
data: <one line of JSON>

```

The server sends a `: ping` comment line after 15 seconds without events, to keep proxies open. Clients ignore it.

| Event | `data` | When |
| :--- | :--- | :--- |
| `message` | `{user_message, assistant_message}` | First event of `POST .../messages`. Both are Message objects. |
| `snapshot` | `{message}` | First event of `GET /api/messages/{id}/events`. The full current assistant Message. |
| `part` | `{message_id, parent_id, part}` | A part was created. `parent_id` is `null` for a root part, or the id of the `subagent` that contains it. `part` is the complete part. |
| `delta` | `{message_id, part_id, field, text}` | Text appended to `part[field]`. `field` is `text` (thinking, text) or `output` (tool). |
| `update` | `{message_id, part_id, patch}` | Fields merged into the part, for example `{"status": "done"}` or `{"status": "done", "files": [FileMeta]}`. |
| `usage` | `{message_id, usage}` | Token usage of the reply (a Usage object), sent once after the model finished successfully and before `done`. Not sent when the run fails or is stopped. |
| `done` | `{message_id, status, error?}` | Last event. `status` is `complete`, `error` or `stopped`; `error` holds the text on failure. |

Clients build the message by applying events in order (the web app does this in
`frontend/src/features/chat/applyEvent.ts`). After `done`, or if the connection drops without it, reload the
conversation with `GET /api/conversations/{id}` to get the stored result. A run that fails ends normally with
`done` and `status: "error"`; it is not an HTTP error. Errors before the stream starts (4xx above) are normal JSON
responses.

Example (shortened):

```
event: message
data: {"user_message":{"id":"...","role":"user","content":"hi","attachments":[],"parts":[],"status":"complete",...},"assistant_message":{"id":"A1","role":"assistant","status":"streaming","parts":[],...}}

event: part
data: {"message_id":"A1","parent_id":null,"part":{"id":"t1","type":"thinking","text":"","status":"running","started_at":"..."}}

event: delta
data: {"message_id":"A1","part_id":"t1","field":"text","text":"Let me think"}

event: update
data: {"message_id":"A1","part_id":"t1","patch":{"status":"done","ended_at":"..."}}

: ping

event: done
data: {"message_id":"A1","status":"complete"}
```

## Context

### GET /api/context

Query: `conversation_id` (optional; without it the numbers are for a new chat). 404 `not_found` when it is not yours.
Returns what the next request in the conversation would send:

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `model_id` | string | The model that would answer (the active model, or the conversation's model with `dev.model_switcher`) |
| `context_window` | integer | Tokens |
| `used_tokens` | integer | Tokens in use, see below |
| `free_tokens` | integer | `max(0, context_window - used_tokens)` |
| `estimated` | boolean | `true` when `used_tokens` is a tiktoken estimate, `false` when it comes from the provider |
| `breakdown` | array | Always six entries in this order, `{key, tokens, items?}`: `system`, `user_messages`, `assistant_messages`, `attachments`, `tool_results`, `skills` |
| `last_usage` | Usage \| null | Usage of the latest assistant message that has one |
| `totals` | object | `{input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, messages}`: sums over the conversation's assistant messages that have usage (`messages` counts them; missing values count as 0) |

- The breakdown is always a tiktoken estimate (`o200k_base`, times the model's `token_ratio`) of the same turns the
  chat sends: earlier messages as text (thinking and tool output are not resent), plus the pending draft
  attachments. `system`, `tool_results` and `skills` are always 0 for now.
- `attachments.items` lists `{name, tokens}`: each image counts the model's `image_tokens`, each other file the text
  line sent in its place.
- Draft attachments are files you uploaded but have not sent yet, from the last 24 hours. With `conversation_id`
  only uploads made for that conversation count; without it, only uploads that have no conversation. They count in
  `attachments`. `DELETE /api/files/{id}` removes a draft.
- `used_tokens` is the sum of the breakdown, except when the last message of the conversation is an assistant message
  whose usage has `source: "provider"` and there are no draft attachments. Then `used_tokens = input_tokens +
  output_tokens - reasoning_tokens` of that usage (the provider's real count; reasoning is not resent) and `estimated`
  is `false`. In that case `used_tokens` can differ from the sum of the breakdown.

## Skills

Per user. Stored in S3 (`u/<user id>/skills/<skill id>/...`) and the database. Nothing is executed and the chat does
not use skills yet.

**Skill**: `{id, name, description, version, enabled, size, file_count, created_at, updated_at}` (`version` is a string
or `null`; `size` is the unpacked size in bytes).

### POST /api/skills

`multipart/form-data` with a `file` part: a `SKILL.md` (`.md`) or a `.zip`. Query `replace=true` overwrites a skill with
the same name (it keeps its `enabled` state). Returns 201 `{skill}`.

- `SKILL.md` (at the archive root, or inside the single top folder of a zip) must be UTF-8, at most 1 MB, and start
  with YAML frontmatter delimited by `---`: `name` (1-64 characters of `a-z`, `0-9`, `-`; unique per user),
  `description` (1-1024 characters), and optionally `version` (string or number).
- Limits: upload at most 5 MB; unpacked at most 20 MB; at most 200 files. Rejected: absolute paths, `..`, backslashes,
  symbolic links, encrypted or duplicate entries, other extensions than `.md` and `.zip`.

| Status | `code` | When |
| :--- | :--- | :--- |
| 422 | `invalid_skill` | Any of the rules above is broken (the `message` says which) |
| 409 | `skill_exists` | The name exists and `replace` is not `true` |
| 413 | `file_too_large` | Upload over 5 MB |

### GET /api/skills, GET /api/skills/{id}

The list is sorted by name. The detail returns `{skill, files: [{path, size}], skill_md}` (`skill_md` is the text of
`SKILL.md`).

### PATCH /api/skills/{id}

Body `{enabled}` (boolean). Returns `{skill}`.

### DELETE /api/skills/{id}

204. Deletes the stored files too. Another user's skill gives 404 `not_found`.

## Plugins

Per user. Registrations of MCP servers. They are **only stored**: the API never connects to the URL, and the chat does
not use them yet.

**Plugin**: `{id, name, description, transport, url, headers, enabled, created_at, updated_at}`.
`transport` is `http` or `sse`. `headers` is `[{name, value_masked}]`; the value is always the mask `••••••••`. The real
values are encrypted with Fernet (`SECRETS_KEY`) and never returned.

### POST /api/plugins

Body `{name, description?, transport, url, headers?: [{name, value}]}`. Returns 201 `{plugin}`.

- `name`: 1-64 characters of letters, digits, space, `_`, `-`; unique per user, case-insensitively.
- `description`: up to 500 characters (longer is cut).
- `url`: `http` or `https`, at most 2048 characters, no whitespace, no credentials in the URL (use a header).
- `headers`: at most 20. `name` is an HTTP token (at most 64 characters), unique case-insensitively. `value` is at
  most 4096 characters, without control characters.
- At most 100 plugins per user.

| Status | `code` | When |
| :--- | :--- | :--- |
| 422 | `invalid_plugin` | A rule above is broken |
| 422 | `too_many_plugins` | 100 plugins already |
| 409 | `plugin_exists` | The name is taken |
| 503 | `secrets_not_configured` | There are header values to store but `SECRETS_KEY` is not set or invalid |

### PATCH /api/plugins/{id}

Any of `name`, `description`, `transport`, `url`, `headers`, `enabled`. Omitted fields are kept. `headers`, when
sent, replaces the whole list; an entry with `value: null` keeps the stored value of the header with the same name
(422 `invalid_plugin` if there is none). Same errors as POST, plus 409 `plugin_exists` on rename.

### DELETE /api/plugins/{id}

204.

### POST /api/plugins/import

`multipart/form-data` with a `file` part: a `.mcp.json` (`{"mcpServers": {"name": {"url": ..., "type": "http|sse",
"headers": {...}}}}`), at most 1 MB and 50 servers. Returns `{created: [Plugin], skipped: [{name, reason}]}`.
Entries without a `url` (stdio servers), with a name that already exists, that are invalid, or beyond the 100-plugin
limit are skipped. A `type` or `transport` of `sse` gives `sse`, anything else `http`. Names are cleaned to the
allowed characters. A file that is not JSON or has no `mcpServers` object gives 422 `invalid_plugin`; a missing
`SECRETS_KEY` with headers present gives 503 `secrets_not_configured`.

## Files

### POST /api/files

`multipart/form-data` with a `file` part and an optional `conversation_id` field (a conversation of yours). Only the
first file part is used. Other fields are limited to 4096 bytes. The file is stored in S3 and a row is created that is
not yet attached to a message; pass its `id` in `attachment_ids` when sending. Returns 201 `{file: FileMeta}`.

| Status | `code` | When |
| :--- | :--- | :--- |
| 413 | `file_too_large` | Over `MAX_UPLOAD_MB` (checked while streaming) |
| 415 | `unsupported_type` | The file has no name |
| 422 | `empty_file` | Zero bytes |
| 422 | `invalid_request` | Not multipart, no `file` part, malformed body, oversized form field, or `conversation_id` not a UUID |
| 404 | `not_found` | `conversation_id` is not yours |

Any other file type is accepted and stored as kind `file`.

#### File kinds

- `image`: Pillow verifies it (PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF; at most 100 million pixels). The stored MIME
  is the detected one. `width`, `height` and a WebP thumbnail (at most 768 px on the long side) are stored.
- `video`: MIME `video/*` and extension `mp4`, `webm`, `mov`, `mkv`, `ogv`, `m4v`.
- `audio`: MIME `audio/*` and extension `mp3`, `wav`, `ogg`, `oga`, `opus`, `m4a`, `aac`, `flac`, `weba`, `webm`.
- `file`: everything else. SVG, HTML, XML and JavaScript are stored as `application/octet-stream`. A file that claims
  an image, video or audio type but fails the checks is also stored as `application/octet-stream`.

Object keys in S3: `u/<user id>/<file id>/<file name>` and `thumbs/<file id>.webp`.

### GET /api/files/{id}/content

Query: `download=1` forces a download. Request headers: `Range`, `If-None-Match`.

Response headers: `Content-Type`, `Accept-Ranges: bytes`, `ETag: "<sha256>"`, `Cache-Control: private, max-age=3600`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition`,
and for partial responses `Content-Range`.

- `Content-Disposition` is `inline` for kinds `image`, `video`, `audio` and `attachment` for everything else or
  with `download=1`. It always carries `filename` (ASCII fallback) and `filename*=UTF-8''...`.
- Range: one range `bytes=a-b`, `bytes=a-` or `bytes=-n` gives 206 with `Content-Range: bytes a-b/size`. A range
  starting past the end, or `bytes=-0`, gives 416 with `Content-Range: bytes */size`. Multiple ranges and
  malformed values are ignored and the whole file is sent with 200. `If-Range` is not evaluated.
- `If-None-Match` equal to the ETag (or `*`) gives 304.
- 404 `not_found` for another user's file, or when the object is missing from storage.

### GET /api/files/{id}/thumb

WebP thumbnail (`Content-Disposition: inline`, ETag `"<sha256>-thumb"`, same security headers). 404 `not_found`
when the file is not an image or has no thumbnail.

### DELETE /api/files/{id}

Removes an upload the user has not sent yet (for example when they drop an attachment chip). Returns 204; the
database row is deleted first, then the object and thumbnail from storage (best effort). 404 `not_found` for another
user's file. 409 `file_in_use` once the file is attached to a message or was generated by a run: those files stay.
A deleted draft no longer counts in `GET /api/context`.

## Error codes

| HTTP | `code` | Meaning |
| :--- | :--- | :--- |
| 400 | `cannot_modify_self` | An admin tried to change or delete their own account |
| 400 | `invalid_current_password` | Wrong current password |
| 400 | `bad_request` | Generic 400 |
| 401 | `unauthenticated` | No valid session |
| 401 | `invalid_credentials` | Wrong email or password |
| 403 | `bad_origin` | `Origin`/`Referer` not in `APP_ORIGINS` |
| 403 | `account_pending` | Account not yet approved |
| 403 | `account_disabled` | Account disabled |
| 403 | `forbidden` | Admin only |
| 404 | `not_found` | Unknown route, or a resource that is not yours or does not exist |
| 405 | `method_not_allowed` | |
| 409 | `email_taken` | Email already registered |
| 409 | `run_in_progress` | A reply is being generated in this conversation |
| 409 | `skill_exists` | A skill with this name exists (use `replace=true`) |
| 409 | `plugin_exists` | A plugin with this name exists |
| 413 | `file_too_large` | Upload over `MAX_UPLOAD_MB` (skill upload over 5 MB, plugin import over 1 MB) |
| 415 | `unsupported_type` | Upload without a file name |
| 422 | `invalid_request` | Validation failure; `message` lists `field: problem` |
| 422 | `invalid_email` | Bad email address |
| 422 | `invalid_display_name` | Display name not 1-80 characters |
| 422 | `weak_password` | Password not 10-128 characters, or equal to the email |
| 422 | `invalid_model` | Model not available |
| 422 | `empty_message` | Message without text or attachment |
| 422 | `invalid_reasoning_level` | The model has no such thinking level |
| 422 | `invalid_attachment` | Attachment not usable |
| 422 | `invalid_skill` | Skill upload rejected |
| 422 | `invalid_plugin` | Plugin or `.mcp.json` rejected |
| 422 | `too_many_plugins` | Plugin limit (100) reached |
| 422 | `empty_file` | Zero-byte upload |
| 429 | `too_many_attempts` | Throttled; has `Retry-After` |
| 500 | `internal_error` | Unhandled error (details only in the server log) |
| 503 | `secrets_not_configured` | `SECRETS_KEY` is not set or invalid and a plugin header must be stored |
| 503 | `unhealthy` | `/api/health` and the database is down |

Other HTTP statuses map to `http_error`.

## Replay fixtures

`replay:<name>` models play `backend/app/replay/fixtures/<name>.json` through the same emit calls a real provider
uses, so the UI cannot tell them apart. This is the quickest way to see how a real agent should emit events.

```json
{
  "error": "optional text: the run ends with this error after the last step",
  "steps": [
    {"after_ms": 300, "op": "part", "part": {"id": "think1", "type": "thinking", "text": "", "status": "running"}},
    {"after_ms": 0, "op": "delta", "part_id": "think1", "field": "text", "text": "..."},
    {"after_ms": 600, "op": "update", "part_id": "think1", "patch": {"status": "done"}},
    {"after_ms": 600, "op": "part", "parent": "sa1", "part": {"id": "sa1-search", "type": "tool", "name": "web_search", "input": {}, "status": "running"}},
    {"after_ms": 400, "op": "update", "part_id": "imgs", "patch": {"status": "done", "files": ["asset:gallery-1.png"]}}
  ]
}
```

| Field | Meaning |
| :--- | :--- |
| `steps[].after_ms` | Wait before the step, in milliseconds (default 0). Multiplied by `REPLAY_TIME_SCALE`; `0` skips waiting. |
| `steps[].op` | `part` (create), `delta` (append) or `update` (patch). Same meaning as the SSE events. |
| `steps[].part` | For `part`: a Part with a unique `id` and a `type` in `thinking`, `text`, `tool`, `subagent`, `files`. |
| `steps[].parent` | For `part`: id of an earlier `subagent` part to nest under. Omit for the root. |
| `steps[].part_id` | For `delta` and `update`: id of a part created by an earlier step. |
| `steps[].field` | For `delta`: `text` or `output`. |
| `steps[].text` | For `delta`: the text to append. |
| `steps[].patch` | For `update`: fields to merge (non-empty). |
| `error` | Optional. After the last step the run ends with `status: "error"` and this text. |

- Files: in `part.files` or `patch.files`, the string `"asset:<name>"` refers to `backend/app/replay/assets/<name>`.
  The first time a run uses an asset, it is stored (S3 and a `files` row, like any generated file) and the string is
  replaced by its FileMeta. See `backend/app/replay/assets/README.md` for how the assets were made.
- Validation (at load time, unknown keys are rejected): `after_ms >= 0`; `part` steps need an id and a valid type;
  `parent` and `part_id` must refer to an earlier step; every `asset:` file must exist.
- Shipped fixtures: `agent-demo` (thinking, tools, nested sub-agents, 5-image gallery, video, audio) and
  `error-demo` (text, a tool, then an error).

To plug a real agent in, add a provider with `async def run(ctx)` (`backend/app/providers/base.py`) that calls
`ctx.emit_part(part, parent_id)`, `ctx.emit_delta(part_id, field, text)`, `ctx.emit_update(part_id, patch)` and
`ctx.store_file(bytes, mime, filename)` (returns a FileMeta), and select it in
`backend/app/routers/conversations.py`. Raise `ProviderError(text)` to end the run with an error shown to the user.
