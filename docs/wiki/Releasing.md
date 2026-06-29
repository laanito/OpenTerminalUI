# Releasing

How this fork cuts a tagged release. The first is **v1.0.0** (see the *Release
plan* in [Roadmap](Roadmap.md) for what gates it).

## Philosophy

`1.0.0` is a **hardening** milestone, not a feature one: a coherent, honest,
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

Work the **v1.0.0** checklist in [Roadmap](Roadmap.md) (buckets A–E) to done, then:

1. **Version bump** — set `frontend/package.json` and backend `app_version` to the
   release version; grep for stragglers.
2. **CHANGELOG** — move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`; start a fresh
   `[Unreleased]`.
3. **Docs** — README quickstart verified end-to-end; the out-of-the-box-vs-keys
   matrix and Limitations section current; upgrade notes for any schema/image
   change (e.g. the pgvector image swap).
4. **Green CI** — `ci.yml` must pass: backend `pytest` + coverage gate, frontend
   build + Vitest, Playwright smoke.
5. **Smoke matrix** — manually verify the core flows on each combination:

   | DB | Keys | Must work |
   |----|------|-----------|
   | SQLite | none | app boots, search, charts (Yahoo keyless), portfolio, second brain (local embeddings), labelled degradation where keys are absent |
   | Postgres + pgvector | none | same, with pgvector ANN brain store |
   | Postgres + pgvector | FMP/Finnhub/FRED/LLM | live commodities, economic calendar + macro, LLM features |

   Confirm **no fabricated data looks live** in the no-keys runs (banners/labels
   present).

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
