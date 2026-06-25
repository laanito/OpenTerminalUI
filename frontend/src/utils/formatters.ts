export function formatPct(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(2)}%`;
}
