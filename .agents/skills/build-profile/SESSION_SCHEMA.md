# Profile Build run state — session.yml and transcript.jsonl

This is not a promoted artifact. It is working state the agent itself
reads and writes directly during a live session.

Every run lives under `candidate/profile-build/runs/{run-id}/`. Create
that directory if it does not exist before writing any of these files.

```text
candidate/profile-build/runs/{run-id}/
  session.yml
  transcript.jsonl
  profile.draft.yml
  profile.eval.yml
  web-lookups.yml              # only when a Track Readiness web lookup ran
  profile.yml.pre-promotion    # only when a canonical profile was backed up
```

`run-id` is a stable slug, e.g. `run-20260824-a` (date plus a
disambiguator for same-day reruns).

## session.yml

The resumable checkpoint snapshot, rewritten after **every** candidate
response (not just at section boundaries — that's what makes a run
actually resumable mid-conversation, per ADR 0002).

`current_checkpoint` and each entry in `completed_checkpoints` MUST be
one of the slugs from `SKILL.md` (Checkpoints): `identity`, `education`,
`timeline`, `evidence`, `projects`, `skills`, `preferences`,
`compensation`, `tracks`, `readiness`, `narrative`.

```yaml
run_id: run-20260824-a
status: in_progress | abandoned | promoted
seeded_from: candidate/profile.yml | null   # the profile this run is reconciling against, if any
started_at: "2026-08-24T13:05:00Z"
updated_at: "2026-08-24T13:41:12Z"

current_checkpoint: evidence
completed_checkpoints: [identity, education, timeline]

# Questions raised but not yet resolved -- what a resumed session picks
# back up.
pending_questions:
  - checkpoint: evidence
    question: "You mentioned leading a migration -- roughly how many repositories?"

# Contradictions between sources awaiting candidate resolution (see
# CONTEXT.md, Confirmation tiers -- "does not erase history").
conflicts:
  - description: "Resume says 2021-2023, LinkedIn says 2021-2024 for ExampleCorp"
    candidate_claim_ids: []   # populated once provisional claims exist for each side

# Known gaps -- both blocking (must close before usable_with_gaps) and
# non-blocking (flagged, doesn't stop completion). See GAP_CHECKLIST.md.
gaps:
  - checkpoint: skills
    description: "No demonstrated skills recorded yet"
    blocking: true

last_transcript_event_id: event-42
```

`status: abandoned` is a soft delete (ADR 0002) — the run's files stay on
disk for history, but the run itself can never feed generation again.
`status: promoted` marks a run whose draft was successfully written to
`candidate/profile.yml`.

## transcript.jsonl

Append-only, one JSON object per line, written after every candidate
response (same cadence as `session.yml`). This is the **exact** exchange
— never an agent-written summary — so a resumed session and the
claim-support check in `EVAL.md` can see what the candidate actually
said, not a paraphrase of it.

```jsonl
{"event_id": "event-1", "role": "agent", "timestamp": "2026-08-24T13:05:00Z", "text": "Let's start with your most recent role..."}
{"event_id": "event-2", "role": "candidate", "timestamp": "2026-08-24T13:06:15Z", "text": "I was a senior engineer at ExampleCorp from 2020 to 2023."}
```

`event_id` is `event-N`, a monotonically increasing counter starting at
`event-1` for the run — never reused, even across a resume after
abandonment (a fresh run gets its own `run-id` and its own counter
starting over).

## profile.draft.yml

Same shape as `candidate/profile.yml` (see `CANDIDATE_PROFILE_SCHEMA.md`)
— this **is** a Candidate Profile document, just run-scoped and not yet
promoted. Written after each completed checkpoint, not after every turn.
Check it the same way as the canonical file (`EVAL.md`).

## profile.eval.yml

The result of `EVAL.md` for this draft — schema-compliance findings plus
the claim-support verdicts. Written once evaluation actually runs, i.e.
once the draft is a completion candidate, not after every checkpoint.
See `EVAL.md` for the file shape.

## web-lookups.yml

Append-only log of scoped web lookups used for Track Readiness
domain/scale context. Create the file on the first lookup (and its
parent directory if needed). Never write these into `transcript.jsonl`
— that file is the exact conversation, not tool output. Lookups are
not career evidence; `EVAL.md` must not treat this file as support for
a claim.

```yaml
lookups:
  - queried_at: "2026-08-26T10:15:00Z"
    url: "https://example.com/about"
    employer: ExampleCorp
    purpose: track_readiness_domain_scale
    summary: "Mid-size B2B SaaS, ~400 employees, product is an analytics warehouse."
```

`purpose` is `track_readiness_domain_scale` for this skill. `summary`
is compact: scale, product type, industry — enough to grade readiness,
not a page dump.

## profile.yml.pre-promotion

Copy of `candidate/profile.yml` as it existed immediately before this
run replaced it. Only written when a canonical profile was already
present. Not pruned.
