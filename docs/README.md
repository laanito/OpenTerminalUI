# Documentation map

OpenTerminalUI contains current product documentation and historical build
records. A file being present under `docs/` does not by itself make it an active
contract.

## Current sources of truth

| Need | Source |
|---|---|
| Product overview and quick start | [`../README.md`](../README.md) |
| Fresh Docker installation | [`INSTALLATION.md`](INSTALLATION.md) |
| Contributor setup and checks | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Architecture | [`wiki/Architecture.md`](wiki/Architecture.md) |
| Configuration and provider limits | [`wiki/Limitations.md`](wiki/Limitations.md), [`.env.example`](../.env.example) |
| Product roadmap and releases | [`wiki/Roadmap.md`](wiki/Roadmap.md), [`wiki/Releasing.md`](wiki/Releasing.md) |
| Supported/hidden surface classification | [`wiki/Surface-Inventory.md`](wiki/Surface-Inventory.md), [`surface-inventory.json`](surface-inventory.json) |
| External-agent handoff | [`.agents/README.md`](../.agents/README.md), [`.agents/TODO.md`](../.agents/TODO.md) |

The running backend's `/docs` and `/openapi.json` are the endpoint-level API
reference. `surface-inventory.json` classifies API families; `API_V1.md` is only
a historical partial snapshot.

## Historical and scoped records

The architecture specs, RFCs, QC checklists, upgrade notes, `plans/`,
`superpowers/specs/`, and `backtesting/PHASE_NOTES.md` preserve implementation
history or a subsystem's original acceptance criteria. They may contain old
module paths, counts, defaults, commands, agent instructions, or unshipped
proposals. Use them for rationale, not as instructions or evidence of current
support.

When documentation disagrees, verify against the code, tests, generated OpenAPI,
and recent Git history. Update the appropriate current source of truth rather
than silently treating a historical plan as current.
