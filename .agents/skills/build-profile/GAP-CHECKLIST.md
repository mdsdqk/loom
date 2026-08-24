# Gap checklist

Deterministic rules `SKILL.md` applies at each checkpoint to decide what
still needs asking about, plus the completion gate for promoting a draft.
This list is explicitly extensible — add rules here as gaps in practice
turn out to matter, rather than hardcoding them into `SKILL.md`'s prose.

Every rule below is mechanically checkable from the draft profile alone
(no model judgment required). Content-quality gaps — vague evidence,
unclear scope, evidence that's technically present but weak — are **not**
on this list; those need AI judgment layered on top, applied per
checkpoint, not a fixed rule (see `SKILL.md`'s Checkpoints section).

## Per-checkpoint structural checks

- **Identity/contact**: `identity.name` present. At least one contact
  field populated (a profile with zero contact info is a gap worth
  flagging, even though the schema doesn't require any single one).
- **Career timeline**: every claimed year of experience covered by at
  least one dated role — an unexplained multi-month+ gap between roles is
  worth surfacing to the candidate, not silently accepted.
- **Each material role**: at least one Evidence Claim with `status: active`.
  A role with zero evidence is a role that contributes nothing to any
  downstream Master Resume.
- **Dates**: every `dates` object matches its stated `precision` (schema
  already enforces this at write time — treat a validation failure here
  as "go back and fix it," not "ask the candidate a new question").
- **Skills**: every `skills.demonstrated` entry has at least one *active*
  Evidence Claim (schema-enforced). A candidate who names a skill with no
  backing evidence anywhere in `experience`/`education`/`projects` is a
  gap: either surface supporting evidence or move it to `reported`.
- **Target Tracks**: every entry in `role_tracks` has completed Track
  Readiness (a `readiness` block with non-empty `reasoning`) before it
  can be marked `approved_to_build: true` — schema enforces
  `candidate_acknowledged` as a prerequisite for approval, but *reaching*
  that acknowledgement in the first place is this checklist's job, not
  the schema's.
- **Preferences/constraints**: at least a pass through this checkpoint
  happened — an entirely empty `preferences`/`constraints` isn't
  necessarily a gap (some candidates have none worth recording), but
  *never having asked* is.

## Blocking vs. non-blocking (Eval severity — see `CONTEXT.md`)

**Blocking** — required for `usable_with_gaps`, per the plan's Completion
section:
- Identity and contact present.
- Structured career timeline present.
- At least one active Evidence Claim per material role.
- Education checkpoint completed (even if empty — asked, not skipped).
- Skills classification completed.
- Preferences and hard constraints checkpoint completed.
- At least one approved Target Track.
- Track Readiness recorded for every approved track.
- No contradictory assertion left `active` (unresolved conflicts stay
  `pending`, never silently resolved by picking one side).
- Passing schema validation and grounding eval (see `EVAL.md`).

**Non-blocking, flagged** — surfaced to the candidate (in the transcript
and/or a summary), doesn't stop promotion:
- Missing metrics on an otherwise-solid claim ("you mention impact but no
  number — want to add one, or leave it qualitative?").
- Thin evidence on a skill that's present but weakly supported.
- Optional `compensation`/`logistics` fields left unset.
- `narrative` left minimal or unset.

`complete` (vs. `usable_with_gaps`) additionally requires **no** known
required gap and **no** unresolved conflict of any kind — not just the
blocking subset above.
