# Google Calendar Integration Design

## Goal

Automatically create, update, and delete Google Calendar events when crew members are assigned to booked jobs, keeping each crew member's personal calendar accurate as job details evolve.

## Architecture

OAuth 2.0 with offline refresh token stored in the existing `app_settings` key-value table. One Google Calendar event per job (not per assignment); all assigned crew are attendees on that single event. The company Gmail account is the event organizer. All calendar operations are fire-and-forget — errors are logged but never block the primary operation.

**Tech stack additions:** `google-auth-oauthlib`, `google-api-python-client`

---

## Components

### 1. OAuth Setup (one-time)

**Backend — two new endpoints under `/admin/google`:**

- `GET /admin/google/connect` — Builds the Google OAuth consent URL (scopes: `calendar.events`) using credentials from `.env`, returns it as JSON. Requires `admin` role.
- `GET /admin/google/callback?code=...&state=...` — Exchanges the authorization code for tokens, writes `google_refresh_token` to `app_settings`, discards the access token (it will be re-fetched on demand). Requires `admin` role.

**Environment variables added to `.env` / `.env.example`:**
```
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/admin/google/callback
```

The refresh token is stored in `app_settings` under key `google_refresh_token`. It is read by `calendar_service.py` at call time — no in-process caching, so a revoke + reconnect takes effect immediately.

**Frontend — Settings page:**
A "Connect Google Calendar" button calls `GET /admin/google/connect`, receives the consent URL, and opens it in a new tab. After the admin completes the OAuth flow, a status indicator on the settings page confirms the connection (a `GET /admin/google/status` endpoint returns `{ connected: bool }`).

---

### 2. `calendar_service.py`

New file at `app/backend/app/services/calendar_service.py`. Responsible for all Google Calendar API interactions.

**Public interface:**

```python
async def create_event(db: AsyncSession, lead: Lead, crew_emails: list[str]) -> str | None
async def update_event(db: AsyncSession, event_id: str, lead: Lead, crew_emails: list[str]) -> None
async def delete_event(db: AsyncSession, event_id: str) -> None
```

**Internal helpers:**

- `_get_credentials(db)` — Reads `google_refresh_token` from `app_settings`. Returns `None` if not set (calendar features silently disabled). Uses `google.oauth2.credentials.Credentials` with `token_uri` to refresh on demand.
- `_build_event_body(lead, crew_emails)` — Constructs the Calendar API event dict:
  - **summary:** `"{service_type} — {customer_name}"` (falls back to `"Job"` if either is null)
  - **start/end:** `job_date_requested` as an all-day event (`date` field, not `dateTime`); if `job_date_requested` is null, defaults to today + 1 day
  - **location:** `job_address` (omitted if null)
  - **description:** `scope_notes` (omitted if null)
  - **attendees:** `[{ "email": addr } for addr in crew_emails]`
  - **sendUpdates:** `"all"` — Google sends invite/update emails automatically
- `_get_calendar_service(credentials)` — Returns a `googleapiclient.discovery.build("calendar", "v3", credentials=credentials)` instance.

**Behavior:**
- `create_event` returns the Google event ID string on success, `None` on any error (logged).
- `update_event` and `delete_event` log errors and return silently on failure.
- Crew members without an email address are excluded from the attendees list. If `crew_emails` is empty, `create_event` returns `None` without making an API call (no point creating an event with no attendees).
- If credentials are missing (not yet connected), all three functions return/log silently — no exception propagates.

---

### 3. Data Model Changes

**`leads` table — new column:**
```python
google_calendar_event_id = Column(String, nullable=True)
```
Stored when the first event is created. Cleared (set to `None`) when the event is deleted.

**`users` table — new column:**
```python
email = Column(String, nullable=True)
```
The crew member's Google/Gmail address. Used as the Calendar attendee address. Not required — crew without an email are silently skipped for calendar purposes.

**Migration:** Both columns added in `main.py`'s startup migration block using the existing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern.

---

### 4. Trigger Points

All triggers live in the existing routers/services. Each resolves the current full crew email list before calling calendar_service, so every operation is idempotent — it reflects current state rather than applying a delta.

#### `jobs.py → add_assignment`
After the `JobAssignment` row is committed:
1. Fetch all crew emails for the job (join `job_assignments` → `users` where `email IS NOT NULL`).
2. If `lead.google_calendar_event_id` is `None`: call `create_event`; if a non-None ID is returned, write it to `lead.google_calendar_event_id` and commit.
3. If `lead.google_calendar_event_id` is already set: call `update_event`.

#### `jobs.py → remove_assignment`
After the `JobAssignment` row is deleted:
1. Fetch remaining crew emails.
2. If none remain and `lead.google_calendar_event_id` is set: call `delete_event`, clear `lead.google_calendar_event_id`, commit.
3. If crew remain and event exists: call `update_event`.

#### `lead_service.py → update_lead`
After a successful commit, if `lead.google_calendar_event_id` is set and any of `job_date_requested`, `job_address`, or `scope_notes` changed:
1. Fetch current crew emails for the lead.
2. Call `update_event`.

---

### 5. Frontend Changes

#### Admin user create/edit form
Add an optional **Google email** field below the username field. Maps to the `email` column. Label: "Google email (for calendar invites)". Placeholder: `name@gmail.com`. Not required — form submits fine without it.

Schema changes:
- `UserCreate` — add `email: Optional[str] = None`
- `UserPatch` — add `email: Optional[str] = None`
- `UserListItem` — add `email: Optional[str] = None`

#### Admin settings page
Add a **Google Calendar** section with:
- Status indicator: "Connected" (green) or "Not connected" (grey), driven by `GET /admin/google/status`
- "Connect Google Calendar" button — fetches the consent URL and opens it in a new tab
- On success (after redirect completes), status refreshes automatically via polling or a manual "Check connection" button

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Google not connected (no refresh token) | All calendar calls no-op silently |
| Crew member has no email | Excluded from attendees; event still created/updated for others |
| All crew have no email | `create_event` skips API call, no event created |
| Google API returns an error | Error logged; operation returns without raising |
| Refresh token revoked | `_get_credentials` logs the error; admin must reconnect |
| `job_date_requested` is null | Event uses today + 1 day as placeholder date |

---

## Out of Scope

- Google Calendar invite RSVP tracking (accept/decline) — not surfaced in the app
- Per-crew-member calendar management (crew OAuth flows) — service account pattern only
- SMS/email fallback for crew without Google emails — push notifications already cover this
- Cancelling the event when a job is marked complete — the completed event remains on crew calendars as a record; supervisors can clean up manually if needed

---

## Setup Instructions (for the operator)

1. Go to [Google Cloud Console](https://console.cloud.google.com), create a project, enable **Google Calendar API**.
2. Create OAuth 2.0 credentials (type: Web application). Add `http://localhost:8000/admin/google/callback` as an authorized redirect URI.
3. Copy Client ID and Client Secret into `.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
4. Restart the backend. In the app's admin settings page, click **Connect Google Calendar** and complete the Google consent flow once.
5. Add Google emails to each crew member's profile in the admin users panel.
