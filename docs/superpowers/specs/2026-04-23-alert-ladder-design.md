# Alert Ladder — Design Spec
**Date:** 2026-04-23
**Project:** Holy Hauling Internal App
**Status:** Approved for implementation

---

## Problem

Leads arrive via screenshot ingest or Thumbtack webhook and sit unprocessed while the facilitator is unavailable or distracted. There is no mechanism to surface stale leads in-app or notify a backup handler when the primary facilitator doesn't respond in time.

---

## Goal

Build a configurable alert ladder that:

1. Surfaces stale leads visually in the queue (always on, no credentials required)
2. Notifies the primary facilitator via SMS and/or email after a configurable idle window (T1)
3. Escalates to both primary and backup handler after a second configurable window (T2)
4. Respects quiet hours (suppresses SMS/email, in-app indicators always show)
5. Deduplications alerts so the same lead doesn't spam per scheduler tick
6. Allows the facilitator to snooze the in-app banner temporarily
7. Provides a test-send button so operators can verify credentials before relying on them

---

## Staleness Definition

A lead is **stale** when `updated_at` has not changed for longer than the configured threshold. `updated_at` is already written on every lead action (status change, field edit, note, acknowledgment, screenshot upload, OCR apply) — no new tracking is needed.

**Active leads only:** Staleness is computed only for leads with status `new`, `in_review`, `waiting_on_customer`, `ready_for_quote`, or `ready_for_booking`. Leads with status `booked`, `released`, or `escalated` are excluded.

---

## Alert Thresholds

Both thresholds are configurable in app settings (defaults shown):

| Tier | Default | Who gets notified |
|------|---------|-------------------|
| T1   | 15 min  | Primary facilitator (SMS + email) |
| T2   | 30 min  | Primary facilitator + backup handler (SMS + email); lead auto-advanced to `escalated` |

Alert resets when any action is taken on the lead (because `updated_at` changes). If a lead gets activity and then goes cold again, a new alert window starts.

---

## In-App Alert Layer

Staleness is computed entirely in the frontend from `updated_at` on existing lead data — no new API call required.

### Lead Card Indicators

| State | Visual |
|-------|--------|
| T1 (idle ≥ T1, < T2) | Amber left border + `⚠ Xm no activity` chip |
| T2 (idle ≥ T2) | Red left border + `🔴 Escalated` chip |

### Queue Banner

A sticky banner at the top of the LeadQueue appears whenever any active leads are stale:

- Amber: `"N lead(s) need attention"` (T1 only, no T2)
- Red: `"N lead(s) escalated — backup notified"` (any T2 present)

The banner includes a **Snooze** button that dismisses it for 10 minutes (frontend-only, `localStorage`-backed so it survives a page refresh within the snooze window). Stale card indicators remain visible during snooze — only the banner is hidden.

---

## Backend Scheduler

`APScheduler`'s `AsyncIOScheduler` runs inside the FastAPI lifespan context — no separate process required. The scheduler starts on app boot and stops on shutdown.

**Check interval:** Every 5 minutes.

**Logic per tick:**

1. Load settings (T1 minutes, T2 minutes, quiet hours, contact info)
2. Query all active leads where `updated_at` < now − T1
3. For each lead:
   - Check `lead_alerts` table: has a T1/T2 alert been sent with the same `lead_updated_at_snapshot`?
   - If yes → skip (same idle window, already sent)
   - If no → fire the appropriate tier alert
4. T2 auto-advance: if sending a T2 alert, transition the lead status to `escalated` and write a `status_changed` event (`actor: "alert_scheduler"`)

**Quiet hours:** If `now` falls within `quiet_hours_start`–`quiet_hours_end`, SMS and email are skipped but logged as `suppressed=True` in `lead_alerts`. In-app indicators are unaffected.

### SMS (Twilio)

Fires only if all three env vars are present: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`. Graceful no-op if any are absent.

Message template:
```
Holy Hauling Alert: Lead "[customer_name or 'Unknown']" has been idle for Xm.
Status: [status]. Open the app to take action.
```

T2 message adds: `Escalated — backup handler also notified.`

### Email (SMTP)

Fires only if all four env vars are present: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Graceful no-op if any are absent.

Subject: `[Holy Hauling] Lead idle Xm — action needed`
Body: same content as SMS with lead details.

### Test Send

`POST /settings/test-alert` accepts `{ channel: "sms" | "email", recipient: "primary" | "backup" }` and fires a single test message immediately, bypassing quiet hours and the dedup table. Returns `{ sent: true }` or `{ sent: false, reason: "..." }`.

---

## Database

### New table: `app_settings`

```sql
CREATE TABLE app_settings (
    key   VARCHAR PRIMARY KEY,
    value VARCHAR
);
```

Keys:
| Key | Default |
|-----|---------|
| `t1_minutes` | `15` |
| `t2_minutes` | `30` |
| `quiet_hours_start` | `22:00` |
| `quiet_hours_end` | `07:00` |
| `primary_sms` | `` |
| `primary_email` | `` |
| `backup_name` | `` |
| `backup_sms` | `` |
| `backup_email` | `` |
| `quiet_hours_enabled` | `false` |

### New table: `lead_alerts`

```sql
CREATE TABLE lead_alerts (
    id                     VARCHAR PRIMARY KEY,
    lead_id                VARCHAR NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    tier                   INTEGER NOT NULL,       -- 1 or 2
    channel                VARCHAR NOT NULL,       -- 'sms' | 'email'
    sent_at                DATETIME NOT NULL,
    suppressed             BOOLEAN NOT NULL DEFAULT 0,
    lead_updated_at_snapshot DATETIME NOT NULL    -- updated_at value at send time
);
```

Dedup query: `SELECT 1 FROM lead_alerts WHERE lead_id=:id AND tier=:tier AND lead_updated_at_snapshot=:snap AND suppressed=0 LIMIT 1`

---

## Settings Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/settings` | Return all current key-value pairs as a flat object |
| `PATCH` | `/settings` | Write any supplied keys (upsert) |
| `POST` | `/settings/test-alert` | Fire a test SMS or email immediately |

---

## Settings Screen

Accessible via a gear icon (`⚙`) in the LeadQueue header. Opens a full-screen settings form (same router pattern as LeadCommandCenter — route `/settings`).

Sections:

**Alert Thresholds**
- T1 warning (minutes) — number input
- T2 escalation (minutes) — number input

**Quiet Hours**
- Enable toggle
- Start time (HH:MM)
- End time (HH:MM)

**Primary Facilitator**
- SMS number
- Email address

**Backup Handler**
- Name
- SMS number
- Email address

**Test Alerts**
- "Send test SMS to primary" button
- "Send test SMS to backup" button
- "Send test email to primary" button
- "Send test email to backup" button
- Each shows inline `✓ Sent` or `✗ Failed: <reason>` after firing

A single **Save** button at the bottom PATCHes all values.

---

## Component Map

### New — Backend

| File | Purpose |
|------|---------|
| `app/models/app_setting.py` | `AppSetting` ORM model |
| `app/models/lead_alert.py` | `LeadAlert` ORM model |
| `app/schemas/settings.py` | `SettingsOut`, `SettingsPatch`, `TestAlertRequest`, `TestAlertResult` |
| `app/services/alert_service.py` | Scheduler setup, `check_stale_leads()`, `send_sms()`, `send_email()`, `fire_test_alert()` |
| `app/routers/settings.py` | `GET /settings`, `PATCH /settings`, `POST /settings/test-alert` |

### Modified — Backend

| File | Change |
|------|--------|
| `main.py` | Import new models, register settings router, start/stop scheduler in lifespan |

### New — Frontend

| File | Purpose |
|------|---------|
| `src/hooks/useSettings.ts` | `useSettings()`, `usePatchSettings()`, `useTestAlert()` |
| `src/hooks/useStaleLeads.ts` | Derives T1/T2 stale sets from leads + settings; manages snooze state |
| `src/components/StaleLeadBanner.tsx` | Queue-top banner with snooze button |
| `src/screens/SettingsScreen.tsx` | Settings form with test send buttons |

### Modified — Frontend

| File | Change |
|------|--------|
| `App.tsx` | Add `/settings` route |
| `LeadQueue.tsx` | Add `StaleLeadBanner`, gear icon → navigate to `/settings` |
| `LeadCard.tsx` | Add amber/red staleness border + chip based on `useStaleLeads` |
| `api.ts` | Add `fetchSettings()`, `patchSettings()`, `testAlert()` |

---

## What This Does Not Include

- Push notifications (browser or native)
- Per-lead snooze (banner snooze only)
- Alert history UI (logged to DB, not yet surfaced in UI)
- Routing rules per lead type or source
- Automated follow-up message drafting

---

## Success Criteria

- Any lead idle ≥ T1 minutes shows amber indicator in the queue without any configuration
- Facilitator sees the banner, can snooze for 10 minutes
- T2 leads automatically transition to `escalated` status with an audit event
- SMS and email fire correctly when credentials are configured and quiet hours are off
- Test send confirms working credentials before a real lead falls through
- No duplicate alerts for the same idle window on the same lead
- Quiet hours suppress SMS/email but in-app indicators remain visible
