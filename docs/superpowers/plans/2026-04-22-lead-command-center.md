# Lead Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LeadDetail modal with a full-screen, mobile-first Lead Command Center featuring a screenshot-first fast lane ingest, three-tab layout (Brief / Quote / Log), and a persistent AI pricing chat.

**Architecture:** React Router v6 provides URL-based navigation (`/` → queue, `/leads/:id` → command center). The backend gains a `lead_chat_messages` table and two new endpoints. The frontend is reorganized into focused panel components that replace the existing monolithic `LeadDetail` modal.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, TanStack Query v5, react-router-dom v6, FastAPI, SQLAlchemy (async), SQLite (aiosqlite), Anthropic SDK (Python)

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `app/backend/app/models/lead_chat_message.py` | ORM model for persisted chat messages |
| `app/backend/app/schemas/chat.py` | Pydantic request/response schemas for chat |
| `app/backend/app/services/chat_service.py` | Send message + get history logic |
| `app/backend/app/routers/chat.py` | `GET /leads/:id/chat`, `POST /leads/:id/chat` |
| `app/backend/tests/test_chat.py` | Backend tests for chat endpoints |
| `app/frontend/src/screens/LeadCommandCenter.tsx` | Full-screen shell: header + tab bar + panel routing |
| `app/frontend/src/screens/panels/BriefPanel.tsx` | Brief tab: screenshot, contact, gate, AI quick read + next message |
| `app/frontend/src/screens/panels/QuotePanel.tsx` | Quote tab: scope + AI pricing (F–L) + chat thread |
| `app/frontend/src/screens/panels/LogPanel.tsx` | Log tab: status controls, notes, screenshots, history |
| `app/frontend/src/components/GateIndicator.tsx` | Gate 0→1→2A→2B visual progress bar |
| `app/frontend/src/components/AiChatThread.tsx` | Chat message thread + input |
| `app/frontend/src/components/IngestProgressFlow.tsx` | Upload → OCR → AI review progress modal |

### Modified files
| File | Change |
|---|---|
| `app/backend/main.py` | Import chat model + register chat router |
| `app/frontend/src/types/lead.ts` | Add `ChatMessage` type; add `quote_context` to `Lead` and `LeadUpdate` |
| `app/frontend/src/services/api.ts` | Add `fetchChatMessages`, `sendChatMessage` |
| `app/frontend/src/hooks/useLeads.ts` | Add `useChatMessages`, `useSendChatMessage` |
| `app/frontend/src/App.tsx` | Add React Router `Routes`/`Route` |
| `app/frontend/src/main.tsx` | Wrap app in `BrowserRouter` |
| `app/frontend/src/screens/LeadQueue.tsx` | Router navigation + screenshot upload button |
| `app/frontend/vite.config.ts` | Add `/leads` catch-all for React Router |

### Retired
| File | Reason |
|---|---|
| `app/frontend/src/screens/LeadDetail.tsx` | All logic moves into the three panel components |

---

## Task 1 — Install react-router-dom + update frontend types

**Files:**
- Modify: `app/frontend/src/types/lead.ts`

- [ ] **Step 1: Install react-router-dom**

```bash
cd app/frontend && npm install react-router-dom
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Add `ChatMessage` type and `quote_context` to `types/lead.ts`**

Add to the bottom of `app/frontend/src/types/lead.ts`:

```typescript
export interface ChatMessage {
  id: string
  lead_id: string
  ai_review_id: string | null
  role: 'user' | 'assistant'
  content: string
  created_at: string
}
```

Add `quote_context` to the `Lead` interface (after `acknowledgment_sent`):

```typescript
  quote_context: string | null
```

Add `quote_context` to the `LeadUpdate` interface (after `move_date_options`):

```typescript
  quote_context?: string | null
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd app/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd app/frontend && cd ../..
git add app/frontend/src/types/lead.ts app/frontend/package.json app/frontend/package-lock.json
git commit -m "feat: install react-router-dom, add ChatMessage type and quote_context to Lead types"
```

---

## Task 2 — Backend: lead_chat_messages model

**Files:**
- Create: `app/backend/app/models/lead_chat_message.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Create the ORM model**

Create `app/backend/app/models/lead_chat_message.py`:

```python
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text

from app.database import Base


class LeadChatMessage(Base):
    __tablename__ = "lead_chat_messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lead_id = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    ai_review_id = Column(String, ForeignKey("ai_reviews.id", ondelete="SET NULL"), nullable=True)
    role = Column(String, nullable=False)   # 'user' | 'assistant'
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Register the model in `main.py`**

In `app/backend/main.py`, add after the existing model imports:

```python
import app.models.lead_chat_message  # noqa: F401
```

`create_all` in the lifespan will create the new table automatically — no migration function needed since the table is brand new.

- [ ] **Step 3: Verify the table is created on startup**

```bash
cd app/backend && python -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.database import Base
import app.models.lead
import app.models.lead_event
import app.models.screenshot
import app.models.ocr_result
import app.models.ai_review
import app.models.lead_chat_message

async def check():
    engine = create_async_engine('sqlite+aiosqlite:///./test_check.db')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print('Tables:', list(Base.metadata.tables.keys()))
    await engine.dispose()
    import os; os.remove('test_check.db')

asyncio.run(check())
"
```

Expected output includes `lead_chat_messages` in the table list.

- [ ] **Step 4: Commit**

```bash
git add app/backend/app/models/lead_chat_message.py app/backend/main.py
git commit -m "feat: add lead_chat_messages ORM model"
```

---

## Task 3 — Backend: chat schemas + service

**Files:**
- Create: `app/backend/app/schemas/chat.py`
- Create: `app/backend/app/services/chat_service.py`

- [ ] **Step 1: Create chat schemas**

Create `app/backend/app/schemas/chat.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    ai_review_id: Optional[str] = None


class ChatMessageOut(BaseModel):
    id: str
    lead_id: str
    ai_review_id: Optional[str]
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Create chat service**

Create `app/backend/app/services/chat_service.py`:

```python
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import anthropic
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_review import AiReview
from app.models.lead import Lead
from app.models.lead_chat_message import LeadChatMessage
from app.services.ai_review_service import _load_grounding


def _make_client(api_key: str) -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=api_key)


def _build_system_prompt(lead: Lead, latest_review: Optional[AiReview]) -> str:
    grounding_content, _ = _load_grounding()

    parts = [
        f"Service: {lead.service_type.value}",
        f"Customer: {lead.customer_name or 'Unknown'}",
    ]
    if lead.job_origin or lead.job_destination:
        parts.append(f"Moving: {lead.job_origin or '?'} → {lead.job_destination or '?'}")
    elif lead.job_location:
        parts.append(f"Location: {lead.job_location}")
    if lead.job_date_requested:
        parts.append(f"Date: {lead.job_date_requested}")
    if lead.move_size_label:
        parts.append(f"Move size: {lead.move_size_label}")
    if lead.move_type:
        parts.append(f"Move type: {lead.move_type}")
    if lead.move_distance_miles is not None:
        parts.append(f"Distance: {lead.move_distance_miles} miles")
    if lead.load_stairs is not None:
        parts.append(f"Load stairs: {lead.load_stairs} flights")
    if lead.unload_stairs is not None:
        parts.append(f"Unload stairs: {lead.unload_stairs} flights")
    if lead.scope_notes:
        parts.append(f"Scope notes: {lead.scope_notes}")
    if lead.quote_context:
        parts.append(f"Facilitator context: {lead.quote_context}")

    lead_summary = "\n".join(parts)

    pricing_context = ""
    if latest_review:
        s = json.loads(latest_review.sections_json)
        pricing_context = (
            "\n\nCURRENT AI PRICING ASSESSMENT (internal):\n"
            f"F - Pricing Band: {s.get('f_pricing_band', '—')}\n"
            f"G - Band Position: {s.get('g_band_position', '—')}\n"
            f"H - Friction Points: {s.get('h_friction_points', '—')}\n"
            f"I - Sayability: {s.get('i_sayability_check', '—')}\n"
            f"J - Quote Style: {s.get('j_quote_style', '—')}\n"
            f"K - Source Label: {s.get('k_quote_source_label', '—')}\n"
            f"L - Internal Guidance: {s.get('l_pricing_guidance', '—')}"
        )

    return (
        "You are a pricing coach for Holy Hauling, a moving and junk hauling company. "
        "The facilitator is reviewing a live lead and wants to challenge or refine the AI pricing assessment. "
        "Respond in 2–4 sentences. Be direct and specific — give dollar ranges when you can. "
        "This is an internal tool; never write as if speaking to the customer.\n\n"
        f"HOLY HAULING SOPs:\n{grounding_content}\n\n"
        f"CURRENT LEAD:\n{lead_summary}"
        f"{pricing_context}"
    )


async def get_messages(db: AsyncSession, lead_id: str) -> list[LeadChatMessage]:
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    if not lead_result.scalar_one_or_none():
        raise HTTPException(404, "Lead not found")

    result = await db.execute(
        select(LeadChatMessage)
        .where(LeadChatMessage.lead_id == lead_id)
        .order_by(LeadChatMessage.created_at)
    )
    return list(result.scalars().all())


async def send_message(
    db: AsyncSession,
    lead_id: str,
    message: str,
    ai_review_id: Optional[str] = None,
) -> list[LeadChatMessage]:
    lead_result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = lead_result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    review_result = await db.execute(
        select(AiReview)
        .where(AiReview.lead_id == lead_id)
        .order_by(AiReview.created_at.desc())
        .limit(1)
    )
    latest_review = review_result.scalar_one_or_none()

    history_result = await db.execute(
        select(LeadChatMessage)
        .where(LeadChatMessage.lead_id == lead_id)
        .order_by(LeadChatMessage.created_at)
    )
    history = list(history_result.scalars().all())

    user_msg = LeadChatMessage(
        id=str(uuid.uuid4()),
        lead_id=lead_id,
        ai_review_id=ai_review_id,
        role="user",
        content=message,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user_msg)
    await db.flush()

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")

    model = os.environ.get("AI_REVIEW_MODEL", "claude-haiku-4-5-20251001")
    client = _make_client(api_key)
    system = _build_system_prompt(lead, latest_review)
    chat_messages = [{"role": m.role, "content": m.content} for m in history]
    chat_messages.append({"role": "user", "content": message})

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=512,
            system=system,
            messages=chat_messages,
        )
        reply = response.content[0].text
    except Exception as exc:
        raise HTTPException(502, f"Chat AI call failed: {exc}") from exc

    assistant_msg = LeadChatMessage(
        id=str(uuid.uuid4()),
        lead_id=lead_id,
        ai_review_id=ai_review_id,
        role="assistant",
        content=reply,
        created_at=datetime.now(timezone.utc),
    )
    db.add(assistant_msg)
    await db.commit()

    return [user_msg, assistant_msg]
```

- [ ] **Step 3: Verify imports resolve**

```bash
cd app/backend && python -c "from app.services import chat_service; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add app/backend/app/schemas/chat.py app/backend/app/services/chat_service.py
git commit -m "feat: add chat schemas and chat_service"
```

---

## Task 4 — Backend: chat router + register + tests

**Files:**
- Create: `app/backend/app/routers/chat.py`
- Create: `app/backend/tests/test_chat.py`
- Modify: `app/backend/main.py`

- [ ] **Step 1: Create chat router**

Create `app/backend/app/routers/chat.py`:

```python
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.chat import ChatMessageOut, ChatRequest
from app.services import chat_service

router = APIRouter(prefix="/leads", tags=["chat"])


@router.get("/{lead_id}/chat", response_model=list[ChatMessageOut])
async def get_chat(lead_id: str, db: AsyncSession = Depends(get_db)):
    return await chat_service.get_messages(db, lead_id)


@router.post("/{lead_id}/chat", response_model=list[ChatMessageOut])
async def send_message(
    lead_id: str,
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    return await chat_service.send_message(db, lead_id, data.message, data.ai_review_id)
```

- [ ] **Step 2: Register the chat router in `main.py`**

In `app/backend/main.py`, add to the router imports:

```python
from app.routers import ingest, leads, chat
```

And add after `app.include_router(leads.router)`:

```python
app.include_router(chat.router)
```

- [ ] **Step 3: Write the failing tests**

Create `app/backend/tests/test_chat.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


async def _make_lead(client):
    r = await client.post("/leads", json={
        "source_type": "manual",
        "customer_name": "Tina M.",
        "service_type": "moving",
        "job_location": "St. Louis, MO",
    })
    assert r.status_code == 201
    return r.json()["id"]


@pytest.mark.asyncio
async def test_get_chat_empty(client):
    lead_id = await _make_lead(client)
    r = await client.get(f"/leads/{lead_id}/chat")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_chat_404_unknown_lead(client):
    r = await client.get("/leads/does-not-exist/chat")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_send_chat_message(client):
    lead_id = await _make_lead(client)

    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(text="Based on a standard moving job, $350–$500 is reasonable.")]

    with patch("app.services.chat_service._make_client") as mock_client_fn:
        mock_instance = MagicMock()
        mock_instance.messages.create = AsyncMock(return_value=mock_resp)
        mock_client_fn.return_value = mock_instance

        r = await client.post(
            f"/leads/{lead_id}/chat",
            json={"message": "Why is the band $350–$500?"},
        )

    assert r.status_code == 200
    messages = r.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Why is the band $350–$500?"
    assert messages[1]["role"] == "assistant"
    assert "350" in messages[1]["content"]


@pytest.mark.asyncio
async def test_chat_history_persists(client):
    lead_id = await _make_lead(client)

    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(text="Yes, stairs add $50–$75.")]

    with patch("app.services.chat_service._make_client") as mock_client_fn:
        mock_instance = MagicMock()
        mock_instance.messages.create = AsyncMock(return_value=mock_resp)
        mock_client_fn.return_value = mock_instance

        await client.post(f"/leads/{lead_id}/chat", json={"message": "Does 2 flights of stairs change the price?"})

    r = await client.get(f"/leads/{lead_id}/chat")
    assert r.status_code == 200
    messages = r.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd app/backend && python -m pytest tests/test_chat.py -v
```

Expected:
```
tests/test_chat.py::test_get_chat_empty PASSED
tests/test_chat.py::test_get_chat_404_unknown_lead PASSED
tests/test_chat.py::test_send_chat_message PASSED
tests/test_chat.py::test_chat_history_persists PASSED
4 passed
```

- [ ] **Step 5: Commit**

```bash
git add app/backend/app/routers/chat.py app/backend/tests/test_chat.py app/backend/main.py
git commit -m "feat: add chat router, register with app, add chat tests"
```

---

## Task 5 — Frontend: router wiring

**Files:**
- Modify: `app/frontend/src/main.tsx`
- Modify: `app/frontend/src/App.tsx`
- Modify: `app/frontend/vite.config.ts`

- [ ] **Step 1: Wrap app in BrowserRouter in `main.tsx`**

Replace the contents of `app/frontend/src/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 2: Add routes to `App.tsx`**

Replace the contents of `app/frontend/src/App.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { LeadCommandCenter } from './screens/LeadCommandCenter'
import { LeadQueue } from './screens/LeadQueue'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<LeadQueue />} />
        <Route path="/leads/:id" element={<LeadCommandCenter />} />
      </Routes>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 3: Update `vite.config.ts` to handle client-side routing**

The dev server must serve `index.html` for all unmatched routes so React Router can handle `/leads/:id`. Replace `app/frontend/vite.config.ts` with:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/leads': 'http://localhost:8000',
      '/ingest': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
```

Note: Vite's proxy runs before the SPA fallback, so `/leads` API calls still go to the backend. The React Router `/leads/:id` route is matched client-side because Vite serves `index.html` for unmatched non-proxy paths by default.

- [ ] **Step 4: Create a placeholder `LeadCommandCenter` so the app compiles**

Create `app/frontend/src/screens/LeadCommandCenter.tsx`:

```tsx
import { useParams, useNavigate } from 'react-router-dom'

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  return (
    <div className="p-8">
      <button onClick={() => navigate('/')} className="text-blue-600 underline mb-4 block">← Back</button>
      <p className="text-gray-500">Command Center — lead {id} (coming soon)</p>
    </div>
  )
}
```

- [ ] **Step 5: Verify the app builds**

```bash
cd app/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Start the app and verify routing works**

```bash
cd ../.. && python run.py
```

Open `http://localhost:5173` — queue loads. Manually visit `http://localhost:5173/leads/any-id` — placeholder screen loads without 404. Press browser back — returns to queue.

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/main.tsx app/frontend/src/App.tsx app/frontend/vite.config.ts app/frontend/src/screens/LeadCommandCenter.tsx
git commit -m "feat: add React Router, wire LeadQueue and LeadCommandCenter routes"
```

---

## Task 6 — Frontend: GateIndicator + chat API + hooks

**Files:**
- Create: `app/frontend/src/components/GateIndicator.tsx`
- Modify: `app/frontend/src/services/api.ts`
- Modify: `app/frontend/src/hooks/useLeads.ts`

- [ ] **Step 1: Create `GateIndicator` component**

Create `app/frontend/src/components/GateIndicator.tsx`:

```tsx
import type { LeadStatus } from '../types/lead'

const STEPS = ['Gate 0', 'Gate 1', 'Gate 2A', 'Gate 2B', 'Booked']

const STATUS_TO_STEP: Partial<Record<LeadStatus, number>> = {
  new: 0,
  in_review: 1,
  waiting_on_customer: 1,
  ready_for_quote: 2,
  ready_for_booking: 3,
  booked: 4,
}

interface Props {
  status: LeadStatus
}

export function GateIndicator({ status }: Props) {
  const current = STATUS_TO_STEP[status] ?? -1

  if (current === -1) {
    return (
      <span className="text-xs text-gray-400 italic">
        {status === 'released' ? 'Released' : 'Escalated'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div
            className={`flex items-center justify-center rounded-full text-[9px] font-bold w-5 h-5 shrink-0 ${
              i < current
                ? 'bg-green-500 text-white'
                : i === current
                ? 'bg-indigo-600 text-white ring-2 ring-indigo-200'
                : 'bg-gray-200 text-gray-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-3 h-px shrink-0 ${i < current ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add chat API functions to `api.ts`**

Add to the bottom of `app/frontend/src/services/api.ts`:

```typescript
export async function fetchChatMessages(leadId: string): Promise<ChatMessage[]> {
  const r = await fetch(`/leads/${leadId}/chat`)
  if (!r.ok) throw new Error('Failed to fetch chat')
  return r.json()
}

export async function sendChatMessage(
  leadId: string,
  message: string,
  aiReviewId?: string,
): Promise<ChatMessage[]> {
  const r = await fetch(`/leads/${leadId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ai_review_id: aiReviewId ?? null }),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(body?.detail ?? `Chat failed: ${r.status}`)
  }
  return r.json()
}
```

Add the import for `ChatMessage` at the top of `api.ts`:

```typescript
import type { AiReview, ChatMessage, IngestResult, Lead, LeadCreate, LeadEvent, LeadStatus, LeadUpdate, OcrResult, Screenshot } from '../types/lead'
```

- [ ] **Step 3: Add chat hooks to `useLeads.ts`**

Add to the bottom of `app/frontend/src/hooks/useLeads.ts`:

```typescript
export function useChatMessages(leadId: string) {
  return useQuery({
    queryKey: ['chat', leadId],
    queryFn: () => fetchChatMessages(leadId),
    enabled: !!leadId,
  })
}

export function useSendChatMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      leadId,
      message,
      aiReviewId,
    }: {
      leadId: string
      message: string
      aiReviewId?: string
    }) => sendChatMessage(leadId, message, aiReviewId),
    onSuccess: (_, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['chat', leadId] })
    },
  })
}
```

Add `fetchChatMessages` and `sendChatMessage` to the import from `../services/api` in `useLeads.ts`.

- [ ] **Step 4: Verify TypeScript**

```bash
cd app/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/GateIndicator.tsx app/frontend/src/services/api.ts app/frontend/src/hooks/useLeads.ts
git commit -m "feat: add GateIndicator component, chat API calls, and chat hooks"
```

---

## Task 7 — Frontend: LeadCommandCenter shell

**Files:**
- Modify: `app/frontend/src/screens/LeadCommandCenter.tsx`

- [ ] **Step 1: Replace the placeholder with the real shell**

Replace `app/frontend/src/screens/LeadCommandCenter.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AgeIndicator } from '../components/AgeIndicator'
import { GateIndicator } from '../components/GateIndicator'
import { StatusBadge } from '../components/StatusBadge'
import { useLead, useLatestAiReview, useTriggerAiReview } from '../hooks/useLeads'
import { BriefPanel } from './panels/BriefPanel'
import { LogPanel } from './panels/LogPanel'
import { QuotePanel } from './panels/QuotePanel'

type Tab = 'brief' | 'quote' | 'log'

export function LeadCommandCenter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('brief')

  const { data: lead, isLoading } = useLead(id!)
  const { data: aiReview } = useLatestAiReview(id!)
  const triggerReview = useTriggerAiReview()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 gap-4">
        <p className="text-sm text-gray-500">Lead not found.</p>
        <button onClick={() => navigate('/')} className="text-sm text-blue-600 underline">
          Back to queue
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">

      {/* ── Fixed header ─────────────────────────────────────────────── */}
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3 shrink-0 z-20">
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 hover:text-gray-800 text-xl leading-none shrink-0"
          aria-label="Back to queue"
        >
          ←
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-gray-900 truncate text-base leading-tight">
            {lead.customer_name ?? <span className="italic text-gray-400 font-normal">No name yet</span>}
          </h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <StatusBadge status={lead.status} />
            {lead.urgency_flag && (
              <span className="text-xs font-bold text-orange-500 uppercase">Urgent</span>
            )}
            <AgeIndicator createdAt={lead.created_at} />
          </div>
          <div className="mt-1">
            <GateIndicator status={lead.status} />
          </div>
        </div>

        <button
          onClick={() => triggerReview.mutate({ leadId: id! })}
          disabled={triggerReview.isPending}
          className="text-xs bg-indigo-600 text-white rounded-lg px-3 py-2 hover:bg-indigo-700 disabled:opacity-50 shrink-0 font-medium"
        >
          {triggerReview.isPending ? 'Running…' : aiReview ? 'Re-run AI' : 'Run AI Review'}
        </button>
      </header>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <nav className="bg-white border-b flex shrink-0">
        {(['brief', 'quote', 'log'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium capitalize transition-colors border-b-2 ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {/* ── Scrollable panel ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {tab === 'brief' && <BriefPanel lead={lead} aiReview={aiReview} />}
        {tab === 'quote' && <QuotePanel lead={lead} aiReview={aiReview} leadId={id!} />}
        {tab === 'log'   && <LogPanel lead={lead} leadId={id!} />}
      </main>

    </div>
  )
}
```

- [ ] **Step 2: Create placeholder panel stubs so the app compiles**

Create `app/frontend/src/screens/panels/BriefPanel.tsx`:

```tsx
import type { AiReview, Lead } from '../../types/lead'

interface Props { lead: Lead; aiReview: AiReview | undefined }

export function BriefPanel({ lead }: Props) {
  return <div className="p-5 text-sm text-gray-400">Brief — {lead.customer_name}</div>
}
```

Create `app/frontend/src/screens/panels/QuotePanel.tsx`:

```tsx
import type { AiReview, Lead } from '../../types/lead'

interface Props { lead: Lead; aiReview: AiReview | undefined; leadId: string }

export function QuotePanel({ lead }: Props) {
  return <div className="p-5 text-sm text-gray-400">Quote — {lead.customer_name}</div>
}
```

Create `app/frontend/src/screens/panels/LogPanel.tsx`:

```tsx
import type { Lead } from '../../types/lead'

interface Props { lead: Lead; leadId: string }

export function LogPanel({ lead }: Props) {
  return <div className="p-5 text-sm text-gray-400">Log — {lead.customer_name}</div>
}
```

- [ ] **Step 3: Verify TypeScript and test in browser**

```bash
cd app/frontend && npx tsc --noEmit
```

Start `python run.py`, click any lead in the queue — it should navigate to the command center with the real header (name, status, gate, AI button) and three tabs. Switching tabs shows the placeholder text.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/screens/LeadCommandCenter.tsx app/frontend/src/screens/panels/
git commit -m "feat: LeadCommandCenter shell with header, tab bar, and panel stubs"
```

---

## Task 8 — Frontend: BriefPanel

**Files:**
- Modify: `app/frontend/src/screens/panels/BriefPanel.tsx`

- [ ] **Step 1: Implement BriefPanel**

Replace `app/frontend/src/screens/panels/BriefPanel.tsx`:

```tsx
import { useState } from 'react'
import { useAcknowledgeLead } from '../../hooks/useLeads'
import type { AiReview, Lead } from '../../types/lead'

interface Props {
  lead: Lead
  aiReview: AiReview | undefined
}

export function BriefPanel({ lead, aiReview }: Props) {
  const acknowledge = useAcknowledgeLead()
  const [copied, setCopied] = useState(false)

  const intakeShot = lead.screenshots?.find(s => s.screenshot_type === 'intake')

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="p-4 space-y-4 pb-10">

      {/* Screenshot thumbnail */}
      {intakeShot && (
        <section>
          <a
            href={`/uploads/${intakeShot.stored_path}`}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl overflow-hidden border border-gray-200 bg-gray-100"
          >
            <img
              src={`/uploads/${intakeShot.stored_path}`}
              alt="Thumbtack screenshot"
              className="w-full object-cover max-h-48"
            />
            <p className="text-xs text-gray-400 px-3 py-1.5">Tap to open full size</p>
          </a>
        </section>
      )}

      {/* Acknowledgment banner */}
      {!lead.acknowledged_at ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3">
          <span className="text-sm text-red-700 font-medium">Not yet acknowledged</span>
          <button
            onClick={() => acknowledge.mutate({ id: lead.id })}
            disabled={acknowledge.isPending}
            className="text-xs bg-red-600 text-white rounded-lg px-3 py-1.5 hover:bg-red-700 disabled:opacity-50 shrink-0"
          >
            {acknowledge.isPending ? 'Saving…' : 'Acknowledge'}
          </button>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
          <p className="text-sm text-green-700">
            Acknowledged {new Date(lead.acknowledged_at).toLocaleString()}
          </p>
        </div>
      )}

      {/* Contact */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Contact</h3>
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <p className="font-semibold text-gray-900">
            {lead.customer_name ?? <span className="italic text-gray-400 font-normal">No name captured</span>}
          </p>
          {lead.customer_phone ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-700">📞 {lead.customer_phone}</span>
              <a href={`tel:${lead.customer_phone}`}
                className="text-xs bg-green-600 text-white rounded-lg px-3 py-1 font-medium hover:bg-green-700">
                Call
              </a>
              <a href={`sms:${lead.customer_phone}`}
                className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1 font-medium hover:bg-blue-700">
                Text
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Phone not captured</p>
          )}
          <p className="text-xs text-gray-400">{lead.source_category_label}</p>
        </div>
      </section>

      {/* AI Quick Read */}
      {aiReview ? (
        <>
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Quick Read
            </h3>
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                {aiReview.sections.m_quick_read || '—'}
              </p>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Next Best Message
              </h3>
              <button
                onClick={() => handleCopy(aiReview.sections.a_next_message)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
              <p className="text-sm text-indigo-900 leading-relaxed whitespace-pre-wrap">
                {aiReview.sections.a_next_message || '—'}
              </p>
            </div>
          </section>
        </>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-sm text-gray-400">
            No AI review yet — tap <strong>Run AI Review</strong> above.
          </p>
        </div>
      )}

    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript and test in browser**

```bash
cd app/frontend && npx tsc --noEmit
```

Start the app. Open a lead that has a screenshot and an AI review. The Brief tab should show the screenshot thumbnail, contact info with call/text buttons, the quick read, and the next best message with a Copy button.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/screens/panels/BriefPanel.tsx
git commit -m "feat: implement BriefPanel with screenshot, contact, and AI quick read"
```

---

## Task 9 — Frontend: QuotePanel (scope + AI pricing)

**Files:**
- Modify: `app/frontend/src/screens/panels/QuotePanel.tsx`

- [ ] **Step 1: Implement QuotePanel scope + pricing (chat wired in Task 10)**

Replace `app/frontend/src/screens/panels/QuotePanel.tsx`:

```tsx
import { useState } from 'react'
import { usePatchLead } from '../../hooks/useLeads'
import type { AiReview, AiReviewSections, Lead } from '../../types/lead'

const PRICING_SECTIONS: { key: keyof AiReviewSections; label: string }[] = [
  { key: 'f_pricing_band',       label: 'F. Pricing Band' },
  { key: 'g_band_position',      label: 'G. Band Position' },
  { key: 'h_friction_points',    label: 'H. Main Friction Points' },
  { key: 'i_sayability_check',   label: 'I. Sayability Check' },
  { key: 'j_quote_style',        label: 'J. Quote Style' },
  { key: 'k_quote_source_label', label: 'K. Quote Source Label' },
  { key: 'l_pricing_guidance',   label: 'L. Internal Pricing Guidance' },
]

interface Props {
  lead: Lead
  aiReview: AiReview | undefined
  leadId: string
}

export function QuotePanel({ lead, aiReview, leadId }: Props) {
  const patch = usePatchLead()
  const [context, setContext] = useState(lead.quote_context ?? '')
  const [saved, setSaved] = useState(false)

  const handleSaveContext = () => {
    patch.mutate(
      { id: leadId, data: { quote_context: context || null } },
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        },
      },
    )
  }

  return (
    <div className="p-4 space-y-5 pb-10">

      {/* ── Scope ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Scope</h3>
        <div className="bg-white rounded-xl border divide-y">

          <ScopeRow label="Service" value={lead.service_type} />

          {(lead.job_origin || lead.job_destination) ? (
            <ScopeRow
              label="Route"
              value={`${lead.job_origin || '?'} → ${lead.job_destination || '?'}`}
            />
          ) : lead.job_location ? (
            <ScopeRow label="Location" value={lead.job_location} />
          ) : (
            <ScopeRow label="Location" value={null} />
          )}

          {lead.move_date_options && lead.move_date_options.length > 0 ? (
            <ScopeRow label="Dates" value={lead.move_date_options.join(', ')} />
          ) : (
            <ScopeRow label="Date" value={lead.job_date_requested} />
          )}

          <ScopeRow label="Move size" value={lead.move_size_label} />
          <ScopeRow label="Move type" value={lead.move_type?.replace(/_/g, ' ')} />
          {lead.move_distance_miles != null && (
            <ScopeRow label="Distance" value={`~${Math.round(lead.move_distance_miles)} mi`} />
          )}
          {(lead.load_stairs != null || lead.unload_stairs != null) && (
            <ScopeRow
              label="Stairs"
              value={[
                lead.load_stairs != null ? `Load: ${lead.load_stairs} flight${lead.load_stairs !== 1 ? 's' : ''}` : null,
                lead.unload_stairs != null ? `Unload: ${lead.unload_stairs} flight${lead.unload_stairs !== 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(' · ')}
            />
          )}
          {lead.scope_notes && (
            <div className="px-4 py-3">
              <p className="text-xs text-gray-400 mb-1">Scope notes</p>
              <p className="text-sm text-gray-800 leading-relaxed">{lead.scope_notes}</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Quote context ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Add Context Before Re-running Review
        </h3>
        <textarea
          rows={3}
          className="w-full border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g. Elevator is passenger-style not freight. Has a piano. Customer confirmed wrapping needed."
          value={context}
          onChange={e => setContext(e.target.value)}
        />
        <button
          onClick={handleSaveContext}
          disabled={patch.isPending}
          className="mt-2 text-xs bg-gray-800 text-white rounded-lg px-4 py-1.5 hover:bg-gray-700 disabled:opacity-50"
        >
          {patch.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Context'}
        </button>
      </section>

      {/* ── AI Pricing (F–L) ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-xs font-semibold text-orange-600 uppercase tracking-wider">
            AI Pricing Guidance
          </h3>
          <span className="text-xs font-bold text-orange-500 uppercase">— Internal Only</span>
        </div>

        {aiReview ? (
          <div className="space-y-2">
            {PRICING_SECTIONS.map(({ key, label }) => (
              <div key={key} className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700 mb-1">{label}</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {aiReview.sections[key] || '—'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-400">
              Run AI Review to see pricing guidance.
            </p>
          </div>
        )}
      </section>

      {/* Chat wired in Task 10 */}

    </div>
  )
}

function ScopeRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="text-xs text-gray-400 w-24 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-gray-800 flex-1">
        {value || <span className="italic text-gray-300">—</span>}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript and test in browser**

```bash
cd app/frontend && npx tsc --noEmit
```

Open a lead. Quote tab shows scope rows, the context textarea, and pricing sections (orange-tinted) if a review exists.

- [ ] **Step 3: Commit**

```bash
git add app/frontend/src/screens/panels/QuotePanel.tsx
git commit -m "feat: implement QuotePanel with scope, quote_context, and AI pricing sections"
```

---

## Task 10 — Frontend: AiChatThread + wire into QuotePanel

**Files:**
- Create: `app/frontend/src/components/AiChatThread.tsx`
- Modify: `app/frontend/src/screens/panels/QuotePanel.tsx`

- [ ] **Step 1: Create `AiChatThread` component**

Create `app/frontend/src/components/AiChatThread.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useChatMessages, useSendChatMessage } from '../hooks/useLeads'

interface Props {
  leadId: string
  aiReviewId?: string
}

export function AiChatThread({ leadId, aiReviewId }: Props) {
  const { data: messages = [], isLoading } = useChatMessages(leadId)
  const sendMessage = useSendChatMessage()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    sendMessage.mutate(
      { leadId, message: text, aiReviewId },
      { onSuccess: () => setInput('') },
    )
  }

  return (
    <div className="flex flex-col">

      {/* Thread */}
      <div className="space-y-3 min-h-[4rem]">
        {isLoading && <p className="text-xs text-gray-400">Loading chat…</p>}
        {!isLoading && messages.length === 0 && (
          <p className="text-xs text-gray-400 italic">
            No messages yet. Challenge the pricing or add context.
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              <p className={`text-[10px] mt-1 ${m.role === 'user' ? 'text-indigo-300' : 'text-gray-400'}`}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {sendMessage.isPending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-xs text-gray-400">
              Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {sendMessage.isError && (
        <p className="text-xs text-red-600 mt-2">
          {(sendMessage.error as Error)?.message ?? 'Send failed'}
        </p>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="flex gap-2 mt-3">
        <input
          className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          placeholder="Challenge this or add context…"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={sendMessage.isPending}
        />
        <button
          type="submit"
          disabled={!input.trim() || sendMessage.isPending}
          className="bg-indigo-600 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Wire `AiChatThread` into `QuotePanel`**

In `app/frontend/src/screens/panels/QuotePanel.tsx`, add the import at the top:

```tsx
import { AiChatThread } from '../../components/AiChatThread'
```

Replace the `{/* Chat wired in Task 10 */}` comment with:

```tsx
      {/* ── AI Pricing Chat ────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Challenge / Refine Pricing
        </h3>
        <AiChatThread leadId={leadId} aiReviewId={aiReview?.id} />
      </section>
```

- [ ] **Step 3: Verify TypeScript and test end-to-end**

```bash
cd app/frontend && npx tsc --noEmit
```

Start the app. Open a lead, go to Quote tab, scroll to the bottom. Type a message like "What if there are 3 flights of stairs?" and send. Expect a 2–4 sentence AI reply. Refresh the page — the message history should persist (fetched from `GET /leads/:id/chat`).

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/components/AiChatThread.tsx app/frontend/src/screens/panels/QuotePanel.tsx
git commit -m "feat: add AiChatThread component and wire into QuotePanel"
```

---

## Task 11 — Frontend: LogPanel

**Files:**
- Modify: `app/frontend/src/screens/panels/LogPanel.tsx`

- [ ] **Step 1: Implement LogPanel**

Replace `app/frontend/src/screens/panels/LogPanel.tsx`:

```tsx
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useAddNote,
  useDeleteLead,
  useUpdateStatus,
  useUploadScreenshot,
} from '../../hooks/useLeads'
import type { Lead, LeadStatus, OcrField, OcrResult } from '../../types/lead'
import {
  useApplyOcrFields,
  useTriggerExtraction,
} from '../../hooks/useLeads'

const ALL_STATUSES: LeadStatus[] = [
  'new', 'in_review', 'waiting_on_customer', 'ready_for_quote',
  'ready_for_booking', 'escalated', 'booked', 'released',
]

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  in_review: 'In Review',
  waiting_on_customer: 'Waiting',
  ready_for_quote: 'Ready to Quote',
  ready_for_booking: 'Ready to Book',
  escalated: 'Escalated',
  booked: 'Booked',
  released: 'Released',
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Lead created',
  status_changed: 'Status changed',
  acknowledged: 'Acknowledged',
  field_updated: 'Fields updated',
  note_added: 'Operational note',
  screenshot_added: 'Screenshot attached',
  assigned: 'Assigned',
  ocr_fields_applied: 'Extraction applied',
}

interface Props {
  lead: Lead
  leadId: string
}

export function LogPanel({ lead, leadId }: Props) {
  const navigate = useNavigate()
  const updateStatus   = useUpdateStatus()
  const addNote        = useAddNote()
  const uploadShot     = useUploadScreenshot()
  const triggerExtract = useTriggerExtraction()
  const applyOcr       = useApplyOcrFields()
  const deleteLead     = useDeleteLead()

  const [noteBody, setNoteBody] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [extractResults, setExtractResults] = useState<Record<string, OcrResult>>({})
  const [applyDraft, setApplyDraft] = useState<Record<string, Record<string, string>>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const handleNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteBody.trim()) return
    addNote.mutate(
      { leadId, body: noteBody.trim() },
      { onSuccess: () => setNoteBody('') },
    )
  }

  const handleAddScreenshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    uploadShot.mutate({ leadId, file })
    e.target.value = ''
  }

  const handleExtract = (screenshotId: string) => {
    triggerExtract.mutate(
      { leadId, screenshotId },
      {
        onSuccess: result => {
          setExtractResults(prev => ({ ...prev, [screenshotId]: result }))
          if (result.extracted_fields) {
            const fields: OcrField[] = JSON.parse(result.extracted_fields)
            const draft: Record<string, string> = {}
            fields.forEach(f => { draft[f.field] = f.value })
            setApplyDraft(prev => ({ ...prev, [screenshotId]: draft }))
          }
        },
      },
    )
  }

  const handleApply = (screenshotId: string) => {
    applyOcr.mutate({ leadId, screenshotId, fields: applyDraft[screenshotId] ?? {} })
  }

  const handleDelete = () => {
    if (window.confirm('Permanently delete this lead and all its data? This cannot be undone.')) {
      deleteLead.mutate(leadId, { onSuccess: () => navigate('/') })
    }
  }

  return (
    <div className="p-4 space-y-5 pb-10">

      {/* ── Status transitions ─────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Move to Status</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.filter(s => s !== lead.status).map(s => (
            <button
              key={s}
              onClick={() => updateStatus.mutate({ id: leadId, status: s })}
              disabled={updateStatus.isPending}
              className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      {/* ── Operational note ───────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Add Note</h3>
        <form onSubmit={handleNoteSubmit} className="space-y-2">
          <textarea
            rows={2}
            className="w-full border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Called customer — left voicemail. Gate 1 attempt."
            value={noteBody}
            onChange={e => setNoteBody(e.target.value)}
          />
          <button
            type="submit"
            disabled={addNote.isPending || !noteBody.trim()}
            className="text-xs bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50"
          >
            {addNote.isPending ? 'Saving…' : 'Add Note'}
          </button>
        </form>
      </section>

      {/* ── Screenshots ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Screenshots {lead.screenshots && lead.screenshots.length > 0 && `(${lead.screenshots.length})`}
          </h3>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadShot.isPending}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
          >
            {uploadShot.isPending ? 'Uploading…' : '+ Add Screenshot'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAddScreenshot}
          />
        </div>

        {lead.screenshots && lead.screenshots.length > 0 && (
          <div className="space-y-3">
            {lead.screenshots.map(s => {
              const result = extractResults[s.id]
              const draft = applyDraft[s.id] ?? {}
              const extractedFields: OcrField[] = result?.extracted_fields
                ? JSON.parse(result.extracted_fields)
                : []
              const isExtracting = triggerExtract.isPending && triggerExtract.variables?.screenshotId === s.id

              return (
                <div key={s.id} className="bg-white border rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={`/uploads/${s.stored_path}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline truncate flex-1"
                    >
                      🖼 {s.original_filename}
                    </a>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.ocr_status && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          s.ocr_status === 'done' ? 'bg-green-100 text-green-700' :
                          s.ocr_status === 'failed' ? 'bg-red-100 text-red-600' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>{s.ocr_status}</span>
                      )}
                      <button
                        onClick={() => handleExtract(s.id)}
                        disabled={isExtracting}
                        className="text-xs bg-gray-700 text-white rounded px-2.5 py-1 hover:bg-gray-600 disabled:opacity-50"
                      >
                        {isExtracting ? 'Extracting…' : 'Extract'}
                      </button>
                    </div>
                  </div>

                  {extractedFields.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500">Extracted — edit then apply:</p>
                      {extractedFields.map(f => (
                        <div key={f.field} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-28 shrink-0 capitalize">
                            {f.field.replace(/_/g, ' ')}
                          </span>
                          <input
                            className="flex-1 border rounded px-2 py-1 text-xs bg-white"
                            value={draft[f.field] ?? f.value}
                            onChange={e =>
                              setApplyDraft(prev => ({
                                ...prev,
                                [s.id]: { ...prev[s.id], [f.field]: e.target.value },
                              }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => handleApply(s.id)}
                        disabled={applyOcr.isPending}
                        className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
                      >
                        {applyOcr.isPending ? 'Applying…' : 'Apply to Lead'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Activity history ───────────────────────────────────────── */}
      {lead.events && lead.events.length > 0 && (
        <section>
          <button
            onClick={() => setShowHistory(h => !h)}
            className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1"
          >
            Activity ({lead.events.length}) {showHistory ? '▲' : '▼'}
          </button>
          {showHistory && (
            <div className="space-y-2">
              {lead.events.map(ev => (
                <div key={ev.id} className="flex gap-2 text-xs text-gray-600">
                  <span className="text-gray-300 mt-0.5 shrink-0">•</span>
                  <div>
                    <span className="font-medium">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                    {ev.from_status && ev.to_status && (
                      <span className="text-gray-400"> · {ev.from_status.replace(/_/g, ' ')} → {ev.to_status.replace(/_/g, ' ')}</span>
                    )}
                    {ev.actor && <span className="text-gray-400"> · {ev.actor}</span>}
                    {ev.note && ev.event_type === 'note_added' && (
                      <p className="mt-0.5 text-blue-600 italic">"{ev.note}"</p>
                    )}
                    <p className="text-gray-300 mt-0.5">{new Date(ev.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Danger zone ────────────────────────────────────────────── */}
      <section className="pt-2 border-t">
        <button
          onClick={handleDelete}
          disabled={deleteLead.isPending}
          className="text-xs border border-red-300 text-red-600 rounded-lg px-4 py-2 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteLead.isPending ? 'Deleting…' : 'Delete Lead Permanently'}
        </button>
        {deleteLead.isError && (
          <p className="text-xs text-red-600 mt-1">
            {(deleteLead.error as Error)?.message ?? 'Delete failed'}
          </p>
        )}
      </section>

    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd app/frontend && npx tsc --noEmit
```

- [ ] **Step 3: Test in browser**

Open a lead. Log tab shows status chips, note form, screenshots list with Extract/Apply, collapsed activity history, and delete button. Changing status updates the header badge immediately.

- [ ] **Step 4: Commit**

```bash
git add app/frontend/src/screens/panels/LogPanel.tsx
git commit -m "feat: implement LogPanel with status controls, notes, screenshots, and activity"
```

---

## Task 12 — Frontend: IngestProgressFlow + LeadQueue updates

**Files:**
- Create: `app/frontend/src/components/IngestProgressFlow.tsx`
- Modify: `app/frontend/src/screens/LeadQueue.tsx`

- [ ] **Step 1: Create `IngestProgressFlow` component**

Create `app/frontend/src/components/IngestProgressFlow.tsx`:

```tsx
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ingestScreenshot, triggerAiReview } from '../services/api'

type Step = 'idle' | 'uploading' | 'reviewing' | 'done' | 'error'

const STEP_LABELS: Record<Step, string> = {
  idle:      '',
  uploading: 'Uploading screenshot…',
  reviewing: 'Running AI review…',
  done:      'Done!',
  error:     'Something went wrong.',
}

interface Props {
  onClose: () => void
}

export function IngestProgressFlow({ onClose }: Props) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setErrorMsg(null)
    try {
      setStep('uploading')
      const result = await ingestScreenshot(file, 'thumbtack_screenshot')
      const leadId = result.lead.id

      setStep('reviewing')
      try {
        await triggerAiReview(leadId)
      } catch {
        // AI review failed — navigate anyway; facilitator can re-run from the command center
      }

      setStep('done')
      navigate(`/leads/${leadId}`)
    } catch (err) {
      setErrorMsg((err as Error).message ?? 'Upload failed')
      setStep('error')
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const steps: Step[] = ['uploading', 'reviewing', 'done']
  const currentIdx = steps.indexOf(step)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-5">

        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">New Lead from Screenshot</h2>
          {(step === 'idle' || step === 'error') && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          )}
        </div>

        {step === 'idle' && (
          <>
            <p className="text-sm text-gray-500">
              Select your Thumbtack screenshot. The app will extract the lead data and run an AI review automatically.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-700"
            >
              📷 Choose Screenshot
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleChange}
            />
          </>
        )}

        {step !== 'idle' && step !== 'error' && (
          <div className="space-y-3">
            {steps.map((s, i) => {
              const done = i < currentIdx || step === 'done'
              const active = i === currentIdx && step !== 'done'
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    done   ? 'bg-green-500 text-white' :
                    active ? 'bg-indigo-600 text-white animate-pulse' :
                             'bg-gray-200 text-gray-400'
                  }`}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={`text-sm ${active ? 'text-gray-900 font-medium' : done ? 'text-green-700' : 'text-gray-400'}`}>
                    {STEP_LABELS[s]}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {step === 'error' && (
          <>
            <p className="text-sm text-red-600">{errorMsg}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('idle'); setErrorMsg(null) }}
                className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-2 text-sm hover:bg-gray-50"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `LeadQueue` to use router navigation and add the upload button**

Replace `app/frontend/src/screens/LeadQueue.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LeadCard } from '../components/LeadCard'
import { IngestProgressFlow } from '../components/IngestProgressFlow'
import { useLeads } from '../hooks/useLeads'
import { LeadCreate } from './LeadCreate'
import type { LeadSourceType, LeadStatus } from '../types/lead'

export function LeadQueue() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<LeadSourceType | ''>('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [showIngest, setShowIngest] = useState(false)
  const [showManual, setShowManual] = useState(false)

  const { data: leads = [], isLoading, error } = useLeads({
    status: statusFilter || undefined,
    source_type: sourceFilter || undefined,
    assigned_to: assignedFilter.trim() || undefined,
  })

  const unackedCount = leads.filter(l => !l.acknowledged_at).length

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-gray-900 text-lg leading-tight">Lead Queue</h1>
          {unackedCount > 0 && (
            <p className="text-xs text-red-500 font-medium">{unackedCount} unacknowledged</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManual(true)}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium px-2 py-1"
          >
            Manual
          </button>
          <button
            onClick={() => setShowIngest(true)}
            className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 active:bg-indigo-800"
          >
            📷 New from Screenshot
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="px-4 py-3 flex gap-2 flex-wrap border-b bg-white">
        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as LeadStatus | '')}
        >
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="in_review">In Review</option>
          <option value="waiting_on_customer">Waiting</option>
          <option value="ready_for_quote">Ready to Quote</option>
          <option value="ready_for_booking">Ready to Book</option>
          <option value="escalated">Escalated</option>
          <option value="booked">Booked</option>
          <option value="released">Released</option>
        </select>

        <select
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value as LeadSourceType | '')}
        >
          <option value="">All Sources</option>
          <option value="thumbtack_api">Thumbtack API</option>
          <option value="thumbtack_screenshot">Thumbtack OCR</option>
          <option value="yelp_screenshot">Yelp OCR</option>
          <option value="google_screenshot">Google OCR</option>
          <option value="website_form">Website</option>
          <option value="manual">Manual</option>
        </select>

        <input
          type="text"
          className="border rounded-lg px-3 py-1.5 text-sm bg-white w-32"
          placeholder="Handler…"
          value={assignedFilter}
          onChange={e => setAssignedFilter(e.target.value)}
        />
      </div>

      {/* Count */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-400">{leads.length} lead{leads.length !== 1 ? 's' : ''}</p>
      </div>

      {/* List */}
      <main className="px-4 pb-10 space-y-3">
        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
        )}
        {!isLoading && error && (
          <p className="text-sm text-red-500 text-center py-10">Could not load leads. Is the backend running?</p>
        )}
        {!isLoading && !error && leads.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10">No leads. Tap 📷 New from Screenshot to add one.</p>
        )}
        {leads.map(lead => (
          <LeadCard key={lead.id} lead={lead} onClick={id => navigate(`/leads/${id}`)} />
        ))}
      </main>

      {showIngest && <IngestProgressFlow onClose={() => setShowIngest(false)} />}
      {showManual && <LeadCreate onClose={() => setShowManual(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd app/frontend && npx tsc --noEmit
```

- [ ] **Step 4: Full end-to-end smoke test**

Start the app with `python run.py`.

1. Queue loads at `http://localhost:5173`
2. Tap "📷 New from Screenshot" — progress modal opens
3. Select a Thumbtack screenshot — progress steps animate through Uploading → Reviewing → Done
4. App navigates to `/leads/:id` with the new lead in the command center
5. Brief tab shows the screenshot thumbnail, contact info, and AI quick read
6. Quote tab shows scope fields, AI pricing F–L, and the chat input
7. Send a chat message — AI responds, history persists on refresh
8. Log tab shows status chips, note form, screenshot with Extract/Apply, and activity history
9. Click ← back arrow — returns to the lead queue
10. The new lead appears in the queue

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/IngestProgressFlow.tsx app/frontend/src/screens/LeadQueue.tsx
git commit -m "feat: add IngestProgressFlow and update LeadQueue with screenshot-first entry and router navigation"
```

---

## Post-implementation cleanup

- [ ] **Delete the retired `LeadDetail` file**

```bash
git rm app/frontend/src/screens/LeadDetail.tsx
git commit -m "chore: remove retired LeadDetail modal — replaced by LeadCommandCenter panels"
```

- [ ] **Run all backend tests to confirm nothing regressed**

```bash
cd app/backend && python -m pytest -v
```

Expected: all tests pass including the new chat tests.

---

## Self-review notes

- **Spec coverage:** All spec sections mapped: navigation ✓, fast lane ingest ✓, Brief/Quote/Log tabs ✓, screenshot thumbnail ✓, gate indicator ✓, scope + pricing in one scroll ✓, quote_context ✓, persistent chat ✓, lead_chat_messages table ✓, POST/GET chat endpoints ✓
- **Type consistency:** `ChatMessage` defined in Task 1, used in api.ts (Task 6) and hooks (Task 6). `AiReview` type passed through unchanged. `GateIndicator` takes `LeadStatus` defined in existing types.
- **No placeholders:** All steps contain actual code.
- **TDD:** Backend tasks 3 & 4 have tests before wiring. Frontend uses browser verification (no test runner configured in the project).
