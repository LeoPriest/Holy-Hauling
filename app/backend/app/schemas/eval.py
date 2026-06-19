from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CohortMetrics(BaseModel):
    n: int
    win_rate: Optional[float] = None
    priced_n: int
    pricing_accuracy: Optional[float] = None
    pricing_bias: Optional[float] = None


class QuoteGroundingEval(BaseModel):
    grounded: CohortMetrics
    ungrounded: CohortMetrics
