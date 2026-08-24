---
status: accepted
---

# Profile Build's grounding eval runs as a separate, cheaper-model subagent

Profile Build and Master Resume Build rely on model judgment, so a
grounding eval is the main defense against violating PRD principle 4.2
("must not fabricate"). The obvious-seeming approach, having the producing
agent check itself, was considered and rejected. A model checking its own
work has no fresh eyes and would run a bounded verification task on the
same expensive model used for generation.

**Decision**: grounding evals run as separate agent invocations on a
cheaper available model than the producer, where the host exposes one; if
no cheaper model is configured, fall back to the same model already
running the session rather than skipping the eval or failing outright —
the separate-invocation "fresh eyes" property is the part that matters
most, the cost saving is a bonus when available. Candidate Profile and
each Master Resume are evaluated separately.

Deterministic validation first checks that each factual output field has
active Evidence Claim references. The judge then evaluates bounded claim
batches against the referenced Candidate Profile evidence, normalized
immutable source records, and relevant exact transcript events. It returns
a structured verdict for each claim: `supported`, `unsupported`,
`ambiguous`, or `contradicted`.

This design gives the judge the actual source corpus rather than only a
producer-written transcript summary, while avoiding one oversized prompt.
It follows the project's cost philosophy (PRD §30: use the least expensive
intelligence that produces an acceptable result).

A non-supported verdict is blocking (see Eval severity tiers in
`/CONTEXT.md`). Unsupported output is removed or grounded through a new
candidate clarification that updates the Candidate Profile first.
Ambiguous or contradicted claims go through the same HITL resolution path.
The artifact is then regenerated or edited and evaluated again.

Structured eval reports are retained beside the evaluated profile draft or
Master Resume draft. Candidate edits to a Master Resume trigger another
schema and grounding eval before acceptance.
