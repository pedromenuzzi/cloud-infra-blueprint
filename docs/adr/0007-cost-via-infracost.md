# 0007. Cost estimation via the open-source Infracost CLI

- **Status:** Accepted
- **Date:** 2026-05-04
- **Tags:** product, api, packages, ecosystem

## Context

Visual infrastructure becomes a **decision tool** — not just a
visualization tool — the moment the user can see "what does this cost?"
next to every node. We want a `$12/mo` badge on the canvas the instant
someone drops an `aws_instance.t3.medium`.

Constraints carried over from the OSS roadmap:

- **Zero recurring cost.** No SaaS pricing API, no per-call fee.
- **Self-hostable.** Anyone running the docker-compose stack must be
  able to enable cost without signing up for a third-party account.
- **Optional.** A user who doesn't care about cost should never see a
  broken UI or get a forced docker dependency.

The Infracost CLI is **Apache 2.0** and ships an embedded price
database for AWS, Azure and GCP. No API key is required for public
cloud pricing — the SaaS Infracost Cloud product is _separate_ from the
CLI binary and unrelated to our integration. Other options we
considered:

| Option                     | Cost / dependency       | Rejected because                                |
| -------------------------- | ----------------------- | ----------------------------------------------- |
| AWS Pricing API directly   | Free, AWS only          | Single-cloud only; we ship Azure/GCP from MVP.  |
| Cloudability / Vantage     | SaaS, paid              | Violates the zero-recurring-cost rule.          |
| Hand-rolled price database | Free                    | Maintenance black hole; data goes stale weekly. |
| Infracost SaaS API         | Paid above free tier    | Forces every user to sign up for a third party. |
| **Infracost CLI binary**   | Apache 2.0, self-hosted | **Picked.**                                     |

## Decision

We integrate the **Infracost CLI binary** as an optional Docker Compose
service under a `cost` profile. The API exposes a single endpoint,
`POST /cost-estimate`, which:

1. Accepts an IR payload (loose Zod-validated at the boundary).
2. Emits HCL via `@blueprint/hcl`'s existing `emitIR()`.
3. Writes the files into a per-request temp directory.
4. Spawns `infracost breakdown --path <tmp> --format json` (timeout
   30 s, max 500 resources per request).
5. Parses the JSON into a stable wire shape
   (`CostEstimateResponse`) and returns it.

The frontend's `useCostEstimate(ir)` hook debounces IR changes (default
800 ms), calls the endpoint, validates the response with the same Zod
schema, and surfaces a colour-coded `CostTotalBadge` in the topbar plus
per-resource `CostBadge` overlays on the canvas.

Two execution modes are exposed via env:

- **Disabled (default).** `BLUEPRINT_COST_ENABLED` unset ⇒ the endpoint
  returns a structurally valid zero-cost response with a warning. The
  frontend hides the cost UI without any error state.
- **Enabled.** `BLUEPRINT_COST_ENABLED=1` and an `infracost` binary
  reachable (either on `PATH` or via `BLUEPRINT_COST_BINARY`).

## Alternatives

- **Run infracost as a sidecar that the API talks to over HTTP.**
  Rejected — Infracost has no first-party HTTP wrapper, so we'd be
  re-inventing a process boundary the OS already gives us via
  `child_process`.
- **Run infracost in the browser via WASM.** Rejected — Infracost is
  ~80 MB of Go binary; bundling it client-side is a non-starter and
  would also leak the price database update cadence to users.
- **Cache estimates in Redis.** Out of scope for this ADR; the endpoint
  is stateless. We can add a Redis cache later keyed by IR hash with no
  contract change because `CostEstimateResponse` already includes
  `generatedAt`.

## Consequences

Positive:

- Cost is a **first-class diff signal** on the canvas without us shipping
  or maintaining a pricing database.
- The integration is **completely optional** — every install works
  without it, and turning it on is `pnpm infra:up:cost` plus one env var.
- The binary is Apache 2.0 and runs offline, so we honor the project's
  zero-recurring-cost rule.

Negative / open:

- **Process-spawn overhead.** Each estimate is a fresh `infracost`
  invocation. Median latency on a 50-resource project is ~2-3 s; we
  debounce on the frontend (800 ms) and CSV-encode hits via the
  existing IR Op stream. A future ADR may introduce a long-lived
  Infracost RPC mode if the CLI grows one.
- **Pinned Docker image.** We pin `infracost/infracost:ci-0.10` so the
  pricing changes don't drift CI. Bumping the pin is a deliberate PR.
- **No audit log of estimates yet.** Estimates are recomputed on every
  IR change; we don't persist them. F6's analytics work may want a
  rolling history per project.
