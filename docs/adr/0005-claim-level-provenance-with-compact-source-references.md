---
status: accepted
---

# Candidate evidence uses claim-level provenance with compact source references

The Candidate Profile must remain concise enough for full-context use in MVP
v1, but Profile and Master Resume grounding must still prove that factual
claims came from candidate-controlled sources. Copying full source excerpts
beside every fact would recreate the repetition and context bloat that Profile
Build is intended to remove. Tracking provenance only for metrics would leave
ordinary claims about ownership, scope, adoption, and responsibilities
unchecked.

**Decision**: the Candidate Profile groups related evidence for readability,
but stores independently usable facts as atomic Evidence Claims. Every active
or pending claim has:

- a stable human-readable ID;
- lifecycle status: `active`, `pending`, `rejected`, or `superseded`;
- confirmation: `implicit`, `soft`, `hard`, or `none`;
- one or more compact Source References.

Original candidate imports are normalized into immutable candidate-wide source
records. Exact conversation messages are stored as stable transcript events.
Source References point to those records or events without embedding full
excerpts in the Candidate Profile. References are run-qualified:

- `source:{run-id}:{source-id}#{record-id}`
- `transcript:{run-id}#{event-id}`

Run qualification prevents event and source IDs from colliding when
`/build-profile` reconciles an existing profile in a later run. V1 may retain
duplicate normalized records across runs instead of hashing or deduplicating
them.

Candidate-authored imports and unambiguous direct answers become active with
implicit confirmation unless sources contradict each other. Tentative
candidate statements require soft confirmation. Agent-proposed estimates
remain pending until hard confirmation. Contradictory assertions remain
unusable until HITL clarification activates one claim and rejects or
supersedes the others.

Generated prose in a Master Resume references one or more active Evidence
Claim IDs. Structured fields copied without rewriting, such as identity,
company, role, dates, education, and demonstrated skills, carry stable
`profile_ref` pointers and must exactly match the referenced Candidate Profile
record. Generation may combine or reframe evidence, but cannot strengthen
ownership, causality, magnitude, organizational scope, adoption, recency, or
certainty. Schema validation rejects missing, unusable, or mismatched
references before the model-based grounding eval runs.

This keeps normal generation context compact. The Candidate Profile contains
canonical evidence plus short references; the grounding judge receives only
the referenced evidence, normalized source records, and relevant transcript
events for each bounded claim batch.
