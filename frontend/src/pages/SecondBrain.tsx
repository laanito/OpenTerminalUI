import { SecondBrainPanel } from "../components/brain/SecondBrainPanel";
import { BrainLogPanel } from "../components/brain/BrainLogPanel";

export function SecondBrainPage() {
  return (
    <main aria-label="Second Brain research" className="ot-brain-research min-h-full min-w-0 space-y-3 p-3 md:p-4" data-testid="second-brain-page">
      <h1 className="text-xl font-semibold text-terminal-text">Second Brain</h1>
      <nav aria-label="Brain sections" className="flex flex-wrap gap-3 text-xs text-terminal-accent">
        <a href="#brain-ask" className="underline">Ask and evidence</a>
        <a href="#brain-log" className="underline">Saved answers</a>
      </nav>
      <section id="brain-ask" aria-label="Ask private research" tabIndex={-1} className="min-w-0 scroll-mt-3">
        <SecondBrainPanel />
      </section>
      <BrainLogPanel />
    </main>
  );
}

export default SecondBrainPage;
