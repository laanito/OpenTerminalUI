import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TerminalButton } from "./TerminalButton";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeOnOverlayClick?: boolean;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  closeLabel?: string;
  placement?: "center" | "right";
};

export function TerminalModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className = "",
  closeOnOverlayClick = true,
  size = "md",
  busy = false,
  closeLabel = "Close",
  placement = "center",
}: Props) {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const visibleControls = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => {
      for (let node: HTMLElement | null = element; node && node !== root; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement && !node.open && !node.querySelector("summary")?.contains(element)) return false;
        if (node.inert || node.hidden || getComputedStyle(node).display === "none" || getComputedStyle(node).visibility === "hidden") return false;
      }
      return true;
    });
    const onKey = (event: KeyboardEvent) => {
      const root = dialogRef.current;
      const dialogs = document.querySelectorAll("[data-terminal-modal]");
      if (!root || dialogs[dialogs.length - 1] !== root || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = visibleControls(root);
      if (!focusable.length) { event.preventDefault(); root.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!root.contains(active) || event.shiftKey && active === first) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = window.requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (root) (visibleControls(root)[0] ?? root).focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(raf);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] grid ${placement === "right" ? "justify-items-end items-stretch" : "place-items-center"} bg-black/55 p-3`}
      onMouseDown={(event) => {
        if (!closeOnOverlayClick || busy) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        data-terminal-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`${placement === "right" ? "h-full" : ""} flex max-h-[calc(100dvh-1.5rem)] min-w-0 w-full flex-col ${
          size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl"
        } rounded-sm border border-terminal-border bg-terminal-panel shadow-2xl ${className}`.trim()}
      >
        {(title || subtitle) && (
          <header className="flex shrink-0 items-start justify-between gap-2 border-b border-terminal-border px-3 py-2">
            <div className="min-w-0">
              {title ? <div id={titleId} className="ot-type-panel-title text-terminal-accent">{title}</div> : null}
              {subtitle ? <div id={subtitleId} className="ot-type-panel-subtitle break-words text-terminal-muted">{subtitle}</div> : null}
            </div>
            <TerminalButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
              aria-label="Close modal"
            >
              {closeLabel}
            </TerminalButton>
          </header>
        )}
        <div className={`min-h-0 overflow-auto p-3 ${busy ? "cursor-wait" : ""}`.trim()}>{children}</div>
        {footer ? <footer className="shrink-0 border-t border-terminal-border px-3 py-2">{footer}</footer> : null}
      </div>
    </div>, document.body,
  );
}
