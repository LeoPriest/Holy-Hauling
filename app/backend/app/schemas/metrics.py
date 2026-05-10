from __future__ import annotations

from pydantic import BaseModel


class PipelineStage(BaseModel):
    status: str
    label: str
    count: int


class SourceCount(BaseModel):
    source_type: str
    label: str
    count: int


class AdminMetrics(BaseModel):
    period_days: int
    # Pipeline
    pipeline: list[PipelineStage]
    total_active: int
    total_released: int
    # Revenue
    revenue_booked_mtd: float
    revenue_pipeline: float
    # Conversion
    leads_created_30d: int
    leads_booked_30d: int
    conversion_rate_30d: float
    # Sources
    sources_30d: list[SourceCount]
    # Response time
    avg_reply_hours: float | None
