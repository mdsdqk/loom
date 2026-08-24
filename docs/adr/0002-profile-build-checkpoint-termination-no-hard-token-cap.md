---
status: accepted
---

# Profile Build ends on checkpoint-based gap coverage, not a hard token/turn cap

Profile Build is an open-ended conversational session, which raises an
obvious cost/runaway risk: nothing stops it from going in circles and
burning the candidate's tokens and subscription budget indefinitely.

The natural-seeming fix — a hard token or turn cap — was considered and
rejected. A hard cap would cut off a candidate with a genuinely long, rich
career history at the same point as one with a short, thin one, which
contradicts the actual goal (rich, evidence-backed context, not a
time-boxed form).

**Decision**: Termination is checkpoint-based instead. Profile Build is
structured as checkpoints per profile section (each role/employer, skills,
target-track fit, etc.). Each checkpoint gets a small retry budget — a few
different angles to extract something useful before that thread is judged
dry and the agent moves on. The overall session has a soft total-turn
ceiling. As it is approached, the agent wraps up gracefully, persists the
remaining gaps, and marks the draft `usable_with_gaps` when all blocking
requirements pass. It does not cut off mid-question. There is no hard cap
that kills the session outright; the candidate can always end early.

The run is resumable. After every candidate response, the skill appends the
exact exchange to `transcript.jsonl` and updates a separate `session.yml`
checkpoint snapshot. It writes `profile.draft.yml` after each completed
profile section and before final evaluation, not after every conversational
turn. An incomplete run never overwrites the canonical Candidate Profile.

When an incomplete run exists, the candidate may resume it or abandon it
and start again. Abandonment is a soft delete: the run is retained with an
`abandoned` status but cannot feed generation. Inputs are normalized at run
start; newly added imports require a new run rather than changing the
grounding corpus underneath a paused session.

**Consequence**: session cost is bounded by structure (checkpoints +
retry budgets + a soft ceiling), not by a single hard number. If this
turns out to be an insufficient guardrail in practice (sessions running
unexpectedly long or expensive), that's a signal to revisit this decision,
not to silently add a hard cap underneath it.
