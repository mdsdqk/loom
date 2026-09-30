# Evaluating a Master Resume draft

There is no validator CLI or executable schema in this version. Both
checks below are model judgment. The first is a structured compliance
pass against `MASTER_RESUME_SCHEMA.md` and the Candidate Profile; the
second is a separate invocation that judges whether generated prose is
supported by the referenced Evidence Claims. Treat a failure in either
as blocking. Do not skip either check, and do not treat a self-review
in the producing conversation as a substitute for the second check.

Re-run **both** checks after every edit round, including
presentation-only ones — a tone or impact rewrite can still fail
grounding if it quietly strengthens the claim.

## 1. Schema and cross-reference (blocking, same session is fine)

Read `MASTER_RESUME_SCHEMA.md`, the current `resume.draft.yml`, and
`candidate/profile.yml`. Walk the draft against that shape and the
rules listed there. This is not a compiled validator — it is still a
model pass — but it is a checklist, not a vibe check. Any miss is
blocking. Fix the draft and re-run this check before starting the
grounding check.

Reject the draft if any of these fail:

- Required top-level shape: `schema_version`, `track_id`, `identity`,
  `summary`, `experience`, `skills`, `presentation`. `education` may
  be omitted. `projects` and `recognition` may be empty lists.
- `schema_version` is `1`.
- `track_id` matches a `role_tracks` entry on the Candidate Profile
  with `approved_to_build: true`.
- Every `id` (and `track_id`) is a slug: lowercase ASCII letters,
  digits, single hyphens. No `.`, `..`, no Windows-reserved names
  (`con`, `prn`, `com1`, …).
- IDs are unique within each list (`experience`, `education`,
  `projects`, `skills`, `recognition`).
- `identity.profile_ref` resolves; `identity.name` exactly matches the
  profile; `identity.location`, when present, exactly matches.
- Every `experience` entry: `profile_ref` resolves to that experience
  record; `company` exactly matches; `role` exactly matches the
  profile's `title`; `dates` exactly match.
- Every `education` entry, when the section is present: `profile_ref`
  resolves; `institution` exactly matches; `degree` / `field_of_study`
  / `dates`, when present on the resume, exactly match the profile.
- Every `skills` entry: `profile_ref` starts with
  `skills.demonstrated.` and resolves; `name` exactly matches. A
  `profile_ref` into `skills.reported.*` fails here.
- Every generated prose field (`summary`, experience `intro`, every
  bullet, project `description`, every recognition item) has at least
  one `evidence_ids` entry, and every id points at an **active**
  Evidence Claim that exists in the profile. A reference to a
  `pending`, `rejected`, `superseded`, or unknown claim fails here —
  it is not a softer case for the judge to weigh in on.
- Every `dates` object: `start` / `end` match `precision` (`YYYY` for
  `year`, `YYYY-MM` for `month`); if `current: true`, `end` is `null`.
- `presentation.target_pages` is a positive integer.

Write schema findings into `resume.draft.eval.yml` (shape below)
before moving on. A fail here means do not run check 2 yet.

## 2. Grounding check (blocking, separate invocation)

Only runs once schema and cross-reference pass. This is where ADR 0003
applies: **dispatch a separate agent invocation** to judge the draft,
not a self-check by the same conversation that produced it. Use a
cheaper available model if the host exposes one; if not, fall back to
the session's own model rather than skipping the check (ADR 0003).

Build the judge payload from the draft and `candidate/profile.yml`.
The judge sees each generated prose field alongside the **referenced
Evidence Claim statements** from the profile — not the original
imports, and not `web-lookups.yml`. There are no per-claim source
pointers in this version. `profile_ref` fields are **not** included;
those were already checked exactly in step 1 and don't need judgment.

Include every generated prose field: `summary`, each experience
`intro`, each bullet, each project `description`, each recognition
item. Skip a field that isn't present (no optional `intro`, no
project without `description`). Coverage is required: an empty or
truncated judge response that misses a field is a fail, not a pass.

**Judge input** (hand this to the separate invocation):

```yaml
items:
  - output_path: "experience[0].bullets[0]"
    claim_text: "Architected an internal platform used by several teams..."
    evidence:
      - id: examplecorp-developer-platform-built
        statement: "Architected and shipped an internal developer platform"
      - id: examplecorp-developer-platform-adoption
        statement: "The platform was adopted by several internal teams"
```

**Judge instructions** to include verbatim:

> For each item, decide whether `claim_text` is actually supported by
> the given evidence. The text may combine, summarize, or reframe the
> evidence — but it must not strengthen ownership, causality,
> magnitude, organizational scope, adoption, recency, or certainty
> beyond what the evidence states. Return one verdict per item.

**Expected judge response** — a malformed response is rejected, not
trusted:

```yaml
verdicts:
  - output_path: "experience[0].bullets[0]"
    verdict: supported | unsupported | ambiguous | contradicted
    evidence_ids: [examplecorp-developer-platform-built, examplecorp-developer-platform-adoption]
    explanation: "..."
overall: pass | fail
```

`overall: pass` only if every verdict is `supported`. A declared
`overall: fail` blocks even if every individual verdict happens to
say `supported`.

## On a blocking failure

A schema / cross-reference miss: fix the draft to match
`MASTER_RESUME_SCHEMA.md` and re-run check 1.

A non-`supported` verdict: if it's a wording problem within what the
evidence already supports (including a presentation rewrite that
quietly overclaimed), fix the draft's prose and re-run both checks.
If the underlying fact itself needs to change, **stop this run** and
follow the `/build-profile` reconciliation path first (see `SKILL.md`,
"Pending and factual corrections"). Never edit wording just to make a
check pass without the underlying fact actually being true. Re-run
both checks after any change; don't assume a fix worked.

Do not send the candidate to `/build-profile` for a grounding miss
that is only overstated wording — walk that wording back in the
draft unless they then say the underlying fact is wrong.

## Writing the result

Save the combined result to `resume.draft.eval.yml` alongside the
draft before presenting it to the candidate or attempting promotion.
Create the parent directory if it doesn't exist.

```yaml
schema_check:
  result: pass | fail
  findings:
    - path: "experience[0].role"
      issue: "does not match Candidate Profile experience.title"
support_check:
  verdicts:
    - output_path: "experience[0].bullets[0]"
      verdict: supported | unsupported | ambiguous | contradicted
      evidence_ids: [examplecorp-developer-platform-built]
      explanation: "..."
  overall: pass | fail
overall: pass | fail
```

`overall: pass` requires `schema_check.result: pass` and
`support_check.overall: pass`. Do not present the draft as ready, and
do not promote, otherwise.
