import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("APIKeyManager", () => {
  it("can create a write-scoped key for external note ingestion", async () => {
    getMock.mockResolvedValue({ data: [] });
    postMock.mockResolvedValue({ data: { key: "otui_secret" } });
    render(<APIKeyManager />);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/settings/api-keys"));

    fireEvent.change(screen.getByPlaceholderText(/Key Name/), {
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
});
