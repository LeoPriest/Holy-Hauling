from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import FinanceTransaction, FinanceTransactionType
from app.models.lead import Lead

_CATEGORY = "Thumbtack lead fee"
_VENDOR = "Thumbtack"


async def sync_lead_cost_expense(db: AsyncSession, lead: Lead) -> None:
    """Keep a single lead-linked 'Thumbtack lead fee' expense in sync with lead_cost_cents.
    Caller commits. Mutates lead.lead_cost_finance_transaction_id."""
    cost = lead.lead_cost_cents

    async def _load_tx() -> FinanceTransaction | None:
        if not lead.lead_cost_finance_transaction_id:
            return None
        res = await db.execute(
            select(FinanceTransaction).where(
                FinanceTransaction.id == lead.lead_cost_finance_transaction_id
            )
        )
        return res.scalar_one_or_none()

    if not cost or cost <= 0:
        tx = await _load_tx()
        if tx is not None:
            await db.delete(tx)
        lead.lead_cost_finance_transaction_id = None
        return

    occurred = lead.created_at.date() if lead.created_at else date.today()

    tx = await _load_tx()
    if tx is None:
        tx = FinanceTransaction(
            city_id=lead.city_id,
            transaction_type=FinanceTransactionType.expense,
            category=_CATEGORY,
            lead_id=lead.id,
            amount_cents=cost,
            occurred_on=occurred,
            vendor_customer=_VENDOR,
        )
        db.add(tx)
        await db.flush()
        lead.lead_cost_finance_transaction_id = tx.id
    else:
        tx.amount_cents = cost
        tx.vendor_customer = _VENDOR
        tx.updated_at = datetime.now(timezone.utc)
