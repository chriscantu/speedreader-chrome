---
description: Semantic-search docs/superpowers/{specs,plans,decisions} via ruflo memory before drafting new work
---

# /spec-recall — Recall prior specs/plans/decisions

Before drafting a new spec, plan, or decision in `docs/superpowers/`, query the indexed corpus of prior work so you build on existing patterns instead of duplicating or contradicting them. Wires the project into ruflo's `ruflo-rag-memory` plugin (HNSW vector search).

## Steps

1. **Ensure index is current.** Run:
   ```
   bash scripts/ruflo-memory-index.sh
   ```
   Idempotent (`--upsert`); fast (<10s for ~12 markdown files). Skip if the corpus hasn't changed since last run.

2. **Search.** Ask the user for the topic (or extract from their prompt). Then run:
   ```
   npx -y ruflo@latest memory search \
     -n "${RUFLO_NS:-speedreader-specs}" \
     -q "<topic>" \
     -l 5 \
     -t hybrid \
     --smart
   ```
   - `-t hybrid` — combines semantic + keyword for terminology-heavy specs (e.g., "RSVP overlay", "settings v4 migration").
   - `--smart` — query expansion + RRF + MMR diversity + recency weighting. Costs a bit more compute, much better top-5.

3. **Surface results inline.** For each match, show: title, namespace key (e.g., `specs/2026-05-08-messaging-contract`), similarity score, and a 2-line excerpt. Do NOT dump full content — the user opens what's relevant.

4. **Cite during drafting.** When proceeding to draft the new artifact, name the precedent: *"This builds on `specs/2026-05-08-settings-schema` (similarity 0.84) — keeping its `settings.v4` namespace contract."* Cited precedent makes review faster and exposes scope drift early.

5. **If zero matches above similarity 0.5,** report it: *"No prior corpus match above 0.5 — this is greenfield."* That itself is signal worth surfacing.

## When NOT to use

- Bug fixes — search the code, not the spec corpus.
- Throwaway exploration the user has scoped as exploration.
- The user has already cited the precedent and asked to skip recall.
- `docs/superpowers/` is empty or never indexed yet (run `ruflo-memory-index.sh` first).

## Notes

- Index namespace defaults to `speedreader-specs`. Override via `RUFLO_NS=foo` env var.
- The index lives in ruflo's memory DB (`.swarm/memory.db` or `CLAUDE_FLOW_DB_PATH`); not in this repo.
- For a fresh ramp-up on the whole corpus, run `npx ruflo memory list -n speedreader-specs` to see every indexed key.
