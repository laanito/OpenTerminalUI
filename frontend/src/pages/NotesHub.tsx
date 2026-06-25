import { NotesPanel } from "../components/notes/NotesPanel";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function NotesHubPage() {
  return (
    <div className="space-y-4 p-4" data-testid="notes-hub-page">
      <TerminalPanel
        title="Notes"
        subtitle="Capture a thought on anything — every note feeds your private Second Brain"
      >
        <NotesPanel context="general" allowSymbolInput />
      </TerminalPanel>
    </div>
  );
}

export default NotesHubPage;
