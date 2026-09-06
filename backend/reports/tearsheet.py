from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from typing import Any

from backend.shared.market_defaults import DEFAULT_BENCHMARK_SYMBOL, DEFAULT_EQUITY_MARKET


def infer_benchmark(market: str | None) -> str:
    normalized = str(market or "").strip().upper()
    if normalized in {"NASDAQ", "NYSE", "AMEX", "US"}:
        return "SPY"
    if normalized in {"NSE", "BSE", "IN", "INDIA"}:
        return "NIFTY"
    return DEFAULT_BENCHMARK_SYMBOL


def infer_market_from_report(report: dict[str, Any]) -> str:
    market = report.get("market")
    if market:
        return str(market)
    symbols = json.dumps(report.get("series", {}))[:1000].upper()
    if "SPY" in symbols or "NASDAQ" in symbols or "NYSE" in symbols:
        return "US"
    if "NIFTY" in symbols or "NSE" in symbols or "BSE" in symbols:
        return "NSE"
    return DEFAULT_EQUITY_MARKET


def _json_script(data: Any) -> str:
    return html.escape(json.dumps(data, ensure_ascii=True), quote=False)


def _metric(metrics: dict[str, Any], key: str) -> str:
    value = metrics.get(key, 0.0)
    if isinstance(value, (int, float)):
        return f"{float(value):.4f}"
    return html.escape(str(value))


def generate_strategy_tearsheet_html(
    *,
    run_id: str,
    lab: str,
    report: dict[str, Any],
    market: str | None = None,
) -> str:
    metrics = report.get("metrics") or {}
    series = report.get("series") or {}
    tables = report.get("tables") or {}
    benchmark = infer_benchmark(market or infer_market_from_report(report))
    equity = series.get("equity_curve") or series.get("portfolio_equity") or []
    drawdown = series.get("drawdown") or series.get("underwater") or []
    rolling = series.get("rolling_sharpe_90") or series.get("rolling_sharpe_30") or []
    monthly = series.get("monthly_returns") or []
    benchmark_curve = series.get("benchmark_curve") or series.get("benchmark_equity") or []
    trades = series.get("trades") or []
    generated = datetime.now(timezone.utc).isoformat()

    data = {
        "equity": equity,
        "drawdown": drawdown,
        "rolling": rolling,
        "monthly": monthly,
        "benchmark": benchmark_curve,
        "trades": trades,
        "tables": tables,
    }
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Strategy Tear Sheet {html.escape(run_id)}</title>
  <style>
    body {{ margin: 0; font-family: Arial, sans-serif; color: #17202a; background: #f6f7f9; }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 28px; }}
    header {{ display: flex; justify-content: space-between; gap: 24px; align-items: end; }}
    h1 {{ margin: 0 0 6px; font-size: 28px; }}
    h2 {{ margin: 28px 0 12px; font-size: 18px; }}
    .muted {{ color: #637083; font-size: 13px; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }}
    .card {{ background: #fff; border: 1px solid #dde3ea; border-radius: 8px; padding: 14px; }}
    .metric {{ font-size: 22px; font-weight: 700; margin-top: 6px; }}
    pre {{ white-space: pre-wrap; overflow-wrap: anywhere; background: #fff; border: 1px solid #dde3ea; border-radius: 8px; padding: 12px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dde3ea; }}
    th, td {{ text-align: left; border-bottom: 1px solid #e7ebf0; padding: 8px; font-size: 13px; }}
    canvas {{ width: 100%; height: 260px; background: #fff; border: 1px solid #dde3ea; border-radius: 8px; }}
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Strategy Tear Sheet</h1>
      <div class="muted">{html.escape(lab)} run {html.escape(run_id)} · Benchmark {html.escape(benchmark)}</div>
    </div>
    <div class="muted">Generated {html.escape(generated)}</div>
  </header>
  <section class="grid">
    <div class="card"><div class="muted">Sharpe</div><div class="metric">{_metric(metrics, "sharpe")}</div></div>
    <div class="card"><div class="muted">CAGR</div><div class="metric">{_metric(metrics, "cagr")}</div></div>
    <div class="card"><div class="muted">Max Drawdown</div><div class="metric">{_metric(metrics, "max_drawdown")}</div></div>
    <div class="card"><div class="muted">Turnover</div><div class="metric">{_metric(metrics, "turnover")}</div></div>
  </section>
  <h2>Equity Curve and Benchmark Overlay</h2><canvas id="equity"></canvas>
  <h2>Drawdown</h2><canvas id="drawdown"></canvas>
  <h2>Rolling Sharpe</h2><canvas id="rolling"></canvas>
  <h2>Monthly Returns Heatmap</h2><pre>{html.escape(json.dumps(monthly[:120], indent=2, ensure_ascii=True))}</pre>
  <h2>Trade Analytics</h2><pre>{html.escape(json.dumps({"count": len(trades), "sample": trades[:25], "tables": tables}, indent=2, ensure_ascii=True))}</pre>
</main>
<script id="tearsheet-data" type="application/json">{_json_script(data)}</script>
<script>
const data = JSON.parse(document.getElementById('tearsheet-data').textContent);
function drawLine(id, rows, key, color, overlay) {{
  const c = document.getElementById(id), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; ctx.scale(dpr, dpr);
  const w = c.clientWidth, h = c.clientHeight, pad = 28;
  const vals = rows.map(r => Number(r[key] ?? r.value ?? r.equity)).filter(Number.isFinite);
  const ovals = (overlay || []).map(r => Number(r[key] ?? r.value ?? r.equity)).filter(Number.isFinite);
  const all = vals.concat(ovals); if (!all.length) return;
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  function path(values, stroke) {{
    ctx.beginPath(); values.forEach((v, i) => {{
      const x = pad + (w - pad * 2) * (i / Math.max(values.length - 1, 1));
      const y = h - pad - (h - pad * 2) * ((v - min) / span);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }}); ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke();
  }}
  path(vals, color); if (ovals.length) path(ovals, '#7b8794');
}}
drawLine('equity', data.equity, 'value', '#1f7a8c', data.benchmark);
drawLine('drawdown', data.drawdown, 'value', '#b42318');
drawLine('rolling', data.rolling, 'value', '#6f42c1');
</script>
</body>
</html>"""
