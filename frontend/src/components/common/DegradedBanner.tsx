import React from "react";
import { Info } from "lucide-react";

import type { DegradedInfo } from "../../api/types";

// Human copy for the canonical machine reasons from backend/shared/degraded.py.
const REASON_COPY: Record<string, string> = {
  no_provider_data: "live data is currently unavailable from the provider",
  provider_error: "the data provider returned an error",
  missing_api_key: "a required API key is not configured",
  rate_limited: "the data provider rate-limited the request",
  no_live_source: "no live data source is wired for this view yet",
};

/**
 * Renders the standard "this is not live data" banner from a `degraded` marker.
 * Returns null when there is nothing to flag, so callers can render it
 * unconditionally: `<DegradedBanner info={data?.degraded} />`.
 */
export function DegradedBanner({
  info,
  className = "",
}: {
  info?: DegradedInfo | null;
  className?: string;
}) {
  if (!info) return null;
  const reason = REASON_COPY[info.reason] ?? info.reason;
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-300 ${className}`}
    >
      <Info size={13} className="shrink-0" />
      <span>
        Showing <strong>non-live data</strong> — {reason}.
        {info.detail ? <> <span className="text-orange-300/80">({info.detail})</span></> : null}
      </span>
    </div>
  );
}
