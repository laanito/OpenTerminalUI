// Synthetic rendering fixtures, not a validation of investment models/providers.
export const longAlpha = "Momentum research with a long descriptive model name across several international instruments";
export const frameworkModels = {
  alpha: [{ id: "momentum", label: longAlpha, params: [{ key: "lookback_days", label: "Lookback days", type: "int", default: 63 }] }, { id: "mean_reversion", label: "Mean Reversion Alpha", params: [{ key: "z_entry", label: "Entry threshold", type: "float", default: 1 }] }],
  portfolio_construction: [{ id: "equal", label: "Equal Weighting", params: [] }, { id: "mean_variance", label: "Mean Variance Optimization", params: [{ key: "lookback_days", label: "Lookback days", type: "int", default: 126 }] }],
  risk: [{ id: "max_drawdown", label: "Maximum Drawdown Risk", params: [{ key: "max_drawdown", label: "Max Drawdown %", type: "float", default: .2 }] }],
};
export const frameworkResult = {
  summary: { strategy: { total_return: .125, cagr: .08, sharpe: 0, volatility: .15, max_drawdown: -.04 }, benchmark: null, alpha_total_return: .125 },
  equity_curve: [{ date: "2025-01-01", strategy: 1, benchmark: null }, { date: "2025-06-01", strategy: 1.0625, benchmark: null }, { date: "2025-12-01", strategy: 1.125, benchmark: null }],
  holdings: [{ rebalance_date: "2025-12-01", weights: { AAPL: .6, "VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE": .4 }, turnover: .1 }],
  insights: Array.from({ length: 205 }, (_, i) => ({ date: "2025-12-01", symbol: i === 0 ? "VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE" : `ASSET-${i}`, direction: i === 0 ? 0 : i % 2 ? -1 : 1, confidence: i === 0 ? 0 : .8, magnitude: .025 })),
};
export const optimizerMethods = {
  models: [{ id: "Classic", label: "Classic model with a long descriptive name for historical mean variance research" }, { id: "HRP", label: "Hierarchical Risk Parity" }, { id: "HERC", label: "Hierarchical Equal Risk Contribution" }, { id: "RP", label: "Risk Parity" }],
  objectives: [{ id: "max_sharpe", label: "Maximize Sharpe ratio" }], risk_measures: [{ id: "MV", label: "Mean Variance" }], covariance_methods: [{ id: "sample", label: "Sample covariance estimator" }],
};
export const optimizerResult = {
  weights: { AAPL: 1.24995, "VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE": -.25, SMALL: .00005, ZERO: 0 },
  metrics: { expected_return: .1, volatility: .15, sharpe: 0, sortino: null, max_drawdown: -.04, cvar: -.02, ulcer_index: .012, cdar: -.01 },
  risk_contributions: { AAPL: 1.1, "VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE": -.1, ZERO: 0 },
  asset_metrics: [{ symbol: "VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE", annual_return: .12, annual_vol: .15, weight: -.25 }],
  frontier: [{ risk: .1, return: .06, sharpe: .6 }, { risk: .15, return: .1, sharpe: 0 }, { risk: .2, return: .12, sharpe: .6 }], selected_point: { risk: .15, return: .1 },
  model: "Classic", objective: "max_sharpe", risk_measure: "MV", clusters: { leaf_order: ["AAPL", "VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE"], groups: [{ id: 1, symbols: ["VERY-LONG-INTERNATIONAL-INSTRUMENT-ID.DE", "AAPL"] }], linkage: [] },
};
export const governanceRows = [{ id: "run-with-a-long-identifier-to-review-without-truncation", status: "done", data_version_id: "research-snapshot-version-with-a-long-recorded-name", code_hash: "abcdef".repeat(12), experiment_id: null, started_at: "2026-11-28T10:00:00Z", finished_at: null, execution_profile: { commission_bps: 0, slippage_bps: 3 } }];
