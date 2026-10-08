# Offline Radar timing and precision-aware freshness

This independent utility calculates diagnostics from an operator-supplied successful rolling capture report, Observation JSONL file, and saved Actions run metadata. The operator must independently verify input origin, artifact integrity, and provenance first. The utility validates relevant structure and bindings; it does not attest origin, authenticate an artifact chain, invoke a producer, fetch a source, or grant publication authority.

Run explicitly with three input paths and an as-of UTC time:

```text
node scripts/discovery-radar-timing.mjs report.json observations.jsonl actions-run.json 2026-10-08T15:00:00Z
```

There is no default clock, runner invocation, workflow integration, or network access. Input files must be regular, non-symlink files and strict UTF-8: report at most 512 KiB, observations at most 256 KiB and 41 rows, saved API metadata at most 128 KiB. Reads stay bounded even if a file grows after its initial metadata check. Invalid input exits with a fixed error and no derived output.

The report must identify the exact successful completed main run in this repository/workflow, matching its run ID, attempt, head, creation time, and schedule/dispatch event. Relevant report timing and accepted source counts are checked; optional W0 additions are accepted without changing or depending on its state schema. Observation IDs must be unique, fixed source/adapter/channel/lane labels must agree, accepted per-source counts must match, and capture/recognition times must fall within the collector run.

UTC timestamps must use valid canonical second or millisecond ISO forms. The output keeps run creation, the saved API workflow start, collector start, and collector completion separate. It measures creation-to-workflow, workflow-to-collector, total creation-to-collector, collector duration, and completed-capture age at the explicit as-of time. The chronology must satisfy creation ≤ workflow start ≤ collector start ≤ collector completion. Capture age is the age of the collector artifact, not the age of the newest story or evidence of coverage.

For scheduled runs, the tool rederives the existing latest hourly `:17` slot before run creation and checks the report's method and delay. This is an **estimate**, not the original intended cron time, a missed-slot count, a cause, a deadline, or a scheduling guarantee. Manual dispatch must have null slot/delay and `not-scheduled` method. No inter-run schedule conclusions are inferred.

Per fixed source, the tool reports accepted counts and body-complete-to-recognition ranges. Datetime publication values produce publication-to-body age ranges; negative values remain negative and are separately counted/ranged as future publication values relative to capture. The utility does not trust or attest the source clock. Date-only values and unknown/null publication values have separate counts and **null exact age**. Source update times never substitute for publication times.

Output contains only fixed IDs, validated timestamps, numbers, and fixed explanatory labels. Titles, URLs, raw bodies, arbitrary metadata, and source health/error text are omitted. Every output states **editorial coverage NOT PROVEN**, **clock attestation NOT PROVEN**, and `publicationAuthorized:false`. Continuous schedule evidence, hosted timing UI, coverage/recall, and publication readiness remain separate work.
