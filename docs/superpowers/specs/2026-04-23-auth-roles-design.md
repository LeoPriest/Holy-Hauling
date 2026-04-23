# Auth + Roles — Sub-project 1 of 3

## Overview

Adds named user accounts with 4 roles, username + 4-digit PIN login, JWT-based session management, role-gated API and UI, a role-grouped team member dropdown for lead assignment, light/dark mode, and Web Push notifications for crew and supervisor.

This is the foundation sub-project. Sub-project 2 (Field Crew views — photo submission, full job detail) and Sub-project 3 (Admin Panel — revenue dashboard, pricing matrix) depend on this being in place first.

---

## Roles

| Role | What they can do |
|------|-----------------|
| `admin` | Everything facilitator can do + user management + write settings (thresholds, quiet hours, contacts) |
| `facilitator` | Full lead operations: queue, intake, OCR, AI review, notes, lead edit, status transitions. Settings read-only. |
| `supervisor` | Job list (/jobs). Full job detail including customer phone and quote. Add photos. Mark en route / started / complete. |
| `crew` | Job list (/jobs). Address, size, stairs, scope only — no phone, no quote. Add photos. Cannot mark complete. |

On first boot with an empty users table, one default `admin` account is seeded: username `admin`, PIN `0000`. The admin must change the PIN immediately via user management.

---

## Authentication

**Mechanism:** Username + 4-digit PIN → signed JWT (HS256, secret from `JWT_SECRET` env var).

**Token lifetime:** 30 days. Stored in `localStorage` under key `hh_token`.

**Credential storage:** PIN is hashed with `bcrypt` and stored in a `credential_hash` VARCHAR column. The column name is intentionally generic — upgrading to a full password later requires only a UI change (text input instead of PIN keypad), no schema migration.

**On app load:** Frontend reads `hh_token` from localStorage, calls `GET /auth/me` to verify it is still valid. If missing or invalid, redirect to login screen.

**Deactivated users:** A deactivated user's token is rejected by the backend even if the token has not expired.

---

## Data Model

### New table: `users`

```sql
CREATE TABLE users (
    id              VARCHAR  NOT NULL PRIMARY KEY,   -- uuid
    username        VARCHAR  NOT NULL UNIQUE,
    credential_hash VARCHAR  NOT NULL,               -- bcrypt hash of PIN
    role            VARCHAR  NOT NULL,               -- admin | facilitator | supervisor | crew
    is_active       BOOLEAN  NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL,
    created_by      VARCHAR                          -- user_id of admin who created this user
);
```

No foreign key on `created_by` — keeps seeding simple.

### New table: `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
    id          VARCHAR  NOT NULL PRIMARY KEY,   -- uuid
    user_id     VARCHAR  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT     NOT NULL,
    p256dh      TEXT     NOT NULL,
    auth        TEXT     NOT NULL,
    created_at  DATETIME NOT NULL
);
```

One user can have multiple subscriptions (multiple devices/browsers).

### Existing table: `leads` — no schema change

`assigned_to` remains a VARCHAR storing a username string. No FK needed; the dropdown is purely a UI convenience.

---

## API

### Auth routes (`/auth`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/auth/login` | None | — | `{username, pin}` → `{token, user}`. Returns 401 on wrong PIN or deactivated user. |
| GET | `/auth/me` | JWT | Any | Returns current user from token. Used on app load. |

### Admin user management (`/admin/users`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/admin/users` | JWT | admin | List all users (all roles, active + inactive). |
| POST | `/admin/users` | JWT | admin | Create user. Body: `{username, pin, role}`. |
| PATCH | `/admin/users/{id}` | JWT | admin | Update role, reset PIN, toggle is_active. |

### Team member list

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/users` | JWT | admin, facilitator | Active users only. Returns `[{id, username, role}]` for the assignment dropdown. |

### Jobs (`/jobs`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/jobs` | JWT | Any | Booked leads shaped for field view. Crew response omits `customer_phone` and quote fields; supervisor response includes them. |
| PATCH | `/jobs/{id}/status` | JWT | supervisor | Body: `{status}` where status ∈ `{en_route, started, completed}`. Writes a `LeadEvent`. `completed` advances lead status to `released` (job lifecycle end). |

### Push notifications (`/push`)

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/push/subscribe` | JWT | Any | Saves a Web Push subscription for the current user's device. Body: `{endpoint, p256dh, auth}`. |

### Existing routes — enforcement changes

- All existing routes now require a valid JWT (`401` if missing/invalid).
- `PATCH /settings` — restricted to `admin` (was open to all). Facilitator gets `403`.
- `GET /settings` — readable by all authenticated roles.
- `DELETE /leads/{id}` — restricted to `admin` + `facilitator`.

---

## Role Enforcement (Backend)

Two FastAPI dependencies:

```python
async def require_auth(token: str = Depends(oauth2_scheme), db=Depends(get_db)) -> User:
    """Validates JWT, checks user is active. Raises 401 on failure."""

def require_role(*roles: str):
    """Returns a dependency that calls require_auth then checks role. Raises 403."""
```

Usage on routes:

```python
@router.patch("", dependencies=[Depends(require_role("admin"))])
async def patch_settings(...):
    ...
```

The `current_user` object is injected into routes that need the user's identity (for audit trail, push dispatch, etc.).

---

## actor Field

All existing routes that write lead events currently accept `actor` as an optional query param or body field. After this sub-project, the backend populates `actor` automatically from `current_user.username` if no explicit actor is provided. Explicit actor values are still accepted (for backward compatibility with existing tests).

---

## Push Notifications

**Library:** `pywebpush` (added to `requirements.txt`).

**VAPID keys:** Generated once and stored in `.env` as `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY`. The public key is served at `GET /push/vapid-public-key` (no auth required) so the frontend can subscribe.

**Triggers:**

| Event | Who is notified | Payload |
|-------|----------------|---------|
| Lead status set to `booked` | All supervisor + crew users with active subscriptions | `"New job assigned: [customer name] — [service type]"` |
| Lead status set to `escalated` | All supervisor users with active subscriptions | `"Job escalated: [customer name] — action needed"` |

Push is fire-and-forget — a failed delivery is logged but does not block the status update.

**Frontend:**

- After successful login, register `service-worker.js` and call `GET /push/vapid-public-key`.
- Request notification permission once. If denied, store `hh_push_declined=true` in localStorage and never ask again.
- On permission granted, subscribe and `POST /push/subscribe` with the subscription object.

---

## Frontend

### New screens

| Route | Roles | Description |
|-------|-------|-------------|
| `/login` | All (unauthenticated) | Username text input + PIN keypad (3×3+0 grid). Sign In button. Error message on bad PIN. |
| `/jobs` | supervisor, crew | Job list of booked leads. Cards show role-filtered detail. |
| `/admin/users` | admin | Team list with role badges. Add user button. Edit drawer (change role, reset PIN, deactivate). |

### Role-based routing

```
On app load:
  No valid token → /login
  admin | facilitator → / (lead queue)
  supervisor | crew → /jobs
```

Nav items shown by role:

| Nav item | admin | facilitator | supervisor | crew |
|----------|-------|-------------|------------|------|
| Lead Queue (/) | ✓ | ✓ | — | — |
| Jobs (/jobs) | — | — | ✓ | ✓ |
| Settings (/settings) | ✓ | ✓ (read-only) | — | — |
| Users (/admin/users) | ✓ | — | — | — |

### assigned_to dropdown

Replaces the free-text "Handler…" input in both:
1. Lead edit form — `assigned_to` field
2. Lead queue filter bar — "Handler" filter

Populated from `GET /users`. Rendered as a `<select>` with `<optgroup>` sections: Admin, Facilitator, Supervisor, Crew. Stores the selected username string. Unassigned option always present.

### Light / dark mode

- Toggle button in the app header (visible to all roles).
- Preference stored in `localStorage` under `hh_theme` (`light` | `dark`).
- Applied as a class on `<html>` (`dark` class enables Tailwind dark mode).
- Tailwind config: `darkMode: 'class'`.
- All existing screens must adopt dark-mode-safe Tailwind classes as part of this sub-project.

---

## New files

```
app/backend/app/models/user.py
app/backend/app/models/push_subscription.py
app/backend/app/schemas/auth.py          -- LoginRequest, TokenOut, UserOut
app/backend/app/schemas/user.py          -- UserCreate, UserPatch, UserListItem
app/backend/app/services/auth_service.py -- login, hash_pin, verify_pin, create_token, decode_token
app/backend/app/services/push_service.py -- subscribe, send_push
app/backend/app/routers/auth.py
app/backend/app/routers/admin_users.py
app/backend/app/routers/jobs.py
app/backend/app/dependencies.py          -- require_auth, require_role
app/backend/tests/test_auth.py
app/backend/tests/test_admin_users.py
app/backend/tests/test_jobs.py

app/frontend/src/screens/LoginScreen.tsx
app/frontend/src/screens/JobsScreen.tsx
app/frontend/src/screens/AdminUsersScreen.tsx
app/frontend/src/hooks/useAuth.ts        -- useCurrentUser, useLogin, useLogout
app/frontend/src/hooks/useUsers.ts       -- useUsers (for assignment dropdown)
app/frontend/src/hooks/useJobs.ts
app/frontend/src/context/AuthContext.tsx -- current user in React context
app/frontend/public/service-worker.js
```

### Modified files

```
app/backend/main.py                -- register new models + routers; seed default admin
app/backend/app/routers/settings.py -- PATCH /settings → require_role("admin")
app/backend/app/routers/leads.py   -- add require_auth to all routes; auto-populate actor
app/backend/app/routers/ingest.py  -- add require_auth
app/backend/requirements.txt       -- add: python-jose[cryptography], bcrypt, pywebpush
app/frontend/src/App.tsx           -- add login route, auth guard, role-based redirect
app/frontend/src/services/api.ts   -- attach Authorization header on all requests
app/frontend/src/screens/SettingsScreen.tsx -- disable Save button for facilitator role
app/frontend/src/screens/LeadQueue.tsx      -- replace Handler text input with dropdown
app/frontend/vite.config.ts        -- add /auth, /admin, /push, /jobs to proxy
tailwind.config.js                 -- enable darkMode: 'class'
```

---

## Environment variables (new)

```
JWT_SECRET=<random 32+ char string>
JWT_ALGORITHM=HS256
JWT_EXPIRE_DAYS=30
VAPID_PRIVATE_KEY=<generated>
VAPID_PUBLIC_KEY=<generated>
VAPID_CLAIM_EMAIL=mailto:admin@holyhauling.com
```

Add all to `.env.example`.

---

## Out of scope

- Before/after photo submission flow (Sub-project 2)
- Revenue + job history dashboard (Sub-project 3)
- Pricing matrix editor (Sub-project 3)
- Password upgrade from PIN — `credential_hash` is already shaped for it; swap the login UI when ready
- Offline support
