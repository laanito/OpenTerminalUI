from sqlalchemy import Column, String, JSON
from backend.shared.db import Base

class InstrumentMaster(Base):
    __tablename__ = "instrument_master"

    canonical_id = Column(String, primary_key=True)
    display_symbol = Column(String, index=True)
    name = Column(String, index=True, nullable=True)  # company / security name
    type = Column(String)  # e.g., equity, etf, crypto, futures, options
    exchange = Column(String)
    currency = Column(String)
    tick_size = Column(String, nullable=True)
    lot_size = Column(String, nullable=True)
    vendor_mappings_json = Column(JSON, nullable=True)
