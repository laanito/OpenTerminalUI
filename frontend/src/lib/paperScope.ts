const KEY = "ot:paper:selected-portfolio:v1";
export function readPaperScope(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function writePaperScope(value: string) {
  try { localStorage.setItem(KEY, value); } catch { /* Browser persistence is optional. */ }
}
