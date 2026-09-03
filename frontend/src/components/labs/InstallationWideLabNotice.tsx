export function InstallationWideLabNotice({ name }: { name: string }) {
  return (
    <div className="rounded border border-terminal-warn/60 bg-terminal-warn/10 px-3 py-2 text-xs text-terminal-warn" role="status">
      <strong>{name} compatibility surface.</strong>{" "}
      Definitions and runs are shared across this installation, not scoped to your account. Use only on a trusted
      single-user host; this surface is hidden from general navigation until ownership isolation is implemented.
    </div>
  );
}
