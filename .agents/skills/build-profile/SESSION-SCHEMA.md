# Profile Build run state — session.yml and transcript.jsonl

Unlike `CANDIDATE-PROFILE-SCHEMA.md` and `MASTER-RESUME-SCHEMA.md`, this
contract has **no executable Zod schema** backing it — it's not a
promoted, eval-gated artifact, it's working state the agent itself reads
and writes directly during a live session. If that ever changes (e.g. a
future tool needs to parse `transcript.jsonl` programmatically), add a
real schema under `tools/src/` rather than growing ad hoc parsing logic
elsewhere.

Every run lives under `candidate/profile-build/runs/{run-id}/`:

```text
candidate/profile-build/runs/{run-id}/
  session.yml
  transcript.jsonl
  profile.draft.yml
  profile.eval.yml
```

`run-id` is a stable slug, e.g. `run-20260824-a` (date plus a
disambiguator for same-day reruns). It's the qualifier in every
`source:{run-id}:...` and `transcript:{run-id}#...` reference this run's
claims create.

## session.yml

The resumable checkpoint snapshot, rewritten after **every** candidate
response (not just at section boundaries — that's what makes a run
actually resumable mid-conversation, per ADR 0002).

```yaml
run_id: run-20260824-a
status: in_progress | abandoned | promoted
seeded_from: candidate/profile.yml | null   # the profile this run is reconciling against, if any
started_at: "2026-08-24T13:05:00Z"
updated_at: "2026-08-24T13:41:12Z"

current_checkpoint: experience
completed_checkpoints: [identity, education]

# Questions raised but not yet resolved -- what a resumed session picks
# back up.
pending_questions:
  - checkpoint: experience
    question: "You mentioned leading a migration -- roughly how many repositories?"

# Contradictions between sources awaiting candidate resolution (see
# CONTEXT.md, Confirmation tiers -- "does not erase history").
conflicts:
  - description: "Resume says 2021-2023, LinkedIn says 2021-2024 for ExampleCorp"
    candidate_claim_ids: []   # populated once provisional claims exist for each side

# Known gaps -- both blocking (must close before usable_with_gaps) and
# non-blocking (flagged, doesn't stop completion). See GAP-CHECKLIST.md.
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
— never an agent-written summary — because Evidence Claims cite specific
events (`transcript:{run-id}#{event-id}`) and the grounding judge needs
to check what the candidate actually said, not a paraphrase of it.

```jsonl
{"event_id": "event-1", "role": "agent", "timestamp": "2026-08-24T13:05:00Z", "text": "Let's start with your most recent role..."}
{"event_id": "event-2", "role": "candidate", "timestamp": "2026-08-24T13:06:15Z", "text": "I was a senior engineer at ExampleCorp from 2020 to 2023."}
```

`event_id` is `event-N`, a monotonically increasing counter starting at
`event-1` for the run — never reused, even across a resume after
abandonment (a fresh run gets its own `run-id` and its own counter
starting over).

## profile.draft.yml

Same shape as `candidate/profile.yml` (see `CANDIDATE-PROFILE-SCHEMA.md`)
— this **is** a Candidate Profile document, just run-scoped and not yet
promoted. Written after each completed checkpoint, not after every turn.
Validate it the same way as the canonical file:

```sh
pnpm --filter @loom/tools profile-validate candidate/profile-build/runs/{run-id}/profile.draft.yml
```

## profile.eval.yml

The grounding eval's result for this draft — schema validation issues
plus the judge's verdicts, combined (see `tools/src/grounding-eval/result.ts`
and `EVAL.md`). Written once evaluation actually runs, i.e. once the
draft is a completion candidate, not after every checkpoint.
