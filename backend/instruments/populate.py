"""Populate the ``instrument_master`` search universe from the source loaders.

Run as a CLI to (re)build the table:

    python -m backend.instruments.populate            # US + crypto
    python -m backend.instruments.populate --no-us     # crypto only
    python -m backend.instruments.populate --crypto-limit 100

Each source is replaced independently (US rows vs crypto rows), and only when
that source actually returned data — so a failed/empty fetch never wipes the
existing universe.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any

from sqlalchemy.orm import Session

from backend.instruments.models import InstrumentMaster
from backend.instruments.sources import fetch_crypto, fetch_us_equities
from backend.shared.db import SessionLocal, init_db

logger = logging.getLogger(__name__)

US_TYPES = {"equity", "etf"}
CRYPTO_TYPES = {"crypto"}

_ALLOWED_COLUMNS = {
    "canonical_id",
    "display_symbol",
    "name",
    "type",
    "exchange",
    "currency",
    "tick_size",
    "lot_size",
    "vendor_mappings_json",
}


def replace_rows(db: Session, rows: list[dict[str, Any]], managed_types: set[str]) -> int:
    """Replace all rows whose ``type`` is in ``managed_types`` with ``rows``."""
    if not rows:
        return 0
    db.query(InstrumentMaster).filter(InstrumentMaster.type.in_(managed_types)).delete(
        synchronize_session=False
    )
    db.bulk_save_objects(
        [InstrumentMaster(**{k: v for k, v in r.items() if k in _ALLOWED_COLUMNS}) for r in rows]
    )
    db.commit()
    return len(rows)


async def refresh_instrument_master(
    *,
    include_us: bool = True,
    include_crypto: bool = True,
    crypto_limit: int = 300,
) -> dict[str, int]:
    """Fetch enabled sources and replace their slice of ``instrument_master``."""
    us_rows = await fetch_us_equities() if include_us else []
    crypto_rows = await fetch_crypto(crypto_limit) if include_crypto else []

    def _write() -> dict[str, int]:
        db = SessionLocal()
        try:
            counts = {
                "us": replace_rows(db, us_rows, US_TYPES),
                "crypto": replace_rows(db, crypto_rows, CRYPTO_TYPES),
            }
            return counts
        finally:
            db.close()

    counts = await asyncio.to_thread(_write)
    logger.info("instrument_master refreshed: %s", counts)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Populate instrument_master")
    parser.add_argument("--no-us", action="store_true", help="skip US equities/ETFs")
    parser.add_argument("--no-crypto", action="store_true", help="skip crypto")
    parser.add_argument("--crypto-limit", type=int, default=300)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    init_db()
    counts = asyncio.run(
        refresh_instrument_master(
            include_us=not args.no_us,
            include_crypto=not args.no_crypto,
            crypto_limit=args.crypto_limit,
        )
    )
    print(f"Populated instrument_master: US={counts['us']} crypto={counts['crypto']}")


if __name__ == "__main__":
    main()
