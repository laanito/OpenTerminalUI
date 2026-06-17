"""Populate the ``instrument_master`` search universe from the source loaders.

Run as a CLI to (re)build the table:

    python -m backend.instruments.populate            # US + EU + crypto
    python -m backend.instruments.populate --no-eu     # skip EU
    python -m backend.instruments.populate --crypto-limit 100

Each source (US / EU / crypto) is replaced independently — keyed on the row
``source`` discriminator — and only when that source actually returned data, so
a failed/empty fetch never wipes the existing universe.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from typing import Any

from sqlalchemy.orm import Session

from backend.instruments.models import InstrumentMaster
from backend.instruments.sources import fetch_crypto, fetch_eu_equities, fetch_us_equities
from backend.instruments.text import search_blob as _build_blob
from backend.shared.db import SessionLocal, init_db

logger = logging.getLogger(__name__)

SOURCE_US = "us"
SOURCE_EU = "eu"
SOURCE_CRYPTO = "crypto"

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


def replace_rows(db: Session, rows: list[dict[str, Any]], source: str) -> int:
    """Replace all rows owned by ``source`` with ``rows`` (each stamped ``source``).

    US and EU equities share ``type='equity'``, so the slice is keyed on the
    ``source`` discriminator, not ``type``. An empty ``rows`` is a no-op, so a
    failed/empty fetch never wipes the existing slice.
    """
    if not rows:
        return 0
    db.query(InstrumentMaster).filter(InstrumentMaster.source == source).delete(
        synchronize_session=False
    )
    db.bulk_save_objects(
        [
            InstrumentMaster(
                source=source,
                search_blob=_build_blob(r.get("display_symbol"), r.get("name")),
                **{k: v for k, v in r.items() if k in _ALLOWED_COLUMNS},
            )
            for r in rows
        ]
    )
    db.commit()
    return len(rows)


def persist_discovered(rows: list[dict[str, Any]], source: str = "yahoo") -> None:
    """Upsert individually-discovered rows (e.g. from the live Yahoo fallback).

    Uses merge (insert-or-update by canonical_id) rather than replace, so the
    discovered cache accumulates and isn't wiped by a us/eu/crypto refresh.
    Best-effort: never raises into the request path.
    """
    if not rows:
        return
    db = SessionLocal()
    try:
        for r in rows:
            db.merge(
                InstrumentMaster(
                    source=source,
                    search_blob=_build_blob(r.get("display_symbol"), r.get("name")),
                    **{k: v for k, v in r.items() if k in _ALLOWED_COLUMNS},
                )
            )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("persist_discovered failed: %s", exc)
    finally:
        db.close()


async def refresh_instrument_master(
    *,
    include_us: bool = True,
    include_eu: bool = True,
    include_crypto: bool = True,
    crypto_limit: int = 300,
) -> dict[str, int]:
    """Fetch enabled sources and replace their slice of ``instrument_master``."""
    us_rows = await fetch_us_equities() if include_us else []
    eu_rows = await fetch_eu_equities() if include_eu else []
    crypto_rows = await fetch_crypto(crypto_limit) if include_crypto else []

    def _write() -> dict[str, int]:
        db = SessionLocal()
        try:
            return {
                "us": replace_rows(db, us_rows, SOURCE_US),
                "eu": replace_rows(db, eu_rows, SOURCE_EU),
                "crypto": replace_rows(db, crypto_rows, SOURCE_CRYPTO),
            }
        finally:
            db.close()

    counts = await asyncio.to_thread(_write)
    logger.info("instrument_master refreshed: %s", counts)
    return counts


async def seed_if_empty() -> None:
    """Populate the universe on first boot if it's empty (best-effort).

    Called as a background task from the app lifespan so a freshly built
    container comes up with a working search universe without a manual CLI run.
    Never blocks startup and never raises — a failed fetch just leaves the table
    empty for the next boot / a manual `python -m backend.instruments.populate`.
    """
    def _count() -> int:
        db = SessionLocal()
        try:
            return db.query(InstrumentMaster).count()
        finally:
            db.close()

    try:
        existing = await asyncio.to_thread(_count)
        if existing:
            logger.info("instrument_master already has %d rows; skipping auto-seed", existing)
            return
        logger.info("instrument_master is empty; auto-seeding from sources...")
        await refresh_instrument_master()
    except Exception as exc:  # noqa: BLE001
        logger.warning("instrument_master auto-seed failed: %s", exc)


def main() -> None:
    parser = argparse.ArgumentParser(description="Populate instrument_master")
    parser.add_argument("--no-us", action="store_true", help="skip US equities/ETFs")
    parser.add_argument("--no-eu", action="store_true", help="skip EU/UK equities")
    parser.add_argument("--no-crypto", action="store_true", help="skip crypto")
    parser.add_argument("--crypto-limit", type=int, default=300)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    init_db()
    counts = asyncio.run(
        refresh_instrument_master(
            include_us=not args.no_us,
            include_eu=not args.no_eu,
            include_crypto=not args.no_crypto,
            crypto_limit=args.crypto_limit,
        )
    )
    print(
        f"Populated instrument_master: US={counts['us']} EU={counts['eu']} crypto={counts['crypto']}"
    )


if __name__ == "__main__":
    main()
