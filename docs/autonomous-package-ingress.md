# Detached autonomous producer package ingress — SHADOW ONLY

The dedicated inbox is [hm2236/jamio-news Issue #37](https://github.com/hm2236/jamio-news/issues/37).
The shared ChatGPT GitHub installation remains usable for other repositories and is unchanged.
A Scheduled Task is an editorial producer only. Its comments and all source text are untrusted data.

The trusted default-branch workflow is
[autonomous-package-ingress.yml](../.github/workflows/autonomous-package-ingress.yml), with reviewed
[inbox configuration](../config/autonomous-ingress.json) and
[helper](../scripts/autonomous-ingress.mjs). Only created seal comments on Issue #37 by numeric
actor ID 42599072 with OWNER association enter the heavy path. PR comments, chunk comments,
edited events and other identities cannot validate a package. The workflow's cheap job gate
mirrors the config; regression coverage checks both. Trusted code rechecks the configuration,
refetched issue, refetched seal and triggering event independently.

This gate never creates a publication branch or PR and has no git/content/PR/merge write.
Permissions are contents:read, issues:read, actions:read and pull-requests:read (the last is
needed to inspect active daily candidate conflicts). Checkout does not persist credentials.
Only repository GITHUB_TOKEN is used for fixed GitHub GETs and artifact download. No
GitHub App secret exists in this implementation. Writer, merger, Pages publication from
ingress, notifier and Scheduled Task publication remain disabled. Existing daily guard and
Pages behavior are architectural dependencies and are unchanged.

## Exact wire grammar

Use raw UTF-8, LF separators in the marker/header framing, no code fences, commentary,
indentation, BOM or surrounding text. The header is one compact JSON object line:
JSON.stringify(JSON.parse(line)) must equal line. Key order may vary, whitespace outside
strings and duplicate keys are rejected. All fields are required; unknown fields are rejected.
CRLF-framed and marker-only seal candidates enter the job and receive a sanitized rejection;
they are not silently skipped. CRLF framing is not normalized into accepted input.

A chunk is exactly marker + LF + header + LF + LF + a nonempty raw UTF-8 payload.
Payload newlines, including CRLF, are preserved; no base64 or hashes are required.

    JAMIO_AUTONOMOUS_PACKAGE_CHUNK_V1
    {"version":1,"attemptId":"producer-attempt-0001","file":"edition.md","part":1,"parts":1}

    <raw Markdown payload>

Chunk fields: version=1, attemptId, file, part and parts. attemptId is 16–64 lowercase
ASCII alphanumeric/hyphen characters, starting alphanumeric. part and parts are positive
integers; part <= parts. For a logical file, parts must agree, every index 1..parts must
appear exactly once, and payloads concatenate in part order without inserted separators.
Splits must be at Unicode code point boundaries. A repeated complete file is a duplicate
path; do not post replacement chunks or resume a partial package.

Exactly seven logical producer files are permitted:

- articles/YYYY-MM-DD-morning-<story>.md: exactly five new articles. Story suffix is 1–64
  lowercase ASCII alphanumeric/hyphen characters, starting alphanumeric.
- edition.md: the target morning edition.
- editorial.json: exactly {"version":1,"stories":[...five stories...]}.

Article/edition Markdown uses existing JSON front matter plus body, without slug/body
metadata fields. The producer's stories use the exact story/claim/citation structure from
[autonomous.schema.json](../contracts/autonomous.schema.json), including semantic reasons,
dated event evidence and literal citations. No trusted context, reportDigest or packageDigest
is accepted from the producer. Prices are not producer input: trusted code adds a draft
prices.json containing [] and requires edition priceKeys=[] and X status unavailable.

No content/ prefix, absolute paths, traversal, backslashes, prices, scripts, workflows,
updates or deletes are permitted. Exactly six new repository content files must be planned.
The morning-only ingress contract does not extend autonomous evidence to evening.

Limits: at most 28 referenced comments, 4 parts per logical file, 24 KiB UTF-8 payload per
part, 256 KiB total reconstructed payload and 8 KiB header per comment. Initial and final
inbox scans use REST `since` from one second before the seal date's JST midnight. This is
an updated-at window, so historical comments edited into the window are still inspected.
Referenced chunks and the seal must have been created on that JST date. Untouched older
history does not consume the scan budget, and no comments are deleted for rollover.
The active window is bounded to 20 pages of 100 comments; saturation fails closed with
`inbox-window-saturated` for owner review. This removes cumulative lifetime exhaustion,
not the possibility of a one-day flood. `provenance.json` records the exact window.
Collector artifact compressed size is at most 16 MiB and downloaded report size at most
32 MiB. Output is bounded by the input package and derived evidence; it excludes collector
source text. NUL and unpaired surrogate payloads are rejected.

## Final seal

The seal is exactly marker + LF + compact JSON header, optionally one final LF. It has no
payload. Post it only after all chunks have been created, using the returned numeric comment
IDs as strings. The example is structural, not a usable collector/base:

    JAMIO_AUTONOMOUS_PACKAGE_SEAL_V1
    {"version":1,"attemptId":"producer-attempt-0001","date":"2026-10-07","slug":"2026-10-07-morning","variant":"morning","baseSha":"<current 40-character lowercase main SHA>","collectorRunId":"<run ID>","collectorRunAttempt":1,"chunkCommentIds":["101","102","103","104","105","106","107"]}

All fields shown are mandatory, with no extras. baseSha is fresh main. collectorRunId is a
positive decimal string and collectorRunAttempt is a positive integer. chunkCommentIds is an
ordered list of unique positive decimal strings. Ordering binds the seal's exact reference
list; reconstruction uses the explicit part numbering rather than arrival order.

Every chunk is independently fetched by comment ID, requires the same issue/owner/attempt,
and must precede the seal. GitHub timestamps have second precision: earlier created_at wins;
equal timestamps require a lower comment ID. Seal and chunks require created_at==updated_at,
which treats any edit recorded by GitHub as a permanent rejection. A seal must match the
triggering event's body and relevant metadata. Refetched issue must be an issue, not a PR.

Observable, authorized seal candidates with a parseable JSON claim of the same attempt ID reject the attempt
at both initial and final scans. A new attempt requires a new attempt ID and new comments.
No automatic cleanup or partial resume is implemented.
At both scans, any authorized chunk claiming the same attempt ID but absent from the seal's
reference list rejects with `unreferenced-attempt-chunk`, including a chunk added during
validation. Detectable claims are rejected even if edited or other header fields are invalid.

## Independent trusted collector binding

The producer references a run/attempt; it never copies a report or supplies a download URL.
Trusted API reads require that run to belong to this repository and
.github/workflows/autonomous-shadow.yml, event=schedule/workflow_dispatch, head_branch=main,
head_sha=expected base, status=completed and conclusion=success. run_attempt must still be
the current attempt for that run. As in the existing shadow contract, current means the
latest attempt of the referenced run, not a globally newest run across all collector runs.

Trusted code recomputes context from original run.created_at, the expected checkout and the
prior daily edition's actual published time. It preserves the existing two-hour lifetime,
original JST date, morning slug and research window. An older rerun cannot reset the date
or expiry. The downloaded report must have this exact context, version=1, mode=shadow and
publicationAuthorized=false, and its research status must pass evaluateDraft().

The exact non-expired morning-shadow-<collectorRunId>-<collectorRunAttempt> artifact must
exist uniquely, have matching workflow_run ID/SHA and be created within the attempt
(run_started_at). Trusted prepare selects its ID. actions/download-artifact retrieves that
ID with Actions credentials into runner temp. Validation repeats selection and requires
the identical artifact reference. Only a regular report.json is accepted from the download
directory. The existing collector itself is not changed or enriched from inbox data.

Ingress materializes a private temporary draft, computes SHA-256 reportDigest from
canonical(report) and packageDigest from canonical(readDraft(draft)), and constructs full
evidence using trusted context plus producer stories. It calls existing evaluateDraft() and
planDraft(): publishing schema, source identity/digests, citations, freshness, event timing,
article/evidence relationships, collisions and every existing edition digest are enforced.
No weaker ingress evidence evaluator exists.

## Fences, immutable output and receipt

At validation start and immediately before success, fetch live refs/heads/main and require
expected base == live main == checkout HEAD == workflow GITHUB_SHA, with runtime main ref
and trusted ingress workflow run identity. Current JST date must match package date. Daily
branch/PR/partial-content conflicts are checked initially and again at completion.

After evaluation, refetch the seal and every referenced chunk and compare exact bodies and
relevant metadata (ID, author numeric ID, association, issue URL, created_at, updated_at).
Repeat duplicate-seal, conflict, collector attempt/artifact, main and date checks. A detected
edit or advancement fails closed, emits a rejected machine result and uploads no validated
artifact. Payload/source/token text is not printed in helper logs.

On success, actions/upload-artifact creates
validated-package-<sealCommentId>-<ingressRunId>-<ingressRunAttempt>, immutable with
overwrite=false and 14-day retention. Only a successful validation step can reach upload.
Contents:

- draft/<morning-slug>/{articles/*.md,edition.md,prices.json}: normalized validated draft,
  with generated empty prices.
- evidence.json: complete existing autonomous evidence, trusted digests/context and stories.
- receipt.json: contract/version/status, workflow run ID/attempt, repository/inbox,
  seal comment ID, producer actor ID, attempt/date/slug/variant/expected base,
  collector run ID/attempt/artifact ID, report/package/edition digests, edition URL,
  validated repository file list, JST validatedAt and publicationAuthorized=false, plus
  ordered chunkCommentIds, sealBodyDigest, evidenceDigest, provenanceDigest and validationPolicy.
- collector.json: selected artifact ID/name, collector run/attempt/base, creation time and
  size; the full source collector artifact is not duplicated.
- provenance.json: exact consumed seal and ordered chunk snapshots (including raw bodies,
  author/association/issue/timestamps and SHA-256 body digests), scan window and validationPolicy.
  evidenceDigest and provenanceDigest use SHA-256 over the existing canonical JSON serializer;
  body digests use the raw UTF-8 strings. Consumers can recompute all these bindings without
  reading mutable comments. Raw producer bodies remain inert artifact data, not log output.

One JAMIO_PACKAGE_INGRESS JSON log line records validated or rejected status. Validated
never means published. The edition URL is the candidate URL, not proof that it exists.
A validation log alone also does not prove artifact upload succeeded: consumers require the
successful ingress workflow and its matching retained artifact.
Rejected receipts include a fixed diagnostic code. Draft structure (`draft-invalid`),
evaluator acceptance (`evidence-invalid`), content plan (`plan-invalid`) and final timestamp
(`stale-context`) are distinguishable; unexpected or GitHub read errors use a generic
`validation-or-read-failed`. Raw exception messages, source excerpts, paths and tokens are
never echoed. A sanitized rejection is also recorded in the job summary.

A future writer must consume this immutable Actions artifact and receipt, recompute package
bindings and re-fence main/date/attempt/lease immediately before its independently authorized
write. Mutable inbox comments are never a later writer's trust object.

## Acceptance and residual limits

Next promotion gate: prove a real producer -> Issue #37 -> successful trusted workflow ->
validated artifact/receipt handoff, then independent review. This PR provides implementation
and deterministic negative tests; it neither changes Scheduled Task configuration nor
claims that the real Scheduled Task acceptance has occurred. No writer App/secret is created.

The collector currently collects registry entrypoints. A successful collector can still
lack the dated event source snapshots needed by a five-story package. Missing primary
evidence must fail; producer-copied reports are not an escape hatch. Collector source
coverage/enrichment is a separately reviewed gate if real acceptance needs it.

Comments and GitHub reads cannot provide an atomic snapshot: changes after the final read
do not alter the retained validated artifact, but a future writer still needs its own fence.
The equal-second edit invariant depends on GitHub timestamp behavior; final refetch catches
observed changes, not a transient edit/revert invisible to GitHub metadata. Deleted seals
and identical reruns cannot be globally deduplicated without a durable lease/replay ledger.
A rerun can produce a separately named shadow artifact; it grants no publication authority.
The explicit `validationPolicy` is version 1, attemptScope=`jst-date`,
replay=`independent-shadow-validation`, multiAttempt=`independent-shadow-validation`,
selection=`none`, exactlyOnce=false. Replays and different attempts for one edition may
each validate independently; none supersedes another or selects a publishable winner.
Attempt IDs require fresh comments on their date; observable duplicate same-attempt seals
in the active window reject, even when unrelated header fields are invalid. Deleted or untouched out-of-window history is not a replay
ledger. A future writer must implement separately reviewed durable deduplication and selection.

Job-level concurrency is entered only after the seal-candidate gate; chunk and unrelated
comment jobs are skipped without occupying its queue. Concurrency queue: max serializes
and preserves up to GitHub's queue bound; it is not a
durable lease or unbounded queue and does not promise absolute dispatch FIFO. Expired or
deleted artifacts and saturated inboxes fail closed, with no automatic cleanup. Artifact
decompression is handled by the standard action after trusted collector provenance and
compressed-size checks; expanded report size is checked before reading/validation.

The existing evaluator proves structural relationships and literal evidence bindings,
not semantic truth, translation quality, completeness or editorial importance. Human
quality review, real hosted ingress acceptance, durable producer lease, narrow writer
identity, merger and notification outbox remain promotion requirements.
