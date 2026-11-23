import { SavedViewsControl } from "../components/savedViews/SavedViewsControl";

export function SavedViewsPage() {
  return (
    <main aria-label="Saved workspace views" className="min-w-0 space-y-3 p-3 md:p-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Saved views</h1>
        <p className="text-sm text-terminal-muted">Return to your saved workflow setups. Each view restores its page, filters, selected ticker and captured workspace state.</p>
      </header>
      <SavedViewsControl pageLabel="Workspace" library />
    </main>
  );
}
