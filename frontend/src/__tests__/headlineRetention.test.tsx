import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SavedHeadlineSentiment } from "../components/market/SavedHeadlineSentiment";
import { validateRetainedHeadline, type RetainedHeadline } from "../api/headlineSentiment";
import { makeCapture } from "./fixtures/comparisonCaptures";
import { makeRetainedHeadline } from "./fixtures/headlineSentiment";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), remove: vi.fn() }));
vi.mock("../api/headlineSentiment", async original => ({ ...await original<typeof import("../api/headlineSentiment")>(),
  listHeadlineAssessments: mocks.list, getRetainedHeadline: mocks.get, deleteRetainedHeadline: mocks.remove }));
function observation(pinned = false): RetainedHeadline {
  return { ...makeRetainedHeadline(), retention: pinned ? "pinned_by_saved_analysis" : "unreferenced_retention_window",
    lifecycle: { state: pinned ? "pinned" : "unreferenced", retention_days: 90,
      expires_at: pinned ? null : "2027-02-13T10:01:02Z", referencing_capture_ids: pinned ? ["saved-child"] : [], references_truncated: false } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.remove.mockResolvedValue(undefined); });
async function inspect(row: RetainedHeadline) {
  mocks.list.mockResolvedValue([row]); mocks.get.mockResolvedValue(row);
  render(<SavedHeadlineSentiment source={makeCapture(true)} onBusyChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Review retained headline assessments" }));
  fireEvent.click(await screen.findByRole("button", { name: /Inspect retained headline/ }));
  return screen.findByRole("region", { name: `Retained headline ${row.id}` });
}
it("accepts current lifecycle states without changing original evidence", () => {
  for (const pinned of [true, false]) { const row = observation(pinned); expect(validateRetainedHeadline(row)).toBe(row); }
  expect(validateRetainedHeadline(makeRetainedHeadline()).lifecycle).toBeUndefined();
  for (const changes of [{ expires_at: null }, { referencing_capture_ids: ["foreign"] }, { retention_days: 0 }]) {
    const row = observation(); Object.assign(row.lifecycle!, changes); expect(() => validateRetainedHeadline(row)).toThrow();
  }
});
it("shows pinned status and no delete control", async () => {
  const evidence = await inspect(observation(true));
  expect(evidence).toHaveTextContent("Protected by 1 saved run(s)");
  expect(screen.queryByRole("button", { name: "Delete retained headline" })).not.toBeInTheDocument();
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("requires explicit confirmation before deleting an unreferenced bundle", async () => {
  await inspect(observation());
  expect(screen.getByText(/Eligible for cleanup after/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Delete retained headline" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.list.mockResolvedValue([]);
  const confirm = screen.getByRole("group", { name: "Confirm retained headline deletion" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Confirm evidence deletion" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("snapshot-1", expect.any(AbortSignal)));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Retained headline snapshot-1" })).not.toBeInTheDocument());
});
it("keeps evidence visible when a newly pinned delete is rejected", async () => {
  await inspect(observation());
  mocks.remove.mockRejectedValue(new Error("Saved briefings use this evidence. Delete those runs first."));
  fireEvent.click(screen.getByRole("button", { name: "Delete retained headline" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm evidence deletion" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Saved briefings use this evidence");
  expect(screen.getByRole("region", { name: "Retained headline snapshot-1" })).toBeInTheDocument();
});
