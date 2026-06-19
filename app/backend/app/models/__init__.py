"""Model package.

Importing this package registers every model with SQLAlchemy's ``Base`` so the
mapper can fully configure even when a single model module is imported on its
own (e.g. ``from app.models.lead import Lead`` in a service or test). Without
this, cross-model ``relationship()`` references like ``Lead.events`` fail to
resolve unless ``main.py`` happened to import the whole set first.
"""

from __future__ import annotations

import app.models.lead  # noqa: F401
import app.models.city  # noqa: F401
import app.models.lead_event  # noqa: F401
import app.models.screenshot  # noqa: F401
import app.models.ocr_result  # noqa: F401
import app.models.ai_review  # noqa: F401
import app.models.lead_chat_message  # noqa: F401
import app.models.app_setting  # noqa: F401
import app.models.lead_alert  # noqa: F401
import app.models.lead_followup  # noqa: F401
import app.models.lead_payment  # noqa: F401
import app.models.user  # noqa: F401
import app.models.user_availability  # noqa: F401
import app.models.user_weekly_availability  # noqa: F401
import app.models.push_subscription  # noqa: F401
import app.models.job_assignment  # noqa: F401
import app.models.finance  # noqa: F401
import app.models.truck_rental  # noqa: F401
import app.models.pay_record  # noqa: F401
import app.models.recurring_expense  # noqa: F401
import app.models.lead_escalation  # noqa: F401
import app.models.lead_outcome  # noqa: F401
import app.models.quote_suggestion_log  # noqa: F401
import app.models.lead_checklist_item  # noqa: F401
