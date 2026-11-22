import { AxiosError, AxiosHeaders } from "axios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JournalEntryForm, journalSaveError } from "../components/journal/JournalEntryForm";

function setup() {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<JournalEntryForm open mode="create" strategies={[]} setups={[]} onClose={() => {}} onSubmit={submit} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Symbol", exact: true }), { target: { value: "BTC-USD" } });
  fireEvent.change(screen.getByLabelText("Entry Date", { exact: true }), { target: { value: "2026-11-22T12:00" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /^Entry Price/ }), { target: { value: "20000" } });
  return submit;
}
const input = (name: RegExp, value: string) => fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });

describe("Journal trade size and save validation", () => {
  it("defaults to cash, derives fractional units and leaves fees separate", async () => {
    const submit = setup(); input(/^Trade amount/, "100"); input(/^Fees/, "0.125");
    expect(screen.getByRole("combobox", { name: "Trade size input" })).toHaveValue("cash");
    expect(screen.getByRole("status")).toHaveTextContent("0.005 asset units");
    expect((screen.getByRole("spinbutton", { name: /^Fees/ }) as HTMLInputElement).validity.stepMismatch).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ symbol: "BTC-USD", quantity: 0.005, fees: 0.125, entry_price: 20000, exit_price: null, exit_date: null })));
  });
  it("preserves tiny quantities when switching entry modes and accepts sub-cent fees", async () => {
    const submit = setup();
    fireEvent.change(screen.getByRole("combobox", { name: "Trade size input" }), { target: { value: "units" } });
    input(/^Quantity/, "0.00000001"); input(/^Fees/, "0.000001");
    fireEvent.change(screen.getByRole("combobox", { name: "Trade size input" }), { target: { value: "cash" } });
    expect(screen.getByRole("spinbutton", { name: /^Trade amount/ })).toHaveValue(0.0002);
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1e-8, fees: 1e-6 })));
  });
  it("explains incomplete exits before sending a request", () => {
    const submit = setup(); input(/^Trade amount/, "100"); input(/^Exit Price/, "21000");
    fireEvent.submit(screen.getByTestId("journal-entry-form"));
    expect(screen.getByRole("alert")).toHaveTextContent("Provide both exit date and exit price");
    expect(submit).not.toHaveBeenCalled();
  });
  it("shows validation fields without echoing input and keeps the cash draft", async () => {
    const submit = setup(); input(/^Trade amount/, "100");
    const error = new AxiosError("Unprocessable", "ERR_BAD_REQUEST", undefined, undefined, { status: 422, statusText: "Unprocessable", headers: {}, config: { headers: new AxiosHeaders() }, data: { detail: [{ loc: ["body", "quantity"], msg: "Input should be greater than 0", input: "PRIVATE" }] } });
    submit.mockRejectedValue(error);
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Quantity: Input should be greater than 0"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE");
    expect(screen.getByRole("spinbutton", { name: /^Trade amount/ })).toHaveValue(100);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(journalSaveError(new Error("database connection internals"))).toBe("Could not save this entry.");
  });
});
