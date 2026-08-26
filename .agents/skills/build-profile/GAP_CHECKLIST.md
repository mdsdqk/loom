# Gap checklist

Rules `SKILL.md` applies at each checkpoint to decide what still needs
asking about, plus the completion gate for promoting a draft. This list
is explicitly extensible — add rules here as gaps in practice turn out
to matter, rather than hardcoding them into `SKILL.md`'s prose.

Checkpoint slugs match `SKILL.md` / `SESSION_SCHEMA.md`: `identity`,
`education`, `timeline`, `evidence`, `projects`, `skills`,
`preferences`, `compensation`, `tracks`, `readiness`, `narrative`.

Most rules below are checkable from the draft profile. Two are not —
`education` (asked even if empty) and `preferences` (asked, even if the
lists stay empty). For those, also check `session.yml`
(`completed_checkpoints`) and, if needed, `transcript.jsonl`. Do not
treat an empty `education` or `preferences` list as proof the
checkpoint happened.

Content-quality gaps — vague evidence, unclear scope, evidence that's
technically present but weak — are **not** on this list; those need
judgment layered on top, applied per checkpoint, not a fixed rule (see
`SKILL.md`'s Checkpoints section).

## Per-checkpoint structural checks

- **`identity`**: `identity.name` present. At least one contact field
  populated (a profile with zero contact info is a gap worth flagging,
  even though no single contact field is required).
- **`education`**: `education` is in `session.yml`
  `completed_checkpoints`. An empty `education:` list is fine if the
  checkpoint was asked; a missing slug means it was skipped.
- **`timeline`**: every claimed year of experience covered by at least
  one dated role — an unexplained multi-month+ gap between roles is
  worth surfacing to the candidate, not silently accepted.
- **`evidence`**: every material role has at least one Evidence Claim
  with `status: active`. A role with zero evidence is a role that
  contributes nothing to any downstream Master Resume.
- **`projects`**: independent projects worth keeping have the same
  evidence-claim treatment as roles; skip only if the candidate has
  none and that was asked.
- **Dates**: every `dates` object matches its stated `precision`, and
  `current: true` has `end: null`. A miss here is "go back and fix it"
  (`EVAL.md`), not a new candidate question.
- **`skills`**: every `skills.demonstrated` entry has at least one
  *active* Evidence Claim (`EVAL.md` must reject otherwise). A
  candidate who names a skill with no backing evidence anywhere in
  `experience` / `education` / `projects` is a gap: either surface
  supporting evidence or move it to `reported`.
- **`tracks` / `readiness`**: every entry in `role_tracks` has completed
  Track Readiness (a `readiness` block with non-empty `reasoning`)
  before it can be marked `approved_to_build: true` — `EVAL.md` rejects
  `approved_to_build` without `candidate_acknowledged`, but *reaching*
  that acknowledgement is this checklist's job.
- **`preferences`**: `preferences` is in `completed_checkpoints`. An
  entirely empty `preferences` / `constraints` list is not necessarily
  a gap (some candidates have none worth recording), but *never having
  asked* is.

## Blocking vs. non-blocking

**Blocking** — required for `usable_with_gaps`:
- Identity and contact present.
- Structured career timeline present.
- At least one active Evidence Claim per material role.
- `education` in `completed_checkpoints` (even if the list is empty —
  asked, not skipped).
- Skills classification completed.
- `preferences` in `completed_checkpoints`.
- At least one approved Target Track.
- Track Readiness recorded for every approved track.
- No contradictory assertion left `active` (unresolved conflicts stay
  `pending`, never silently resolved by picking one side). Pending
  conflicts do not block `usable_with_gaps`.
- Both checks in `EVAL.md` pass.

**Non-blocking, flagged** — surfaced to the candidate (in the transcript
and/or a summary), doesn't stop promotion:
- Missing metrics on an otherwise-solid claim ("you mention impact but no
  number — want to add one, or leave it qualitative?").
- Thin evidence on a skill that's present but weakly supported.
- Optional `compensation` / `logistics` fields left unset.
- `narrative` left minimal or unset.

`complete` (vs. `usable_with_gaps`) additionally requires **no** known
required gap and **no** unresolved conflict of any kind — not just the
blocking subset above.
