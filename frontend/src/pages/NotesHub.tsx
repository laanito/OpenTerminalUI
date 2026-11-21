import { NotesPanel } from "../components/notes/NotesPanel";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function NotesHubPage() {
  return (
    <main aria-label="Private notes" className="min-w-0 space-y-4 p-3 sm:p-4" data-testid="notes-hub-page">
      <h1 className="text-lg font-semibold text-terminal-text">Notes</h1>
      <TerminalPanel
        title="Private research"
        subtitle="Capture a thought on anything — every note feeds your private Second Brain"
      >
        <NotesPanel context="general" allowSymbolInput />
      </TerminalPanel>
    </main>
  );
}

export default NotesHubPage;
