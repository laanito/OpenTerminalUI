"""Owner-scoped watchlist reads and symbol-only background aggregation."""

from __future__ import annotations

from sqlalchemy.orm import Session

from backend.models import WatchlistORM


def _symbols(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(symbol).strip().upper() for symbol in raw if str(symbol).strip()]


def _user_watchlists(db: Session, user_id: str) -> list[WatchlistORM]:
    return (
        db.query(WatchlistORM)
        .filter(WatchlistORM.user_id == user_id)
        .order_by(WatchlistORM.created_at.asc(), WatchlistORM.id.asc())
        .all()
    )


def watchlist_symbols_for_user(db: Session, user_id: str) -> list[str]:
    """Return the stable, de-duplicated union of one user's watchlists."""
    seen: set[str] = set()
    symbols: list[str] = []
    for watchlist in _user_watchlists(db, user_id):
        for symbol in _symbols(watchlist.symbols_json):
            if symbol not in seen:
                seen.add(symbol)
                symbols.append(symbol)
    return symbols


def watchlist_rows_for_user(db: Session, user_id: str) -> list[dict[str, str]]:
    """Flatten one user's named watchlists for report/export consumers."""
    rows: list[dict[str, str]] = []
    for watchlist in _user_watchlists(db, user_id):
        for symbol in dict.fromkeys(_symbols(watchlist.symbols_json)):
            rows.append(
                {
                    "id": f"{watchlist.id}:{symbol}",
                    "watchlist_name": watchlist.name,
                    "ticker": symbol,
                }
            )
    return rows


def all_watchlist_symbols(db: Session, limit: int | None = None) -> list[str]:
    """Return a symbol-only union across users for installation-wide workers.

    No watchlist names, owners, or relationships leave this boundary. This is
    the watchlist equivalent of ``all_held_symbols`` used by cache and news
    background jobs.
    """
    rows = db.query(WatchlistORM.symbols_json).all()
    symbols = sorted({symbol for row in rows for symbol in _symbols(row[0] if row else None)})
    return symbols[:limit] if limit is not None else symbols
