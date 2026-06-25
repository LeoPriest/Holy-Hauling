from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CohortMetrics(BaseModel):
    n: int
    won: int = 0
    lost: int = 0
    win_rate: Optional[float] = None
    priced_n: int
    pricing_accuracy: Optional[float] = None
    pricing_bias: Optional[float] = None


class QuoteGroundingEval(BaseModel):
    grounded: CohortMetrics
    ungrounded: CohortMetrics
