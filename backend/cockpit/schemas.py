from typing import Any, List, Optional
from pydantic import BaseModel


class PortfolioSnapshot(BaseModel):
    positions: List[dict]
    pnl: Optional[float] = None
    unavailable_reason: Optional[str] = None


class SignalSummary(BaseModel):
    top_signals: List[dict]
    unavailable_reason: Optional[str] = None


class RiskSummary(BaseModel):
    summary: dict
    unavailable_reason: Optional[str] = None


class EventsSummary(BaseModel):
    events: List[dict]
    unavailable_reason: Optional[str] = None


class NewsSummary(BaseModel):
    news: List[dict]
    unavailable_reason: Optional[str] = None


class CockpitSummary(BaseModel):
    portfolio_snapshot: PortfolioSnapshot
    signal_summary: SignalSummary
    risk_summary: RiskSummary
    events: EventsSummary
    news: NewsSummary
    degraded: Optional[dict[str, Any]] = None
