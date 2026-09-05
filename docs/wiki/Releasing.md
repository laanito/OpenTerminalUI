# Releasing

How this fork prepares, validates, and cuts a tagged release. See the milestone
sections in [Roadmap](Roadmap.md) for the intended scope of each minor release.

## Philosophy

`1.0.0` was a **hardening** milestone, not a feature one: a coherent, honest,
installable product where every advertised feature works or is explicitly
labelled degraded. Integrity outranks feature count — no silent mock data, no
broken links, no wrong-currency numbers. Feature growth resumes in `1.1+`.

## Versioning

- **SemVer** from `1.0.0`: `MAJOR` = breaking change to the deployment/config
  contract or DB schema requiring manual migration; `MINOR` = new
  features/surfaces; `PATCH` = fixes.
- **Single source of truth.** Two values, kept in lockstep at the release
  version: backend `app_version` (`backend/config/settings.py`, overridable via
  `OPENTERMINALUI_APP_VERSION`) and `frontend/package.json`. The frontend derives
  its version *only* from `package.json` (Vite injects it as `__APP_VERSION__`) —
  don't reintroduce a hardcoded copy. Surfaced in the `/health` payload and the
  UI footer (`StatusBar`). On a bump, change both and grep for stragglers
  (README badge, `docs/site/index.html`).

## Pre-release checklist

Confirm the target milestone in [Roadmap](Roadmap.md) is complete, then:

1. **Version bump** — set `frontend/package.json` and backend `app_version` to the
   release version; grep for stragglers.
2. **CHANGELOG** — move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`; start a fresh
   `[Unreleased]`.
3. **Docs** — README quickstart verified end-to-end; the out-of-the-box-vs-keys
   matrix, Limitations, and upgrade notes (e.g. the pgvector image swap) current
   in [Limitations](Limitations) (mirrored condensed in the README).
4. **Green CI** — `ci.yml` must pass: backend compile, mock-detection and
   surface-inventory guards, `pytest` + coverage gate, frontend build, and
   Vitest. Playwright is currently manual-only while its pre-1.0 fixtures are
   rehabilitated.
5. **Smoke matrix** — manually verify the core flows on each combination:

   | DB | Keys | Must work |
   |----|------|-----------|
   | SQLite | none | app boots, search, charts (Yahoo keyless), portfolio, second brain (local embeddings), labelled degradation where keys are absent |
   | Postgres + pgvector | none | same, with pgvector ANN brain store |
   | Postgres + pgvector | FMP/Finnhub/FRED/LLM | live commodities, economic calendar + macro, LLM features |

   Confirm **no fabricated data looks live** in the no-keys runs (banners/labels
   present).

### v1.3.0 verification ledger

Release-prep automation covers the v1.3-specific contract independently of the
runtime matrix above:

| Contract | Evidence |
|---|---|
| Stable long-source chunks and incremental pruning | `backend/tests/test_brain.py` |
| Owner- and source-filtered SQLite/pgvector retrieval | `backend/tests/test_brain.py` |
| Complete fallback after provider/browser stream interruption | `backend/tests/test_brain.py`, `frontend/src/__tests__/brainStreaming.test.ts` |
| Visible source counts, filters, and progressive rendering | `frontend/src/__tests__/SecondBrainPanel.sourceFilters.test.tsx` |
| Write-scoped, owner-scoped external-note upserts | `backend/tests/test_external_note_ingest.py` |
| On-demand, owner-scoped journal gap review | `backend/tests/test_journal.py`, `frontend/src/__tests__/TradeJournalPage.gaps.test.tsx` |

The Docker Compose file resolves successfully during release prep. The three
runtime smoke rows still require confirmation on the deployment host after merge
and before tagging; a sandboxed coding agent without Docker-daemon access must
leave that step to the host operator rather than marking it passed.

### v1.4.0 verification ledger

Release-prep automation covers the v1.4 surface-truth contract independently of
the runtime matrix above:

| Contract | Evidence |
|---|---|
| Every public API family has an explicit product classification | `docs/surface-inventory.json`, `scripts/check_surface_inventory.py` |
| Duplicate mounts and operation IDs remain rejected | `backend/tests/test_api/test_router_smoke.py`, `scripts/check_surface_inventory.py` |
| Owner-scoped watchlist and compatibility-tool boundaries | `backend/tests/test_watchlist_routes.py`, `backend/tests/test_watchlist_service.py`, `backend/tests/test_oms_and_ops_routes.py`, `backend/tests/test_plugin_loader.py` |
| Primary navigation and configuration gates match the inventory | `frontend/src/__tests__/navigationSurface.test.ts` |
| Missing provider data remains explicit rather than fabricated | backend provider/degradation tests and `scripts/check_no_production_mocks.py` |
| Slow or malformed AI responses degrade within bounded deadlines | `backend/tests/test_llm_insights.py`, frontend AI timeout/card tests |

The maintainer completed the host/user verification, release PR #120 merged,
and tag/GitHub release `v1.4.0` were published from `2999a42` on 2026-09-04.
The broader LLM job, streaming, cancellation, and response-repair architecture
is intentionally deferred to the v1.6 stable-baseline work; the bounded v1.4
reliability fixes do not expand that release's scope.

## Cutting the release

```bash
# from an up-to-date main with the checklist done
git checkout main && git pull
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md)
```

Then open the next milestone's tracking and start the `[Unreleased]` section.

## After release

- Patch releases (`X.Y.1`) for fixes; cut from `main`, same checklist (lighter).
- Keep `CHANGELOG.md` updated per PR so the next cut is cheap.

## Documentation site

The `Deploy GitHub Pages` workflow publishes `docs/site` after relevant changes
land on `main`, and it can also be run manually. Before its first successful run,
an administrator must select **GitHub Actions** as the Pages source in
**Settings → Pages → Build and deployment**.

That one-time repository setting is deliberately not automated by the workflow.
The normal `GITHUB_TOKEN` has permission to deploy to an existing Pages site but
does not have the repository-administration permission required to create or
enable one. Do not add `enablement: true` to `actions/configure-pages` unless the
workflow is also supplied a separate token with the documented administration
scope.
