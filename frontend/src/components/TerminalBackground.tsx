import { useEffect, useRef } from "react";

type NavigatorWithConnection = Navigator & {
  connection?: { saveData?: boolean };
};

export function allowsAnimatedBackground(reducedMotion: boolean, saveData: boolean): boolean {
  return !reducedMotion && !saveData;
}

export function shouldLoadAnimatedBackground(): boolean {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const saveData = (navigator as NavigatorWithConnection).connection?.saveData ?? false;
  return allowsAnimatedBackground(reducedMotion, saveData);
}

/**
 * Keep the decorative WebGL scene out of the critical route-loading path.
 * The terminal's CSS background renders immediately; Three.js is requested
 * only once the initial document has loaded and the browser reports idle time.
 */
export function TerminalBackground({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !shouldLoadAnimatedBackground()) return;

    let cancelled = false;
    let disposeScene: (() => void) | undefined;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const initialise = async () => {
      try {
        const { mountTerminalBackgroundScene } = await import("./TerminalBackgroundScene");
        if (!cancelled) disposeScene = mountTerminalBackgroundScene(container);
      } catch (error) {
        if (!cancelled) console.warn("TerminalBackground disabled: scene chunk unavailable", error);
      }
    };

    const scheduleInitialisation = () => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(() => void initialise(), { timeout: 2_000 });
      } else {
        timeoutHandle = window.setTimeout(() => void initialise(), 1_000);
      }
    };

    if (document.readyState === "complete") {
      scheduleInitialisation();
    } else {
      window.addEventListener("load", scheduleInitialisation, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", scheduleInitialisation);
      if (idleHandle !== undefined) window.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      disposeScene?.();
    };
  }, []);

  return <div className={className ?? "ot-terminal-background"} ref={containerRef} />;
}
