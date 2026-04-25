# Job Crew Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `assigned_to` string on the Jobs screen with a many-to-many `job_assignments` join table so supervisors can assign multiple crew members to a booked job, and crew members only see jobs they're assigned to.

**Architecture:** New `JobAssignment` model (lead_id FK + user_id FK) is registered in `main.py` so `create_all` handles the new table. `GET /jobs` filters by assignment for crew role; supervisors/admins see all. New `POST /jobs/{id}/assignments` and `DELETE /jobs/{id}/assignments/{user_id}` endpoints managed by supervisors. `JobOut.crew` replaces `JobOut.assigned_to`.

**Tech Stack:** FastAPI + SQLAlchemy async + SQLite, React 18 + TypeScript + TanStack Query

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `app/backend/app/models/job_assignment.py` | `JobAssignment` ORM model |
| Modify | `app/backend/main.py` | Import new model so `create_all` picks it up |
| Modify | `app/backend/app/schemas/jobs.py` | `crew: list[str]` in `JobOut`; `JobAssignmentCreate` schema |
| Modify | `app/backend/app/routers/jobs.py` | Async `_to_job_out`, crew-filtered `GET`, assignment `POST`/`DELETE` |
| Modify | `app/backend/tests/test_jobs.py` | Update existing crew test; add assignment + filtering tests |
| Modify | `app/frontend/src/hooks/useJobs.ts` | `Job.crew: string[]`; `useAddJobAssignment`, `useRemoveJobAssignment` |
| Modify | `app/frontend/src/screens/JobsScreen.tsx` | Crew badges (all roles); supervisor assignment UI |

---

### Task 1: JobAssignment model

**Files:**
- Create: `app/backend/app/models/job_assignment.py`

- [ ] **Step 1: Write the failing test**

Add to `app/backend/tests/test_jobs.py` — import check only (model must be importable):

```python
def test_job_assignment_model_importable():
    from app.models.job_assignment import JobAssignment
    assert JobAssignment.__tablename__ == "job_assignments"
```

- [ ] **Step 2: Run test to verify it fails**

Run from `app/backend/`:
```
pytest tests/test_jobs.py::test_job_assignment_model_importable -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Create the model**

Create `app/backend/app/models/job_assignment.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint

from app.database import Base


class JobAssignment(Base):
    __tablename__ = "job_assignments"
    __table_args__ = (UniqueConstraint("lead_id", "user_id", name="uq_job_assignment"),)

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    assigned_by = Column(String, nullable=True)  # username of supervisor who made the assignment
```

- [ ] **Step 4: Run test to verify it passes**

```
pytest tests/test_jobs.py::test_job_assignment_model_importable -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/models/job_assignment.py app/backend/tests/test_jobs.py
git commit -m "feat: add JobAssignment model for many-to-many crew assignment"
```

---

### Task 2: Register model + update schemas

**Files:**
- Modify: `app/backend/main.py` (line 29 area — model imports)
- Modify: `app/backend/app/schemas/jobs.py`

- [ ] **Step 1: Add model import to main.py**

In `app/backend/main.py`, after the existing model imports (around line 30), add:

```python
import app.models.job_assignment  # noqa: F401
```

No test needed — `create_all` will create the table on next startup. Verify the app starts without error after Task 3.

- [ ] **Step 2: Write the failing schema test**

Add to `app/backend/tests/test_jobs.py`:

```python
def test_job_out_has_crew_field():
    from app.schemas.jobs import JobOut
    job = JobOut(id="x", crew=["alice", "bob"])
    assert job.crew == ["alice", "bob"]


def test_job_out_crew_defaults_empty():
    from app.schemas.jobs import JobOut
    job = JobOut(id="x")
    assert job.crew == []


def test_job_assignment_create_schema():
    from app.schemas.jobs import JobAssignmentCreate
    schema = JobAssignmentCreate(user_id="u-123")
    assert schema.user_id == "u-123"
```

- [ ] **Step 3: Run tests to verify they fail**

```
pytest tests/test_jobs.py::test_job_out_has_crew_field tests/test_jobs.py::test_job_out_crew_defaults_empty tests/test_jobs.py::test_job_assignment_create_schema -v
```
Expected: FAIL — `JobOut` has no `crew` field, `JobAssignmentCreate` doesn't exist

- [ ] **Step 4: Replace schemas/jobs.py**

Replace the entire `app/backend/app/schemas/jobs.py`:

```python
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

JobStatus = Literal["en_route", "started", "completed"]


class JobOut(BaseModel):
    id: str
    customer_name: Optional[str] = None
    service_type: Optional[str] = None
    job_location: Optional[str] = None
    job_date_requested: Optional[str] = None
    scope_notes: Optional[str] = None
    crew: list[str] = []
    customer_phone: Optional[str] = None
    quote_context: Optional[str] = None

    model_config = {"from_attributes": True}


class JobStatusUpdate(BaseModel):
    status: JobStatus


class JobAssignmentCreate(BaseModel):
    user_id: str
```

- [ ] **Step 5: Run tests to verify they pass**

```
pytest tests/test_jobs.py::test_job_out_has_crew_field tests/test_jobs.py::test_job_out_crew_defaults_empty tests/test_jobs.py::test_job_assignment_create_schema -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/backend/main.py app/backend/app/schemas/jobs.py app/backend/tests/test_jobs.py
git commit -m "feat: add crew field to JobOut, JobAssignmentCreate schema"
```

---

### Task 3: Update router

**Files:**
- Modify: `app/backend/app/routers/jobs.py`

- [ ] **Step 1: Write the failing tests** (add to `app/backend/tests/test_jobs.py`)

Add these helper functions and tests:

```python
import uuid as _uuid

async def _seed_user(factory, role="crew", username="test-crew"):
    async with factory() as s:
        user = User(
            id=str(_uuid.uuid4()),
            username=username,
            credential_hash="x",
            role=role,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


async def _seed_assignment(factory, lead_id: str, user_id: str):
    from app.models.job_assignment import JobAssignment
    async with factory() as s:
        s.add(JobAssignment(lead_id=lead_id, user_id=user_id, assigned_by="test"))
        await s.commit()


@pytest.mark.asyncio
async def test_crew_only_sees_assigned_jobs(crew_client):
    client, factory = crew_client
    await _seed_lead(factory, status="booked")
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_crew_sees_assigned_job(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked")
    await _seed_assignment(factory, lead_id=lead.id, user_id="mock-crew")
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_crew_field_returns_assigned_usernames(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)
    r = await client.get("/jobs")
    assert r.status_code == 200
    assert crew_user.username in r.json()[0]["crew"]


@pytest.mark.asyncio
async def test_add_assignment_as_supervisor(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    assert r.status_code == 201
    assert crew_user.username in r.json()["crew"]


@pytest.mark.asyncio
async def test_add_assignment_as_crew_forbidden(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": "any"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_add_duplicate_assignment_is_idempotent(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    r = await client.post(f"/jobs/{lead.id}/assignments", json={"user_id": crew_user.id})
    assert r.status_code == 201
    assert r.json()["crew"].count(crew_user.username) == 1


@pytest.mark.asyncio
async def test_remove_assignment_as_supervisor(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    crew_user = await _seed_user(factory)
    await _seed_assignment(factory, lead_id=lead.id, user_id=crew_user.id)
    r = await client.delete(f"/jobs/{lead.id}/assignments/{crew_user.id}")
    assert r.status_code == 200
    assert crew_user.username not in r.json()["crew"]


@pytest.mark.asyncio
async def test_remove_nonexistent_assignment_returns_404(supervisor_client):
    client, factory = supervisor_client
    lead = await _seed_lead(factory, status="booked")
    r = await client.delete(f"/jobs/{lead.id}/assignments/nonexistent-user")
    assert r.status_code == 404
```

Also update the existing `test_crew_omits_phone_and_quote` to seed an assignment (crew now only sees assigned jobs):

```python
@pytest.mark.asyncio
async def test_crew_omits_phone_and_quote(crew_client):
    client, factory = crew_client
    lead = await _seed_lead(factory, status="booked", customer_phone="555-000-0002", quote_context="secret")
    await _seed_assignment(factory, lead_id=lead.id, user_id="mock-crew")
    r = await client.get("/jobs")
    assert r.status_code == 200
    job = r.json()[0]
    assert job["customer_phone"] is None
    assert job["quote_context"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

```
pytest tests/test_jobs.py::test_crew_only_sees_assigned_jobs tests/test_jobs.py::test_add_assignment_as_supervisor tests/test_jobs.py::test_remove_assignment_as_supervisor -v
```
Expected: FAIL — router doesn't have new endpoints or crew filtering yet

- [ ] **Step 3: Replace router**

Replace the entire `app/backend/app/routers/jobs.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth, require_role
from app.models.job_assignment import JobAssignment
from app.models.lead import Lead, LeadStatus
from app.models.user import User
from app.schemas.jobs import JobAssignmentCreate, JobOut, JobStatusUpdate
from app.services import lead_service

router = APIRouter(prefix="/jobs", tags=["jobs"])


async def _get_crew(db: AsyncSession, lead_id: str) -> list[str]:
    result = await db.execute(
        select(User.username)
        .join(JobAssignment, User.id == JobAssignment.user_id)
        .where(JobAssignment.lead_id == lead_id)
    )
    return [row[0] for row in result.fetchall()]


async def _to_job_out(db: AsyncSession, lead: Lead, role: str) -> JobOut:
    crew = await _get_crew(db, lead.id)
    date_str = lead.job_date_requested.isoformat() if lead.job_date_requested else None
    return JobOut(
        id=lead.id,
        customer_name=lead.customer_name,
        service_type=lead.service_type.value if lead.service_type is not None else None,
        job_location=lead.job_location,
        job_date_requested=date_str,
        scope_notes=lead.scope_notes,
        crew=crew,
        customer_phone=lead.customer_phone if role != "crew" else None,
        quote_context=lead.quote_context if role != "crew" else None,
    )


@router.get("", response_model=list[JobOut])
async def get_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_auth),
):
    if current_user.role in ("supervisor", "admin", "facilitator"):
        result = await db.execute(select(Lead).where(Lead.status == LeadStatus.booked))
    else:
        result = await db.execute(
            select(Lead)
            .join(JobAssignment, Lead.id == JobAssignment.lead_id)
            .where(Lead.status == LeadStatus.booked, JobAssignment.user_id == current_user.id)
        )
    leads = result.scalars().all()
    return [await _to_job_out(db, lead, current_user.role) for lead in leads]


@router.patch("/{lead_id}/status", response_model=JobOut)
async def patch_job_status(
    lead_id: str,
    data: JobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    lead = await lead_service.update_job_status(db, lead_id, data.status, actor=current_user.username)
    return await _to_job_out(db, lead, current_user.role)


@router.post("/{lead_id}/assignments", response_model=JobOut, status_code=201)
async def add_assignment(
    lead_id: str,
    data: JobAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    result = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.status == LeadStatus.booked))
    lead = result.scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=404, detail="Job not found")
    result = await db.execute(select(User).where(User.id == data.user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="User not found")
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == data.user_id)
    )
    if result.scalar_one_or_none() is None:
        db.add(JobAssignment(lead_id=lead_id, user_id=data.user_id, assigned_by=current_user.username))
        await db.commit()
    return await _to_job_out(db, lead, current_user.role)


@router.delete("/{lead_id}/assignments/{user_id}", response_model=JobOut)
async def remove_assignment(
    lead_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("supervisor")),
):
    result = await db.execute(
        select(JobAssignment).where(JobAssignment.lead_id == lead_id, JobAssignment.user_id == user_id)
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()
    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one()
    return await _to_job_out(db, lead, current_user.role)
```

- [ ] **Step 4: Run all jobs tests**

```
pytest tests/test_jobs.py -v
```
Expected: ALL PASS (existing tests still pass; new tests pass too)

- [ ] **Step 5: Run full test suite to check for regressions**

```
pytest -x -q
```
Expected: same baseline count or higher; no regressions in other test files

- [ ] **Step 6: Commit**

```bash
git add app/backend/app/routers/jobs.py app/backend/tests/test_jobs.py
git commit -m "feat: add crew filtering and job assignment endpoints"
```

---

### Task 4: Frontend hooks

**Files:**
- Modify: `app/frontend/src/hooks/useJobs.ts`

- [ ] **Step 1: Replace useJobs.ts**

Replace the entire `app/frontend/src/hooks/useJobs.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../services/api'

export interface Job {
  id: string
  customer_name: string | null
  service_type: string
  job_location: string | null
  job_date_requested: string | null
  scope_notes: string | null
  crew: string[]
  customer_phone?: string | null
  quote_context?: string | null
}

export function useJobs() {
  return useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => {
      const r = await apiFetch('/jobs')
      if (!r.ok) throw new Error('Failed to fetch jobs')
      return r.json()
    },
  })
}

export function usePatchJobStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await apiFetch(`/jobs/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!r.ok) throw new Error('Failed to update job status')
      return r.json() as Promise<Job>
    },
    onSuccess: (_data, { id, status }) => {
      if (status === 'completed') {
        qc.setQueryData<Job[]>(['jobs'], prev => (prev ?? []).filter(j => j.id !== id))
      } else {
        qc.invalidateQueries({ queryKey: ['jobs'] })
      }
    },
  })
}

export function useAddJobAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, userId }: { jobId: string; userId: string }) => {
      const r = await apiFetch(`/jobs/${jobId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!r.ok) throw new Error('Failed to add assignment')
      return r.json() as Promise<Job>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useRemoveJobAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ jobId, userId }: { jobId: string; userId: string }) => {
      const r = await apiFetch(`/jobs/${jobId}/assignments/${userId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error('Failed to remove assignment')
      return r.json() as Promise<Job>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `app/frontend/`:
```
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/hooks/useJobs.ts
git commit -m "feat: add crew field and assignment mutation hooks to useJobs"
```

---

### Task 5: Update JobsScreen

**Files:**
- Modify: `app/frontend/src/screens/JobsScreen.tsx`

- [ ] **Step 1: Replace JobsScreen.tsx**

Replace the entire `app/frontend/src/screens/JobsScreen.tsx`:

```tsx
import { useAuth } from '../context/AuthContext'
import { useJobs, usePatchJobStatus, useAddJobAssignment, useRemoveJobAssignment } from '../hooks/useJobs'
import { useUsers } from '../hooks/useUsers'

const STATUS_BUTTONS = [
  { value: 'en_route', label: 'En Route' },
  { value: 'started', label: 'Started' },
  { value: 'completed', label: 'Completed' },
]

export function JobsScreen() {
  const { user, logout } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const { data: users = [] } = useUsers()
  const patchStatus = usePatchJobStatus()
  const addAssignment = useAddJobAssignment()
  const removeAssignment = useRemoveJobAssignment()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <h1 className="font-bold text-gray-900 dark:text-white text-lg">Jobs</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const next = document.documentElement.classList.toggle('dark') ? 'dark' : 'light'
              localStorage.setItem('hh_theme', next)
            }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg"
            title="Toggle dark mode"
          >
            🌓
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{user?.username}</span>
          <button
            onClick={logout}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-10">
        {patchStatus.isError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2">
            Failed to update job status — please try again.
          </p>
        )}
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">Loading jobs…</p>
        )}
        {!isLoading && jobs.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-10">No active jobs.</p>
        )}
        {jobs.map(job => (
          <div key={job.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {job.customer_name ?? <span className="italic text-gray-400 font-normal">Unnamed</span>}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 capitalize mt-0.5">
                  {job.service_type} · {job.job_location ?? 'No location'}
                </p>
                {job.job_date_requested && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">📅 {job.job_date_requested}</p>
                )}
                {job.scope_notes && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">{job.scope_notes}</p>
                )}
                {job.customer_phone && (
                  <a href={`tel:${job.customer_phone}`} className="text-sm text-indigo-600 dark:text-indigo-400 mt-1 block">
                    📞 {job.customer_phone}
                  </a>
                )}
              </div>
            </div>

            {/* Crew badges — visible to all roles */}
            {job.crew.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-3">
                {job.crew.map(name => (
                  <span
                    key={name}
                    className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}

            {user?.role === 'supervisor' && (
              <div className="space-y-3">
                {/* Status buttons */}
                <div className="flex gap-2 flex-wrap">
                  {STATUS_BUTTONS.map(btn => (
                    <button
                      key={btn.value}
                      onClick={() => patchStatus.mutate({ id: job.id, status: btn.value })}
                      disabled={patchStatus.isPending}
                      className={`px-3 py-1 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
                        btn.value === 'completed'
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                {/* Crew assignment */}
                <div className="border-t dark:border-gray-700 pt-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Assign crew</p>
                  <div className="flex gap-2 flex-wrap items-center">
                    <select
                      className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      defaultValue=""
                      onChange={e => {
                        if (e.target.value) {
                          addAssignment.mutate({ jobId: job.id, userId: e.target.value })
                          e.target.value = ''
                        }
                      }}
                    >
                      <option value="" disabled>Add member…</option>
                      {users
                        .filter(u => u.is_active && (u.role === 'crew' || u.role === 'supervisor'))
                        .filter(u => !job.crew.includes(u.username))
                        .map(u => (
                          <option key={u.id} value={u.id}>{u.username} ({u.role})</option>
                        ))
                      }
                    </select>

                    {job.crew.map(username => {
                      const u = users.find(u => u.username === username)
                      return (
                        <span
                          key={username}
                          className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-2 py-0.5 rounded-full"
                        >
                          {username}
                          <button
                            onClick={() => u && removeAssignment.mutate({ jobId: job.id, userId: u.id })}
                            className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-100 font-bold leading-none"
                            title={`Remove ${username}`}
                          >
                            ×
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from `app/frontend/`:
```
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Start the app and verify manually**

```
python run.py
```

Open `http://localhost:5173`. Log in as supervisor (PIN `0000`).

Verify:
- Jobs screen loads without errors
- A booked job shows crew badges (empty at first)
- "Assign crew" section appears for supervisor
- Adding a crew member from dropdown → badge appears with × button
- Clicking × removes them → badge disappears
- Status buttons still work (En Route, Started, Completed)

Log in as a crew user. Verify:
- Only jobs that user is assigned to appear
- Crew badges are read-only (no × buttons)
- Phone is hidden

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/screens/JobsScreen.tsx
git commit -m "feat: supervisor crew assignment UI and crew-filtered job view"
```

---

## Self-Review

**Spec coverage:**
- ✅ `job_assignments` join table: Task 1
- ✅ `GET /jobs` crew-filtered: Task 3
- ✅ `POST /DELETE /jobs/{id}/assignments`: Task 3
- ✅ `JobOut.crew: list[str]`: Task 2
- ✅ Crew sees only assigned jobs: Task 3 + tested
- ✅ Supervisors see all jobs: unchanged behavior, verified via existing tests
- ✅ Frontend crew badges: Task 5
- ✅ Frontend supervisor assignment UI: Task 5
- ✅ `Lead.assigned_to` untouched (facilitator routing separate concern): Task 2/3

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:**
- `Job.crew: string[]` (hooks) matches `JobOut.crew: list[str]` (schema) ✅
- `useAddJobAssignment({ jobId, userId })` matches `POST /jobs/{lead_id}/assignments` body `{ user_id }` ✅
- `useRemoveJobAssignment({ jobId, userId })` matches `DELETE /jobs/{lead_id}/assignments/{user_id}` ✅
- `TeamMember.id` (useUsers) used as `userId` arg — correct ✅
