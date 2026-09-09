import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowsAnimatedBackground, TerminalBackground } from "../components/TerminalBackground";

const disposeSceneMock = vi.fn();
const mountSceneMock = vi.fn(() => disposeSceneMock);

vi.mock("../components/TerminalBackgroundScene", () => ({
  mountTerminalBackgroundScene: (...args: unknown[]) => mountSceneMock(...args),
}));

function setPreferences({ reducedMotion = false, saveData = false } = {}) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reducedMotion })));
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: { saveData },
  });
}

describe("TerminalBackground loading policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    setPreferences();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("allows the enhancement under normal browser preferences", () => {
    expect(allowsAnimatedBackground(false, false)).toBe(true);
  });

  it("does not load WebGL for reduced-motion or data-saver users", () => {
    expect(allowsAnimatedBackground(true, false)).toBe(false);
    expect(allowsAnimatedBackground(false, true)).toBe(false);
    expect(allowsAnimatedBackground(true, true)).toBe(false);
  });

  it("mounts the scene only after initial load and the fallback idle delay", async () => {
    const view = render(<TerminalBackground />);
    fireEvent.load(window);

    await vi.advanceTimersByTimeAsync(999);
    expect(mountSceneMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mountSceneMock).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(disposeSceneMock).toHaveBeenCalledTimes(1);
  });

  it("never schedules the scene when reduced motion is requested", async () => {
    setPreferences({ reducedMotion: true });
    render(<TerminalBackground />);
    fireEvent.load(window);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mountSceneMock).not.toHaveBeenCalled();
  });
});
