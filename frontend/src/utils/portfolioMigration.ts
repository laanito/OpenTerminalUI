// CSV import helpers for the per-user Portfolio Manager.
//
// Column aliases the Manager CSV importer accepts, so a portfolio CSV that
// writes `avg_buy_price` / `buy_date` (e.g. an older export) imports without
// hand-editing. The Manager's cost basis field is `cost_basis_per_share`.
export const CSV_SYMBOL_COLUMNS = ["symbol", "ticker"];
export const CSV_SHARES_COLUMNS = ["shares", "qty", "quantity"];
export const CSV_COST_COLUMNS = ["cost_basis_per_share", "avg_cost", "avg_buy_price", "buy_price", "price", "cost"];
export const CSV_DATE_COLUMNS = ["purchase_date", "date", "buy_date"];
