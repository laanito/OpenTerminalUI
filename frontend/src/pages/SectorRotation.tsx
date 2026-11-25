import { SectorRotationMap } from "../components/analysis/SectorRotationMap";
export function SectorRotationPage() {
  return <main aria-label="Sector rotation page" className="min-w-0 space-y-3 p-3"><header><h1 className="text-lg font-semibold text-terminal-accent">Sector Rotation</h1><p className="text-sm text-terminal-muted">Dated relative strength and momentum against the selected benchmark.</p></header><SectorRotationMap width="100%" height={420} defaultBenchmark="SPY"/></main>;
}
