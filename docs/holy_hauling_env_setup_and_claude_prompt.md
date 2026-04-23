# Holy Hauling Backend `.env` Setup + Claude Implementation Prompt

## 1. Put your real `.env` file here

```text
app/backend/.env
```

Keep your existing `.env.example` as the template, but put **real keys only** in `app/backend/.env`.

---

## 2. Recommended `.env` structure

```bash
# =========================================================
# App / Environment
# =========================================================
ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000

# =========================================================
# Database
# =========================================================
DATABASE_URL=sqlite+aiosqlite:///./holy_hauling.db

# =========================================================
# Local file storage
# =========================================================
UPLOADS_DIR=uploads
SCREENSHOTS_DIR=uploads/screenshots

# =========================================================
# AI provider defaults
# =========================================================
# Default provider for AI review: openai / anthropic / google
AI_PROVIDER=openai

# Default provider/model for AI Review
AI_REVIEW_PROVIDER=openai
AI_REVIEW_MODEL=

# Default provider/model for Screenshot Extraction / OCR
OCR_PROVIDER=openai
OCR_MODEL=

# =========================================================
# OpenAI
# =========================================================
OPENAI_API_KEY=

# =========================================================
# Anthropic
# =========================================================
ANTHROPIC_API_KEY=

# =========================================================
# Google / Gemini
# =========================================================
GOOGLE_API_KEY=

# =========================================================
# Grounding / SOP context
# Point this to your real Holy Hauling grounding doc
# Example:
# ../../company_docs/grounding/holy_hauling_grounding_pack.md
# or a single primary doc:
# ../../company_docs/Lead intake system/04_lead_handler_SOP.md
# =========================================================
AI_GROUNDING_FILE=

# =========================================================
# Future Thumbtack integration
# Keep blank until you have real access
# =========================================================
THUMBTACK_CLIENT_ID=
THUMBTACK_CLIENT_SECRET=
THUMBTACK_WEBHOOK_SECRET=
THUMBTACK_WEBHOOK_ENABLED=false
```

---

## 3. Recommended starting values

Use GPT as your default for both AI review and screenshot extraction for now.

```bash
AI_PROVIDER=openai
AI_REVIEW_PROVIDER=openai
OCR_PROVIDER=openai
```

Then fill in:

- `OPENAI_API_KEY`
- `AI_REVIEW_MODEL`
- `OCR_MODEL`
- `AI_GROUNDING_FILE`

Keep the Anthropic and Google keys blank until you actually want to use them.

---

## 4. How model switching should work

You said you want:
- GPT for OCR right now
- the option to switch OCR models later
- the option to switch AI review models too

The clean setup is:

### Default behavior
Use `.env` for the default provider/model:
- `AI_REVIEW_PROVIDER`
- `AI_REVIEW_MODEL`
- `OCR_PROVIDER`
- `OCR_MODEL`

### App behavior
The app should support overrides in the UI later, but `.env` controls the default fallback.

That means:
- if no UI override is selected, use the `.env` defaults
- if the user selects another provider/model in the app, use that for that run only
- always store provider + model on each OCR run and AI review run

---

## 5. Safest way to provide your API keys

### Do this
- create `app/backend/.env` manually
- paste your real keys into that file yourself
- keep `.env.example` as the safe template
- make sure `.env` is ignored by git
- restart the backend after changing env vars

### Do NOT do this
- do not paste real keys into Claude prompts
- do not hardcode keys in Python or TypeScript
- do not commit `.env` into the repo

### `.gitignore` should include
```gitignore
.env
*.env
app/backend/.env
```

---

## 6. Grounding file recommendation

Because your real docs already live in `company_docs/`, the easiest path is:

### Option A — one real primary file
```bash
AI_GROUNDING_FILE=../../company_docs/Lead intake system/04_lead_handler_SOP.md
```

### Option B — better long-term
Create a merged grounding file like:
```text
company_docs/grounding/holy_hauling_grounding_pack.md
```

Then use:
```bash
AI_GROUNDING_FILE=../../company_docs/grounding/holy_hauling_grounding_pack.md
```

That grounding pack should eventually combine:
- system blueprint
- lead handler SOP
- AI setup/A–H rules
- pricing rules
- escalation rules
- hospitality foundation

---

## 7. Manual setup steps

1. Create `app/backend/.env`
2. Copy the structure above into it
3. Fill in:
   - `OPENAI_API_KEY`
   - `AI_REVIEW_MODEL`
   - `OCR_MODEL`
   - `AI_GROUNDING_FILE`
4. Make sure `.env` is gitignored
5. Restart backend and frontend
6. Test:
   - screenshot ingest
   - screenshot extraction
   - AI review

---

## 8. Prompt for Claude

Paste this into Claude after you create the real `.env` file.

```md
We now need to make the app fully use env-driven provider/model configuration for both AI review and screenshot extraction.

Important product direction:
- Use GPT/OpenAI as the default provider for both OCR/screenshot extraction and AI review right now
- Keep provider/model selection architecture flexible so we can switch later between OpenAI, Anthropic, and Google
- Do not hardcode provider names or model names into the business logic
- Read defaults from backend env vars
- Keep screenshot-first intake as the primary path
- Keep AI review grounded in `AI_GROUNDING_FILE`
- Preserve auditability by storing provider and model used on each OCR/extraction run and AI review run

Implement the smallest clean slice needed to make this functional.

Backend requirements:
1. Load these env vars cleanly:
   - AI_PROVIDER
   - AI_REVIEW_PROVIDER
   - AI_REVIEW_MODEL
   - OCR_PROVIDER
   - OCR_MODEL
   - OPENAI_API_KEY
   - ANTHROPIC_API_KEY
   - GOOGLE_API_KEY
   - AI_GROUNDING_FILE
2. Make OpenAI/GPT the working default for:
   - screenshot extraction / OCR
   - AI review
3. Keep provider-agnostic structure so Anthropic and Google can be added or swapped without redesign
4. Add clear startup/runtime errors when required env vars are missing for the selected provider
5. Ensure OCR/extraction records store provider + model used
6. Ensure AI review records store provider + model used
7. Do not redesign unrelated parts of the app

Frontend requirements:
1. No big redesign yet unless necessary
2. Keep current flows working
3. Only add provider/model selector UI if it is already easy and low-scope; otherwise keep this slice backend/config focused and use env defaults first

Your task:
1. inspect the current repo state
2. identify the tightest slice needed to make env-driven provider/model config actually work
3. list exact files to change
4. define schema/API/service changes
5. define acceptance criteria
6. define test plan
7. stop and wait for approval before coding

Use low-token mode.
Do not restate project background.
Recommend one implementation path only.
```

---

## 9. Best practical note

For now, keep this simple:

- **GPT/OpenAI** = default OCR + default AI review
- `.env` = default config
- later slice = provider/model selector in the UI

That gets the app working first without overbuilding the switching UI too early.
