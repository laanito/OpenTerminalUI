from typing import List, Optional
from pydantic import BaseModel


class InstrumentSearchResult(BaseModel):
    canonical_id: str
    display_symbol: str
    name: Optional[str] = None
    type: str
    exchange: str
    currency: Optional[str] = None
    country_code: Optional[str] = None  # ISO-3166-1 alpha-2, derived from exchange
    vendor_ids: Optional[dict] = None
    tick_size: Optional[float] = None
    lot_size: Optional[float] = None


class InstrumentSearchResponse(BaseModel):
    results: List[InstrumentSearchResult]
