import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APIKeyManager } from "../components/settings/APIKeyManager";

const getMock = vi.fn();
const postMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

const metadata = { id: 1, name: "Daily agent", prefix: "otui_prefix", permissions: "read_write", created_at: "2026-11-24T00:00:00Z", last_used_at: null, is_active: 1 };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); getMock.mockResolvedValue({ data: [] }); });
describe("APIKeyManager", () => {
  it("can create a write-scoped key for external note ingestion", async () => {
    getMock.mockResolvedValue({ data: [] });
    postMock.mockResolvedValue({ data: { id: 1, name: "Hermes", key: "otui_secret", prefix: "otui", permissions: "read_write", created_at: "2026-11-24T00:00:00Z", last_used_at: null, is_active: 1 } });
    render(<APIKeyManager />);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/settings/api-keys"));

    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Hermes" },
    });
    fireEvent.change(screen.getByLabelText("Key permissions"), {
      target: { value: "read_write" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate New Key" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/settings/api-keys", {
        name: "Hermes",
        permissions: "read_write",
      }),
    );
    expect(await screen.findByText("otui_secret")).toBeInTheDocument();
  });
  it("distinguishes failed reads from empty and retains previous keys", async () => {
    getMock.mockRejectedValueOnce(new Error("PRIVATE_KEY_CONTEXT"));
    render(<APIKeyManager />);
    await screen.findByRole("alert");
    expect(screen.queryByText("No API keys generated.")).not.toBeInTheDocument();
    getMock.mockResolvedValueOnce({ data: [metadata] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh keys" }));
    await screen.findByRole("article", { name: "Daily agent API key" });
    getMock.mockRejectedValueOnce(new Error("PRIVATE_KEY_CONTEXT"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh keys" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("article", { name: "Daily agent API key" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE_KEY_CONTEXT");
  });
  it("retains failed drafts and shows a confirmed one-time key despite refresh/copy failure", async () => {
    postMock.mockRejectedValueOnce(new Error("PRIVATE_KEY_CONTEXT")).mockResolvedValueOnce({ data: { ...metadata, key: "otui_once" } });
    render(<APIKeyManager />);
    await screen.findByText("No API keys generated.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Daily agent" } });
    fireEvent.change(screen.getByLabelText("Key permissions"), { target: { value: "read_write" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate New Key" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Key name")).toHaveValue("Daily agent");
    expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE_KEY_CONTEXT");
    getMock.mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Generate New Key" }));
    await screen.findByRole("dialog", { name: "New API Key Generated" });
    expect(screen.getByText("otui_once")).toBeInTheDocument();
    // jsdom has no clipboard; the manual-save route must retain the credential.
    fireEvent.click(screen.getByRole("button", { name: "Copy", exact: true }));
    await screen.findByText(/Could not copy/);
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByText("otui_once")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Daily agent API key" })).toBeInTheDocument();
    expect(JSON.stringify(localStorage)).not.toContain("otui_once");
    expect(postMock).toHaveBeenCalledTimes(2);
  });
  it("ignores an older read after key creation is confirmed", async () => {
    let finish!: (response: { data: unknown[] }) => void;
    const pending = new Promise<{ data: unknown[] }>(resolve => { finish = resolve; });
    getMock.mockResolvedValueOnce({ data: [] }).mockReturnValueOnce(pending).mockRejectedValue(new Error("offline"));
    postMock.mockResolvedValueOnce({ data: { ...metadata, key: "otui_once" } });
    render(<APIKeyManager />); await screen.findByText("No API keys generated.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh keys" }));
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Daily agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate New Key" }));
    await screen.findByRole("dialog");
    await act(async () => { finish({ data: [] }); await pending; });
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.getByRole("article", { name: "Daily agent API key" })).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
