# Model-Tier Routing

How builder dispatches in this repo pick a Claude model. **Manual tier tags drive
routing; the neural router only *suggests*.** Consumed by the
`/swarm-batch-dispatcher` procedure, not by the daemon.

## Why manual tags

Calibration on 2026-06-11 (12-task labeled eval) found Ruflo's neural router
(`hooks_model-route`) at **33% tier accuracy** — opus-skewed prior (75% of 2072
historical decisions), structurally unable to pick haiku, and unable to separate
difficulty in the 0.25–0.34 complexity band where most backlog work lands.
Auto-routing would pay near-opus cost *and* occasionally under-route hard tasks.
So tagging is human; the router is advisory only.

## Tier labels → model

| Label | Model | Cost | Use for |
|---|---|---|---|
| `tier:trivial` | haiku | 1× | lint, renames, version bumps, typos, mechanical edits |
| `tier:mid` | sonnet | 3× | single-file features, tests, schema fields |
| `tier:hard` | opus | 5× | architecture, cross-cutting, refactors, diagnosis, ambiguous |
| *(unlabeled)* | opus | 5× | **safe default** — never silently downgrade |

## Prefill — suggestion only, gated at uncertainty < 0.3

At triage the coordinator MAY call `hooks_model-route` on the issue title+body:

- **uncertainty < 0.3** → surface the suggested tier for human confirm/override.
  This is the only band where the router agreed with hard labels in calibration.
- **uncertainty ≥ 0.3** → no suggestion. Human tags from scratch.

The router never sets a tag directly — it only proposes one a human accepts.

## Autobump on escalation — capped at +1, logged

If a builder stalls or fails on its tagged tier (`outcome: escalated`):

- Bump **exactly one** tier: `trivial → mid`, `mid → hard`.
- `hard` never bumps (already the ceiling) → hard-fail and surface.
- **Cap is +1 per task.** A task needing `trivial → hard` means the tag was wrong
  twice — stop, surface, re-triage. Do not silently climb to opus; uncapped
  autobump recreates opus-everything and hides the mis-tag.
- Record every bump via `hooks_model-outcome` (`outcome: escalated`) so
  systematic mis-tagging shows up in `hooks_model-stats`.

## Outcome recording — always

Record `hooks_model-outcome` (success / failure / escalated) on **every** dispatch,
regardless of whether the tag was human or prefill-suggested. This builds an
outcome history that isn't poisoned by the opus-skewed prior, so the router can
eventually graduate to auto-routing in the < 0.3-uncertainty band.

See the memory finding `project_ruflo_router_miscalibrated` and
`feedback_swarm_batch_dispatcher_pattern` (the dispatcher is the tag→model
chokepoint).
