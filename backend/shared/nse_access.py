"""Process-wide policy and circuit breaker for direct public NSE access."""

from __future__ import annotations

import logging
import threading

from backend.config.settings import get_settings

logger = logging.getLogger(__name__)


class NSEPublicAccessDisabled(RuntimeError):
    """Raised when a caller attempts an intentionally disabled NSE request."""


_lock = threading.Lock()
_blocked_reason: str | None = None


def nse_public_enabled() -> bool:
    """Return whether direct, unauthenticated NSE website access is available."""
    return bool(get_settings().nse_public_enabled) and _blocked_reason is None


def require_nse_public() -> None:
    if nse_public_enabled():
        return
    reason = _blocked_reason or "OPENTERMINALUI_NSE_PUBLIC_ENABLED is not enabled"
    raise NSEPublicAccessDisabled(f"Direct NSE public access disabled: {reason}")


def disable_nse_public(reason: str) -> None:
    """Open the process-level circuit once; subsequent calls fail without I/O."""
    global _blocked_reason
    with _lock:
        if _blocked_reason is not None:
            return
        _blocked_reason = reason
        logger.warning("Direct NSE public access disabled for this process: %s", reason)


def reset_nse_public_circuit() -> None:
    """Reset process state for tests; production recovery happens on restart."""
    global _blocked_reason
    with _lock:
        _blocked_reason = None
