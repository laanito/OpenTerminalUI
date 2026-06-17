"""Text normalization for instrument search."""

from __future__ import annotations

import unicodedata


def fold_text(value: str | None) -> str:
    """Lowercase + strip diacritics so ASCII queries match accented names.

    e.g. "Nestlé" -> "nestle", "Société Générale" -> "societe generale". Used to
    build the searchable ``search_blob`` and to fold the incoming query.
    """
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower().strip()


def search_blob(display_symbol: str | None, name: str | None) -> str:
    """Folded "<symbol> <name>" blob matched against the folded query."""
    return fold_text(f"{display_symbol or ''} {name or ''}")
