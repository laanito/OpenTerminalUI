import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalModal } from "../components/terminal/TerminalModal";

const settle = () => act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
describe("TerminalModal focus lifecycle", () => {
  it("returns focus to its opener and keeps editing focus across callback/busy updates", async () => {
    const close = vi.fn();
    const { rerender } = render(<><button>Opener</button><TerminalModal open={false} onClose={close} title="Review"><input aria-label="Rationale" /></TerminalModal></>);
    const opener = screen.getByRole("button", { name: "Opener" }); opener.focus();
    rerender(<><button>Opener</button><TerminalModal open onClose={close} title="Review"><input aria-label="Rationale" /></TerminalModal></>);
    await settle(); const input = screen.getByLabelText("Rationale"); input.focus();
    const changed = vi.fn();
    rerender(<><button>Opener</button><TerminalModal open busy onClose={changed} title="Review"><input aria-label="Rationale" /></TerminalModal></>);
    await settle(); expect(input).toHaveFocus(); fireEvent.keyDown(input, { key: "Escape" }); expect(changed).not.toHaveBeenCalled();
    rerender(<><button>Opener</button><TerminalModal open={false} onClose={changed} title="Review"><input aria-label="Rationale" /></TerminalModal></>);
    expect(opener).toHaveFocus();
  });
  it("skips hidden controls when wrapping Tab and closes only the topmost modal", async () => {
    const outerClose = vi.fn(), innerClose = vi.fn();
    render(<><TerminalModal open onClose={outerClose} title="Outer"><button>Outer action</button></TerminalModal>
      <TerminalModal open onClose={innerClose} title="Inner"><button>First</button><div hidden><button>Hidden action</button></div><button>Last</button></TerminalModal></>);
    await settle(); const inner = screen.getByRole("dialog", { name: "Inner" });
    const last = within(inner).getByRole("button", { name: "Last" }); last.focus(); fireEvent.keyDown(last, { key: "Tab" });
    expect(within(inner).getByRole("button", { name: "Close modal" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" }); expect(innerClose).toHaveBeenCalledOnce(); expect(outerClose).not.toHaveBeenCalled();
  });
});
