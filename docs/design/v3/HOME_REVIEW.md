# Home hierarchy and readability review

This slice applies the maintainer's v3 standard, “no wasted blank spaces and no
unreadable labels,” after accepted Equity #294 and scope documentation #295.
It reviews the real Home page with synthetic populated API responses, not the
unused legacy landing page or just an empty application shell.

## Findings and changes

- The large introduction, desk metadata and full-width AI panel preceded the
  portfolio. The header is now compact, with visible market/currency/preset and
  actions; email, clocks and descriptive context use a native disclosure.
- Nested summary grids squeezed small cards and stretched the net-value preview.
  Portfolio value and the existing 30-day history now lead the main column; desk
  metrics follow. The sparkline has a bounded preview height. Outlook, status and
  headlines form an independent supporting column, stacking after the primary
  work on narrow screens. Exposure/timeline follow the portfolio directly rather
  than waiting for an unrelated long news column to end.
- Home widget labels used 10px type and wide tracking. Names, controls, status,
  clocks and supporting AI/dashboard labels now use at least 12px; long sector
  names wrap instead of truncating. Deliberately compact legacy shell identities
  and unrelated pages remain separate reviews.
- Market chips previously required horizontal scrolling. They now wrap into
  available width. Launch Matrix's inline grid overrode its mobile rule; CSS now
  owns the responsive columns and Up/Down follows the rendered row width.
- History value axes split numbers in a 36px column. A content-sized axis keeps
  values intact, chart height is bounded and cursor selection measures the actual
  plot rather than the frame/axis. Extended valuation methodology remains
  inspectable in a default-closed disclosure; active failures stay visible.
- Quant's missing exposure panel previously left a reserved half-width column.
  The retained timeline now fills the primary column without that empty track.

## Validation and limits

- All 854 frontend tests / 141 files pass; the final chart change also passes
  focused Home component/history tests. Production build passes.
- All 73 deterministic installed-Chrome smoke journeys pass, including native
  Portfolio 200% zoom, Equity, comparison/Brain/evidence and editing regressions.
  After the final scoped sparkline adjustment, all six affected Home layout/history
  checks pass again. The additional native Home 200% zoom case passes separately
  with measured browser/CSS-width ratio 2 and visual scale 1 (74 unique journeys).
- Five new Home cases cover populated 1440/1024/390px layouts and Quant plus native 200% browser zoom, visible
  primary content, measured label sizes/bounds, full market-strip access, keyboard
  disclosure/grid movement, plot hover and no reserved Quant column. Existing
  Home history refresh/failure checks continue to pass.
- Production-mock and surface-inventory guards and whitespace checks pass.
- Screenshot evidence: [desktop overview](evidence/home-overview-1440.png),
  [mobile overview](evidence/home-overview-390.png) and
  [mobile history](evidence/home-history-390.png) and
  [native 200% zoom](evidence/home-native-zoom.png).

These are synthetic UI checks, not live provider/model validation or acceptance
of every retained page. No backend/accounting/owner scope, API, schema, dependency
or model behavior changes. Deployment stays with the host agent. Market/Security
beyond Stock Detail, comparison/Brain/Notes/Journal, News and Workstation/Screener
remain open for populated hierarchy/readability review before v3 release prep.
