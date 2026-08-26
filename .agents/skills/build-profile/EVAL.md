# Evaluating a Candidate Profile draft

There is no validator CLI or executable schema in this version. Both
checks below are model judgment. The first is a structured compliance
pass against `CANDIDATE_PROFILE_SCHEMA.md`; the second is a separate
invocation that judges whether claims are supported by the imports and
this run's transcript. Treat a failure in either as blocking. Do not
skip either check, and do not treat a self-review in the producing
conversation as a substitute for the second check.

## 1. Schema compliance (blocking, same session is fine)

Read `CANDIDATE_PROFILE_SCHEMA.md` and the current `profile.draft.yml`.
Walk the draft against that shape and the rules listed there. This is
not a compiled validator — it is still a model pass — but it is a
checklist, not a vibe check. Any miss is blocking. Fix the draft and
re-run this check before starting the claim-support check.

Reject the draft if any of these fail:

- Required top-level shape: `schema_version`, `status`, `identity`,
  `role_tracks`, `experience`, `education`, `projects`, `skills`
  (with `demonstrated` / `reported`), `preferences`, `constraints`.
  `narrative`, `compensation`, and `logistics` may be omitted.
- `identity.name` is present.
- Every `id` is a slug: lowercase ASCII letters, digits, single
  hyphens. No `.`, `..`, no Windows-reserved names (`con`, `prn`,
  `com1`, …).
- IDs are unique within each namespace (claim IDs globally unique
  across the profile, same for track IDs, skill IDs,
  preference/constraint IDs, experience/education/project IDs).
- An `active` claim cannot have `confirmation: none`.
- `rejected` / `superseded` claims are still present, not deleted.
- Every `skills.demonstrated` entry has at least one `evidence_ids`
  entry that points at an **active** claim that actually exists.
- `approved_to_build: true` requires `candidate_acknowledged: true`.
- Every `readiness` block has non-empty `reasoning`.
- `supporting_evidence_ids` (when present) point at existing claim IDs.
- Every `dates` object: `start` / `end` match `precision` (`YYYY` for
  `year`, `YYYY-MM` for `month`); if `current: true`, `end` is `null`.
- Money items under `compensation.items` include `currency` (ISO code).
  When the candidate has expectations for more than one country, each
  country is its own item (same `field`, different `geography` /
  `currency`) — don't collapse them into one row.

Write schema findings into `profile.eval.yml` (shape below) before
moving on. A fail here means do not run check 2 yet.

## 2. Claim-support check (blocking, separate invocation)

Only runs once schema compliance passes. This is where ADR 0003
applies: **dispatch a separate agent invocation** to judge the draft,
not a self-check by the same conversation that produced it. Use a
cheaper available model if the host exposes one; if not, fall back to
the session's own model rather than skipping the check (ADR 0003).

Build the judge payload from the draft, the files listed at start-of-run
under `candidate/imports/`, and this run's `transcript.jsonl`. There are
no per-claim source pointers in this version — the judge sees the
import text and the exact transcript, and decides per claim. Do not
pass `web-lookups.yml` to the judge; those entries are readiness
context, not career evidence.

**Judge input** (hand this to the separate invocation):

```yaml
items:
  - output_path: "experience[0].evidence[0].claims[0]"
    statement: "Architected and shipped an internal developer platform"
imports_listed_at_start:
  - "resume.pdf"
transcript_path: "candidate/profile-build/runs/{run-id}/transcript.jsonl"
```

Include every `active` and `pending` claim. Skip `rejected` /
`superseded`.

**Judge instructions** to include verbatim:

> For each item, decide whether `statement` is actually supported by the
> imports and transcript. The claim may combine, summarize, or reframe
> that text — but it must not strengthen ownership, causality,
> magnitude, organizational scope, adoption, recency, or certainty
> beyond what those materials state. Return one verdict per item.

**Expected judge response** — a malformed response is rejected, not
trusted:

```yaml
verdicts:
  - output_path: "experience[0].evidence[0].claims[0]"
    verdict: supported | unsupported | ambiguous | contradicted
    explanation: "..."
overall: pass | fail
```

`overall: pass` only if every verdict is `supported`.

## On a blocking failure

A schema miss: fix the draft to match `CANDIDATE_PROFILE_SCHEMA.md` and
re-run check 1.

A non-`supported` verdict: either remove the claim, or raise a new
clarifying question with the candidate and update the draft *first* —
never edit the claim's wording just to make it pass the judge without
the underlying fact actually changing. Re-run both checks after any
change; don't assume a fix worked.

## Writing the result

Save the combined result to `profile.eval.yml` alongside the draft (see
`SESSION_SCHEMA.md`) before attempting promotion. Create the parent
directory if it doesn't exist.

```yaml
schema_check:
  result: pass | fail
  findings:
    - path: "role_tracks[0].readiness"
      issue: "approved_to_build is true but candidate_acknowledged is not"
support_check:
  verdicts:
    - output_path: "experience[0].evidence[0].claims[0]"
      verdict: supported | unsupported | ambiguous | contradicted
      explanation: "..."
  overall: pass | fail
overall: pass | fail
```

`overall: pass` requires `schema_check.result: pass` and
`support_check.overall: pass`. Do not promote otherwise.
