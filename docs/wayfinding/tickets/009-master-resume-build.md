---
id: "009"
title: "Master Resume Build: Per-Track Draft, Eval, Review, and Acceptance"
type: "grilling"
status: "resolved"
assignee: null
blocked_by: ["002", "003"]
blocking: ["004"]
---

## Question

Define how one usable Candidate Profile becomes a ready-to-use Master Resume
for one approved Target Track without job-specific tailoring.

## Resolution

`/build-master-resume <track>` is a separate portable conversational skill.
Profile Build offers to invoke it after onboarding, but it remains
independently callable so one track can be rebuilt without repeating the
profile interview.

### Inputs

- Candidate Profile with status `usable_with_gaps` or `complete`.
- One approved Target Track.
- General preferences.
- Presentation preferences.

It receives no job description.

### Process

1. Validate profile usability, Target Track acknowledgement, and build
   approval.
2. Identify materially relevant pending evidence. Pause for HITL confirmation
   or rejection before drafting, and update the Candidate Profile first.
3. Generate a track-specific draft using only active Evidence Claims.
4. Attach Evidence Claim IDs to every factual prose field.
5. Run deterministic schema/reference validation.
6. Run a separate grounding eval on a cheaper available model.
7. Present the draft and any readiness warning to the candidate.
8. Apply candidate edits. Factual corrections update the Candidate Profile;
   presentation changes remain in the resume.
9. Re-run schema and grounding evals.
10. Promote the draft only after explicit candidate approval.

### Track positioning

Target Tracks pair role family and level, such as
`application-engineering-senior` and `application-engineering-staff`.
`stretch` or `insufficient` tracks may emphasize trajectory and transferable
evidence, but cannot claim unsupported scope, ownership, or seniority. The
readiness warning remains visible during review.

### Artifacts

```text
candidate/tracks/{track}/
  resume.draft.yml
  resume.draft.eval.yml
  resume.yml
```

MVP v1 keeps one mutable draft and one accepted Master Resume. Persistent
numbered version history is deferred beyond v1.

### Acceptance gate

Promotion to `resume.yml` requires:

- schema validation passes;
- grounding eval passes;
- every factual prose field references active Candidate Profile evidence;
- no pending, rejected, or superseded claim is used;
- Track Readiness was acknowledged;
- the candidate explicitly approves the content.

The default page budget is configurable and initially two pages. Actual PDF
fit remains ticket 008's responsibility.

### Evals

The judge evaluates bounded factual-field batches against referenced Candidate
Profile claims, normalized source records, and relevant transcript events. A
candidate edit triggers another eval. Eval reports are retained beside the
draft.

See `docs/plans/profile-build-implementation.md` for the shared implementation
sequence and executable schema work.
