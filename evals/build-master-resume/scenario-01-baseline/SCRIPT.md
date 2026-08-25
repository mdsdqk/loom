# Scenario 01 (baseline) — conversation script

Run `/build-master-resume application-engineering-senior` with this
scenario's `candidate/profile.yml` in place of the real
`candidate/profile.yml` (see this scenario's `README.md` for setup). This
scenario's whole point is testing the boundary between Master Resume
Build and Profile Build — the two points below are what actually exercise
it; everything else, respond naturally.

## 1. Pending evidence confirmation → stop and redirect (not a direct edit)

The profile has one `pending` claim
(`examplecorp-platform-impact-unconfirmed`, an agent-estimated "~70%
setup time reduction" the candidate never actually confirmed during
Profile Build). Per `SKILL.md` step 2, Master Resume Build should surface
this before drafting and ask whether to confirm or reject it.

Respond:

> "Yeah, that sounds about right — let's include it."

**Expected**: this is a **factual** confirmation, not a presentation
choice. Per `SKILL.md`, "Pending and factual corrections," Master Resume
Build must **stop this run** and direct you through `/build-profile`
reconciliation rather than folding the confirmation directly into the
draft — it never writes to `candidate/profile.yml` itself. If the run
instead just marks the claim active and drafts with it directly, that's
a failure of this scenario regardless of anything else that happens.

*(For a from-scratch run of this scenario without actually invoking
`/build-profile` partway through, treat declining the confirmation as the
practical path instead — "no, leave that one out" — and continue to point
2 with a draft built from only the two active claims. Either path is
valid for exercising this scenario; the confirm-then-redirect path is the
one that specifically tests the stop-and-redirect behavior, so prefer it
if you can complete the full round trip.)*

## 2. A factual edit after the draft exists → stop and redirect again

Once a draft exists (built from `examplecorp-platform-built` and
`examplecorp-platform-adoption`, the two `active` claims — never the
pending one, regardless of how point 1 went), ask for a factual
correction:

> "Actually, I want to correct something — the platform was adopted by
> most teams, not literally every team. Can you fix that?"

**Expected**: same rule as point 1, from a different entry point — this
is a factual change to an existing draft, not a wording/presentation
tweak, so it goes through the same stop-and-redirect path, not a direct
edit to the draft's prose (`SKILL.md`, "Applying candidate edits" —
"if you're not sure which one a requested edit is, treat it as factual").

## 3. A genuine presentation-only edit, for contrast

Also try a real presentation change, to confirm the skill doesn't
over-apply the stop-and-redirect rule to things that don't need it:

> "Can you move the platform-adoption point before the platform-built
> point?"

**Expected**: applied directly to the draft, no stop-and-redirect, both
evaluation checks re-run afterward.

## Ending the session

Once these are covered, accept the draft explicitly and let promotion
happen normally. Compare the result against `expected-outcomes.yml`.
