# Discovery Radar shadow health diagnostics

The capture job can finish successfully while individual sources are degraded. A successful technical run preserves the validated artifact chain; it does not establish editorial coverage or authorize publication.

After capture and before artifact upload, `scripts/discovery-radar-health.mjs` writes an Actions summary showing technical health, state continuity, recovery retention, accepted item counts, needs-review counts, source errors, and request counts. Every summary states **editorial coverage NOT PROVEN** and **publication not authorized**, including healthy captures.

Source HTTP errors retain their distinct classifications: 403 is `http-forbidden`, 429 is `http-rate-limited`, and 500–599 is `http-server-error`. Other non-200 responses remain `http-status`. Existing timeout, network policy, transport, parser, and equivalence review errors remain separate. There are no new requests, retries, workarounds, or persisted response bodies/headers.

Degraded technical health, cold starts, checkpoint recovery gaps, source errors, migrations, or degraded retention produce a fixed informational warning. Valid degraded reports continue to artifact upload. Missing, corrupt, oversized, contradictory, or incorrectly bound reports produce a fixed failure before upload. This diagnostics failure protects the report/artifact boundary; it is not a publication gate.

The standalone reader accepts report version 1 and W0's additive `stateMigrations` field. It validates bounded relevant fields without importing or changing the state compatibility schema. Report files must be regular, non-symlink files of at most 512 KiB and decode as strict UTF-8 JSON. The workflow environment must identify this repository, main ref, workflow, run ID, attempt, and head; report run identity must match exactly. The reader rejects symlinks in the runner report directory chain.

Only fixed source IDs, statuses, validated numbers, and explicitly allowlisted error codes are rendered. Unrecognized error strings become `unclassified-error`. Arbitrary titles, classifications, exception messages, and source text are never echoed into summaries or annotations. A technical `health=ok` report with degraded retention remains readable because the existing producer records retention separately; it still produces a warning.

Offline fixture tests cover status taxonomy and cursor preservation, healthy/degraded summaries, legacy and W0 reports, malformed input, file limits/symlinks, environment binding, contradictions, and malicious strings. Hosted main summary visibility remains unproven until an approved merge and subsequent scheduled capture. Cron, permissions, concurrency, checkpoint selection, and publication authority remain unchanged.
