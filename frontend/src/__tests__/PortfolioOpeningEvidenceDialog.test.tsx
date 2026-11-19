import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioOpeningEvidenceDialog } from "../components/portfolio/PortfolioOpeningEvidenceDialog";
import { fetchPortfolioOpeningEvidence, repairPortfolioOpeningEvidence } from "../api/client";
vi.mock("../api/client", () => ({ fetchPortfolioOpeningEvidence: vi.fn(), repairPortfolioOpeningEvidence: vi.fn(), addPortfolioTransaction: vi.fn(), fetchPortfolioOperation: vi.fn() }));
const original = { transaction_id: "t", portfolio_id: "p", symbol: "AAPL", shares: 2, observed_date: "2026-11-10", price: null, currency: null,
  opening: { basis_status: "unknown" as const, provenance: "Transfer statement" }, evidence_revision: 0, evidence_history: [], applied_repairs: [] };
const target = { portfolioId: "p", transactionId: "t" };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(fetchPortfolioOpeningEvidence).mockResolvedValue(original); });
async function review() {
  await screen.findByText(/AAPL · 2 units/);
  fireEvent.change(screen.getByLabelText("Total contribution value at entry (optional)"), { target: { value: "400" } });
  fireEvent.change(screen.getByLabelText("Contribution currency"), { target: { value: "USD" } });
  fireEvent.change(screen.getByLabelText("Repair reason"), { target: { value: "Recovered entry valuation" } });
  fireEvent.click(screen.getByRole("button", { name: "Review evidence repair" }));
}
describe("Opening evidence repair", () => {
  it("checks an uncertain success by repair identity without a duplicate write", async () => {
    const saved = vi.fn(), close = vi.fn();
    vi.mocked(repairPortfolioOpeningEvidence).mockRejectedValueOnce(new Error("Disconnected"));
    render(<PortfolioOpeningEvidenceDialog target={target} onSaved={saved} onClose={close} />);
    await review();
    fireEvent.click(screen.getByRole("button", { name: "Confirm evidence repair" }));
    await screen.findByText(/Repair not confirmed/);
    expect(screen.getByRole("button", { name: "Reload evidence" })).toBeDisabled();
    const request = vi.mocked(repairPortfolioOpeningEvidence).mock.calls[0][2];
    expect(request.price).toBeNull(); expect(request.currency).toBeNull();
    expect(request.opening).toMatchObject({ basis_status: "unknown", acquisition_date: null, contribution_value: 400 });
    vi.mocked(fetchPortfolioOpeningEvidence).mockResolvedValue({ ...original, applied_repairs: [{ repair_id: request.repair_id, revision: 1, recorded_at: "2026-11-19" }] });
    fireEvent.click(screen.getByRole("button", { name: "Check repair result" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce(); expect(repairPortfolioOpeningEvidence).toHaveBeenCalledOnce();
  });
  it("shows revision conflict and reloads current evidence before a new review", async () => {
    vi.mocked(repairPortfolioOpeningEvidence).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409, data: { detail: "Opening evidence changed; reload before reviewing a new repair" } } });
    render(<PortfolioOpeningEvidenceDialog target={target} onSaved={vi.fn()} onClose={vi.fn()} />);
    await review(); fireEvent.click(screen.getByRole("button", { name: "Confirm evidence repair" }));
    await screen.findByText(/Opening evidence changed/);
    vi.mocked(fetchPortfolioOpeningEvidence).mockResolvedValue({ ...original, evidence_revision: 1, opening: { ...original.opening, contribution_value: 600, contribution_currency: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Reload evidence" }));
    await screen.findByText(/revision 1/);
    expect(screen.getByLabelText("Total contribution value at entry (optional)")).toHaveValue(600);
    expect(screen.getByLabelText("Repair reason")).toHaveValue("");
    expect(repairPortfolioOpeningEvidence).toHaveBeenCalledOnce();
  });
  it("keeps failed evidence reads unavailable and can retry without a write", async () => {
    vi.mocked(fetchPortfolioOpeningEvidence).mockRejectedValueOnce(new Error("Unavailable"));
    render(<PortfolioOpeningEvidenceDialog target={target} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/Opening evidence could not be read/);
    expect(screen.queryByRole("button", { name: "Review evidence repair" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload evidence" }));
    await screen.findByText(/AAPL · 2 units/);
    expect(repairPortfolioOpeningEvidence).not.toHaveBeenCalled();
  });
});
