---
name: build-master-resume
description: Turns one usable Candidate Profile and one approved Target Track into a ready-to-use, candidate-accepted Master Resume, with no job description involved. Use when the candidate wants a general-purpose resume for a specific track, either right after Profile Build or independently later.
---

# Build Master Resume

## Purpose

Turns a usable **Candidate Profile** and one **approved Target Track**
into a **Master Resume** (`candidate/tracks/{track}/resume.yml`) — a
ready-to-use resume for that track, reflecting the candidate's own
structure, tone, and priorities, not a filtered view of the profile. See
`/CONTEXT.md` (Master Resume, Master Resume Build) and ticket 009 for the
full product framing.

Profile Build can offer to invoke this after onboarding, but it's also
independently callable — rebuilding one track's resume never requires
repeating the whole profile interview.

## Non-goals

- **Receives no job description, ever.** Job-specific tailoring is a
  separate, downstream concern (ticket 004) this skill knows nothing
  about.
- **Never edits `candidate/profile.yml`.** If a factual correction is
  needed, this run stops and hands off to `/build-profile` — see "Pending
  and factual corrections" below. This isn't a shortcut being skipped;
  it's the actual boundary between the two skills.
- Not where Track Readiness gets decided — that already happened in
  Profile Build (checkpoint 9). This skill reads the result, it doesn't
  re-adjudicate it.

## Inputs

- One Candidate Profile with `status: usable_with_gaps` or `complete`
  (never `in_progress` — see `/CONTEXT.md`, Candidate Profile usability).
- One Target Track from that profile's `role_tracks`, with
  `approved_to_build: true`.
- General preferences (`preferences`/`constraints` from the profile).
- Presentation preferences (tone, page budget — ask if not already
  evident from the profile's `narrative`).

## Process

1. **Validate before drafting anything**: profile usability, that the
   requested track exists and has `approved_to_build: true`. If either
   fails, stop and explain why — don't draft against an unapproved or
   unusable profile state.
2. **Surface materially relevant pending evidence.** If there's a
   `pending` Evidence Claim that would meaningfully strengthen this
   track's resume, ask the candidate about it now rather than silently
   leaving it out. If they confirm or reject it, that's a **factual**
   change — see "Pending and factual corrections" below; don't just fold
   the answer into the draft directly.
3. **Draft using only `active` Evidence Claims** — never pending,
   rejected, or superseded ones (schema-enforced, but don't rely on the
   validator to catch what shouldn't have been attempted in the first
   place).
4. **Every structured field gets a `profile_ref`; every generated prose
   field gets `evidence_ids`** — see `MASTER-RESUME-SCHEMA.md` for
   exactly which fields are which. Getting this distinction right here is
   most of what makes step 5 pass cleanly.
5. **Write `resume.draft.yml`**, then run both evaluation checks —
   see `EVAL.md`. Fix and re-run until both pass before showing anything
   to the candidate.
6. **Present the draft and the track's readiness assessment together** —
   never the resume alone if the track is `stretch` or `insufficient`;
   see "Track positioning" below.
7. **Apply candidate edits** — see "Applying candidate edits" below for
   the presentation-vs-factual split.
8. **Re-run both evaluation checks after every edit round**, factual or
   presentational — a presentation change can still accidentally break a
   `profile_ref` match (e.g. reordering that drops a required field).
9. **Promote to `resume.yml` only on the candidate's explicit approval**
   of the actual content — not "looks fine" in passing, an actual yes to
   this specific draft. If an accepted `resume.yml` already exists for
   this track (a rebuild), back it up first — same rollback-protection
   reasoning as the Candidate Profile's own promotion step (see
   `/CONTEXT.md`, Candidate Profile): cheap insurance against this run
   going wrong partway through, not a version-history feature.

## Pending and factual corrections

This skill never writes to `candidate/profile.yml` — that boundary is
deliberate (see Non-goals), not a missing feature. Whenever a pending
claim gets resolved, or the candidate points out something factually
wrong (not "reword this," but "that's not actually true" or "you got a
detail wrong"):

1. **Stop this run.** Don't try to patch around it in the resume draft.
2. **Direct the candidate through `/build-profile`** to reconcile the
   correction into the Candidate Profile (a normal reconciliation run —
   see that skill's Start-of-run).
3. **Once the profile is re-promoted, restart Master Resume Build** from
   the updated profile — don't try to resume mid-draft with stale
   `profile_ref`/`evidence_ids` pointing at claims that may have changed
   identity or status.

This is slower than editing the claim in place would be. It's also the
only way to keep the Candidate Profile as the single source of truth —
letting Master Resume Build quietly patch facts would mean two places
could disagree about what's actually true.

## Applying candidate edits

- **Presentation changes** (reordering, emphasis, phrasing that doesn't
  change what's being claimed, trimming for length) — apply directly to
  the draft, re-run both eval checks (step 8, above).
- **Factual changes** (a number is wrong, a claim overstates or
  understates something, a detail needs correcting) — always the
  "Pending and factual corrections" path above, never a direct edit to
  the draft's prose, even though editing the YAML directly would be
  faster in the moment.

If you're not sure which one a requested edit is, treat it as factual —
the cost of an unnecessary `/build-profile` round-trip is far lower than
the cost of a resume claim silently drifting from what the Candidate
Profile actually supports.

## Track positioning

For a `stretch` or `insufficient` track (see the profile's
`role_tracks[].readiness`): emphasize trajectory and transferable
evidence honestly. Never claim scope, ownership, or seniority the
Evidence Claims don't actually support, no matter how the candidate
wants to be positioned — aspirational framing is allowed, invented scope
is not. Keep the readiness assessment visible to the candidate during
review (step 6), not just something they saw once during Profile Build.

## Guardrails

Same best-effort framing as Profile Build (ADR 0004, `/CONTEXT.md`,
Guardrail) — not a runtime security boundary, a behavioral instruction.
Behave as if holding no pre-granted permissions beyond:

- Reading `candidate/profile.yml`. (Not `candidate/sources/` — unlike
  Profile Build's own grounding eval, this skill's judge batches are
  built from Evidence Claim statements already in the profile, not raw
  source text; there's no need to touch normalized sources here.)
- Writing `candidate/tracks/{track}/resume.draft.yml`,
  `resume.draft.eval.yml`, and the promotion write to
  `candidate/tracks/{track}/resume.yml`.
- Running the specific `@loom/tools` CLIs this skill and `EVAL.md`
  document by name (`master-resume-validate`,
  `master-resume-grounding-batches`, `master-resume-grounding-result`) —
  no other shell command is needed.

This skill reads no untrusted external input directly (no imports, no web
lookups) — its only inputs are the Candidate Profile and the candidate's
own live responses, both already-trusted by the time they reach here.

## Outputs

```text
candidate/tracks/{track}/
  resume.draft.yml           # the working draft
  resume.draft.eval.yml      # combined schema + grounding eval result
  resume.yml                 # the accepted Master Resume, written only on promotion
```

One mutable draft, one accepted resume — persistent numbered version
history is deferred beyond MVP v1 (see `/CONTEXT.md`, Master Resume
Build). A rebuild backs up the previous `resume.yml` before overwriting
it (step 9, above); that backup is rollback protection, not the deferred
version-history feature.
