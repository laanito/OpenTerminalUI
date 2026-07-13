from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd
from sqlalchemy import inspect, text

from backend.shared.db import engine


TABLE_NAME = "screener_snapshot"

SCHEMA_COLUMNS: dict[str, str] = {
    "ticker": "TEXT PRIMARY KEY",
    "company_name": "TEXT",
    "sector": "TEXT",
    "industry": "TEXT",
    "current_price": "REAL",
    "market_cap": "REAL",
    "pe": "REAL",
    "pb_calc": "REAL",
    "ps_calc": "REAL",
    "ev_ebitda": "REAL",
    "roe_pct": "REAL",
    "roa_pct": "REAL",
    "op_margin_pct": "REAL",
    "net_margin_pct": "REAL",
    "rev_growth_pct": "REAL",
    "eps_growth_pct": "REAL",
    "beta": "REAL",
    "market": "TEXT",
    "exchange": "TEXT",
    "country_code": "TEXT",
    "piotroski_f_score": "REAL",
    "altman_z_score": "REAL",
    "updated_at": "TEXT NOT NULL",
}


def ensure_screener_table() -> None:
    columns_sql = ",\n        ".join(f"{name} {dtype}" for name, dtype in SCHEMA_COLUMNS.items())
    sql = f"CREATE TABLE IF NOT EXISTS {TABLE_NAME} ({columns_sql})"
    with engine.begin() as conn:
        conn.execute(text(sql))
        # Introspect existing columns dialect-agnostically. This was a raw
        # `PRAGMA table_info(...)`, which is SQLite-only — on PostgreSQL it's a
        # syntax error, so the screener 500'd on any Postgres deploy. The
        # SQLAlchemy inspector reads the right catalog for whichever dialect is
        # in use and sees the just-created table within this transaction.
        existing_cols = {col["name"] for col in inspect(conn).get_columns(TABLE_NAME)}
        for col, dtype in SCHEMA_COLUMNS.items():
            if col not in existing_cols:
                conn.execute(text(f"ALTER TABLE {TABLE_NAME} ADD COLUMN {col} {dtype}"))


def upsert_screener_rows(rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    ensure_screener_table()
    now_iso = datetime.now(timezone.utc).isoformat()
    with engine.begin() as conn:
        for row in rows:
            payload = dict(row)
            for column in SCHEMA_COLUMNS:
                payload.setdefault(column, None)
            payload["updated_at"] = now_iso
            conn.execute(
                text(
                    f"""
                    INSERT INTO {TABLE_NAME}
                    (ticker, company_name, sector, industry, current_price, market_cap, pe, pb_calc, ps_calc, ev_ebitda, roe_pct, roa_pct, op_margin_pct, net_margin_pct, rev_growth_pct, eps_growth_pct, beta, market, exchange, country_code, piotroski_f_score, altman_z_score, updated_at)
                    VALUES
                    (:ticker, :company_name, :sector, :industry, :current_price, :market_cap, :pe, :pb_calc, :ps_calc, :ev_ebitda, :roe_pct, :roa_pct, :op_margin_pct, :net_margin_pct, :rev_growth_pct, :eps_growth_pct, :beta, :market, :exchange, :country_code, :piotroski_f_score, :altman_z_score, :updated_at)
                    ON CONFLICT(ticker) DO UPDATE SET
                        company_name=excluded.company_name,
                        sector=excluded.sector,
                        industry=excluded.industry,
                        current_price=excluded.current_price,
                        market_cap=excluded.market_cap,
                        pe=excluded.pe,
                        pb_calc=excluded.pb_calc,
                        ps_calc=excluded.ps_calc,
                        ev_ebitda=excluded.ev_ebitda,
                        roe_pct=excluded.roe_pct,
                        roa_pct=excluded.roa_pct,
                        op_margin_pct=excluded.op_margin_pct,
                        net_margin_pct=excluded.net_margin_pct,
                        rev_growth_pct=excluded.rev_growth_pct,
                        eps_growth_pct=excluded.eps_growth_pct,
                        beta=excluded.beta,
                        market=excluded.market,
                        exchange=excluded.exchange,
                        country_code=excluded.country_code,
                        piotroski_f_score=excluded.piotroski_f_score,
                        altman_z_score=excluded.altman_z_score,
                        updated_at=excluded.updated_at
                    """
                ),
                payload,
            )


def load_screener_df(tickers: list[str]) -> pd.DataFrame:
    if not tickers:
        return pd.DataFrame()
    ensure_screener_table()
    placeholders = ",".join([f":t{i}" for i in range(len(tickers))])
    params = {f"t{i}": ticker for i, ticker in enumerate(tickers)}
    query = text(f"SELECT * FROM {TABLE_NAME} WHERE ticker IN ({placeholders})")
    return pd.read_sql_query(query, engine, params=params)
