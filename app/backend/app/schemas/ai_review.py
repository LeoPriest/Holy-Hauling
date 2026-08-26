from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class RangeLever(BaseModel):
    """One unknown that moves the price, with what each answer is worth.

    Exactly two options by design — a lever is a binary the operator resolves in
    one question on a call. Three branches do not fit a phone card and stop being
    glanceable; that is what the full A–O analysis is for.
    """
    factor: str                 # "Couch type"
    low_answer: str             # "Standard sofa"
    low_price: int              # whole dollars
    high_answer: str            # "Sectional / sleeper"
    high_price: int             # whole dollars


class AiReviewSections(BaseModel):
    """Locked A–O structure. All 15 sections required. Validation fails if any key is missing.

    Grouped for the facilitator UI:
      Action-first     : A, B, C, D, E
      Pricing & Control: F, G, H, I, J, K, L  (all internal-only)
      Support & Context: M, N, O
    """
    # Action-first
    a_next_message: str
    b_call_plan: str
    c_behavior_class: str
    d_transport_path: str
    e_escalation_note: str
    # Pricing & Control (internal only — never share with customer)
    f_pricing_band: str
    g_band_position: str
    h_friction_points: str
    i_sayability_check: str
    j_quote_style: str
    k_quote_source_label: str
    l_pricing_guidance: str
    # Support & Context
    m_quick_read: str
    n_pattern_anchor: str
    o_branch_replies: str
    # ── Structured decision fields (2026-08-25) ──────────────────────────────
    # Derived by the model from the prose above; all optional so reviews written
    # before this feature keep validating. Money is whole dollars, never float.
    sayability: Optional[Literal["ready", "confirm_first", "hold"]] = None
    target_low: Optional[int] = None
    target_high: Optional[int] = None
    floor: Optional[int] = None
    band_position: Optional[Literal["low", "mid", "high"]] = None
    band_reason: Optional[str] = None
    range_levers: Optional[list[RangeLever]] = Field(default=None)
    floor_defense: Optional[str] = None


class AiReviewOut(BaseModel):
    id: str
    lead_id: str
    model_used: str
    prompt_version: str
    grounding_source: Optional[str] = None
    # Validated A–O sections — structured, not opaque text
    sections: AiReviewSections
    # Snapshot of inputs used: lead fields, screenshot ids, OCR extracted fields
    input_snapshot: dict[str, Any]
    created_at: datetime
    actor: Optional[str] = None
