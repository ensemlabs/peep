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

There is no email (no invitations, no reset mails): password resets are done by an admin, or by the user in Settings.
Full guide, including creating accounts, bulk actions, token limits and the audit log: [Account management](#account-management).

## Account management

Admin guide. The admin page is `/admin/users`. Only an `active` admin can open it; anyone else is sent to the home
page and the API answers 403 `forbidden`. Peep sends no email, so you hand every password over yourself.

### Open the admin page

1. Sign in as an admin (the first admin comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD`).
2. Open the account menu (your name at the bottom of the sidebar) and choose **Manage users**.
3. The page has two sections: **Users** and **Audit log**. The Users section has the filters All, Pending, Active
   and Disabled. A badge on Pending counts the people waiting. Search matches name and email.

### Approve new users

People who register themselves start as `pending`: they see the app, but every action is blocked until you approve
them (see above). Open the **Pending** filter and press **Approve** on a row, or use a bulk action. The user's page
unlocks within 30 seconds.

### Create an account

Use this when someone should not self-register, or should be able to sign in at once.

1. Press **Create account**.
2. Fill in email, display name and **Temporary password**. The password must be 10-128 characters and different
   from the email. The wand button generates a random one (16 characters); the copy button copies it.
3. Choose the role (user or admin) and the status: `active` (can use Peep at once) or `pending` (waits for approval).
   The default is a user, active.
4. Press **Create**, then send the email and the temporary password to the person yourself. Peep does not email
   them and does not force a password change; they can change it in **Settings**.

An email that is already registered (in any letter case) is refused. An active account records you as the approver.

### Bulk actions

1. Tick the boxes at the start of the rows, or tick the header box to select every row shown. Your own row has no box.
2. The bar shows how many are selected and offers **Approve**, **Enable**, **Disable** and **Delete**. **Clear**
   drops the selection.
3. Disable and Delete ask for confirmation. After the action, a line shows "N done, M skipped".

| Action | Applies to | Skipped (`no_change`) |
| :--- | :--- | :--- |
| Approve | `pending` users, which become `active` | Everyone else |
| Disable | `pending` and `active` users; their sessions are revoked | Already `disabled` |
| Enable | `disabled` users, which become `active` | Everyone else |
| Delete | Any status | Nothing |

Your own account is always skipped (`self`), and so is an id that no longer exists (`not_found`). One request holds
at most 100 users. All changes of a request are saved in one database transaction, and each user gets an audit entry
tagged **Bulk**.

### Disable or delete

| | Disable | Delete |
| :--- | :--- | :--- |
| Sign-in | Refused with "account disabled" | The account no longer exists |
| Sessions | All revoked at once, so the person is signed out | All removed |
| Conversations and files | Kept | Deleted for good, including the files in storage |
| Token usage history | Kept | Deleted |
| Undo | **Enable** brings the account back as `active` | Not possible |

Disable when someone should lose access for now. Delete only when the data should go too. Deleting a single user
asks you to type the email; bulk delete asks for a plain confirmation. You cannot disable, delete or change the role
of your own account.

### Roles

Row menu (the "..." button): **Make admin** or **Remove admin**. Admins can open the admin page; they cannot read
other users' conversations or files.

### Reset a password

Row menu, **Reset password**: type a new password or press **Generate**, then save and hand it over. The user's
sessions are all revoked, so they sign in again with the new password. A user can also change their own password in
**Settings**.

### Token limits

Row menu, **Token limit**. Choose **Unlimited** (the default for every account) or **Limited**, then enter the
tokens per period (a whole number from 1 to 1,000,000,000,000) and the period, **Day** or **Month**.

- What counts: the total tokens of each finished reply, input plus output (reasoning included). They come from the
  provider's usage or, when the provider sends none (a stopped reply, for example), an estimate. A reply that
  fails before producing anything adds nothing.
- Windows are in UTC: the day starts at 00:00 UTC, the month on the 1st at 00:00 UTC. The sidebar shows the reset
  time in the user's local time.
- The limit is soft. Peep checks it only before a message is sent: if the tokens used in the period have reached the
  limit, the message is refused. A reply that has already started can run past the limit.
- A user with a limit can have only one reply running at a time (in any conversation), so parallel chats cannot
  overshoot it. Users without a limit are not restricted.
- Usage is kept in its own ledger, so deleting conversations does not give tokens back. It is deleted only with the
  user.
- The **Tokens** column shows the usage in the user's current period, with a bar when there is a limit (amber from
  80 percent, red at 100 percent).
- To remove a limit, open the dialog again and choose **Unlimited**. Changing the period starts counting from the new
  window's start at once, because usage is summed per window.
- You cannot set your own limit from this page.

### Audit log

The **Audit log** tab lists what admins did, newest first (50 per page, **Load more** for more). Search matches the
actor's or the target's email; the filter picks one action. Emails are saved as they were, so entries stay readable
after an account is deleted. Entries made by a bulk action carry a **Bulk** tag.

| Action | Shown as | Details |
| :--- | :--- | :--- |
| `user.create` | Created account | Role and status of the new account |
| `user.status` | Changed status | Old status to new status (approve, disable, enable) |
| `user.role` | Changed role | Old role to new role |
| `user.password_reset` | Reset password | None |
| `user.delete` | Deleted account | None |
| `user.quota` | Changed token limit | Old limit to new limit, for example "Unlimited to 500k per month" |

A change that changes nothing (for example setting the status the user already has) writes no entry. The log cannot
be edited or cleared from the app.

## Your token usage

If an admin set a token limit for you, the account menu shows how much you used, for example "Used 120k / 500k
tokens this month", a bar, and when it resets. Without a limit, the menu shows nothing.

When you reach the limit, the message box shows "You've reached your token limit. It resets at ..." and you cannot
send until then; ask an admin to raise the limit if you need to continue earlier. Conversations you already have stay
readable.

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
