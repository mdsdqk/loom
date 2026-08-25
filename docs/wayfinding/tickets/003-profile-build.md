---
id: "003"
title: "Profile Build: Onboarding and Candidate Profile"
type: "grilling"
status: "resolved"
assignee: null
blocked_by: ["002"]
blocking: ["009"]
---

## Question

Design the onboarding flow that turns the candidate's existing career material
into a concise, grounded Candidate Profile that can support multiple Target
Tracks and later job-specific tailoring.

## Resolution

**RESOLVED (2026-08-24)**. The product and implementation decisions have been
grilled in full. `/CONTEXT.md` is the authoritative glossary,
`docs/adr/0001-*` through `docs/adr/0005-*` record the significant decisions,
and `docs/plans/profile-build-implementation.md` is the approved technical
execution plan.

Profile Build remains in MVP v1 because omitting it would force every tailoring
run to reconstruct the candidate's career context. It is optimized first for
one candidate with multiple Target Tracks and supplied job descriptions. The
schema and workflow may become reusable later, but arbitrary-candidate
onboarding is not the v1 acceptance bar.

### Commands and skill boundary

`/build-profile` is a portable conversational agent skill, not a scripted CLI
questionnaire. Its canonical instructions live under
`.agents/skills/build-profile/`.

Profile Build produces a usable Candidate Profile. It then asks whether to
invoke the separate `/build-master-resume` skill for each approved Target
Track. Master Resume Build is independently callable and receives no job
description.

Updating an already-usable Candidate Profile is not a separate skill —
`/build-profile` handles it directly. MVP v1 can resume an incomplete run,
perform first-run onboarding seeded by an existing profile, or start a new
run against an already `usable_with_gaps`/`complete` profile: that existing
profile is backed up, treated as the seed, and walked checkpoint-by-
checkpoint for what's changed or missing rather than re-asked from
scratch. A second `/build-profile` run is never refused. (An earlier draft
of this ticket split this into a separate deferred `/refine-profile`
skill; that split added a second skill for candidates and implementers to
remember for no real benefit, and — more importantly — left no supported
way to update a profile at all for the entire v1 lifetime, which doesn't
hold up for a candidate actively job-searching over weeks. Removed.)

### Inputs and sources

User-supplied inputs live under `candidate/imports/`. At run start, Profile
Build lists the discovered filenames and tells the candidate that files added
later require a new run. Supported v1 inputs include Markdown or PDF resumes,
relevant LinkedIn CSV exports, a seeded profile, and other readable context
dumps.

Inputs are normalized into immutable candidate-wide records under
`candidate/sources/`. Candidate Profile claims retain compact Source References
to those records or to exact transcript events. Full excerpts and provenance
data are not copied into normal generation context.

References are qualified by the ingestion run:

```text
source:{run-id}:{source-id}#{record-id}
transcript:{run-id}#{event-id}
```

Each run creates new immutable normalized records, even when an import appeared
in an earlier run. V1 does not hash or deduplicate them.

When employer domain or scale remains ambiguous, Profile Build may perform a
web lookup. Lookup results inform Track Readiness context only, never candidate
career evidence. URLs and compact summaries remain in the run log.

### Run and checkpoint model

Every run has a stable ID and stores:

```text
candidate/profile-build/runs/{run-id}/
  session.yml
  transcript.jsonl
  profile.draft.yml
  profile.eval.yml
```

After every candidate response, the skill appends the exact candidate and
agent messages to `transcript.jsonl` and updates `session.yml`. It writes the
profile draft after each completed profile section and before final
evaluation. It never writes an incomplete draft over `candidate/profile.yml`.

When an incomplete run exists, the candidate may resume it or abandon it and
start again. Abandonment soft-deletes the run by marking it `abandoned`; its
files remain available for history but cannot feed generation. New or changed
imports are not absorbed automatically into a paused run.

### Profile construction

Profile Build works through candidate-specific checkpoints rather than a fixed
question script:

1. Identity, contact, education, and structured career timeline.
2. Each material employer and role, with structured year or month dates.
3. Grouped achievements containing atomic Evidence Claims.
4. Demonstrated and reported skills.
5. Preferences, constraints, compensation, and logistics. Compensation and
   logistics are optional future-facing matching data and do not block v1.
6. Target Track selection, where each track pairs a role family and level.
7. Track Readiness for each approved track.
8. Narrative and presentation preferences.

Deterministic rules identify structural gaps such as missing required fields,
invalid dates, dangling evidence references, and unusable claim references.
AI judgment flags weak evidence, vague scope, and useful follow-up questions.
Missing metrics are prompts for improvement, not blocking invariants.

### Evidence, confirmation, and conflict resolution

Related achievements stay grouped for readability, but independently usable
facts are atomic Evidence Claims. Every active or pending claim has a stable
human-readable ID and at least one Source Reference.

Claim lifecycle:

- `active`: usable in generation.
- `pending`: retained but excluded until clarified.
- `rejected`: denied by the candidate.
- `superseded`: replaced by a clarified claim.

Confirmation:

- `implicit`: unambiguous candidate-authored import or direct answer.
- `soft`: tentative candidate statement subsequently affirmed.
- `hard`: agent-proposed estimate explicitly approved.
- `none`: pending and unusable.

Imported claims become active with implicit confirmation unless sources
contradict each other. Contradictory assertions remain pending and trigger
HITL clarification. Clarification activates the resolved claim and rejects or
supersedes the alternatives. Original imports remain immutable.

### Target Tracks and readiness

A Target Track pairs role family and level, for example
`application-engineering-senior` or `application-engineering-staff`. Its
stable ID is also its directory slug. Track Readiness is recorded separately
for each Target Track as `strong`, `stretch`, or `insufficient`, with
narrative reasoning, gaps, and supporting Evidence Claim IDs.

The candidate separately acknowledges the readiness assessment and approves
whether to build the track. A weak-readiness track may use aspirational
emphasis, but never unsupported scope or seniority.

### Profile usability and promotion

Profile state is one of:

- `in_progress`: resumable, unavailable to Master Resume Build.
- `usable_with_gaps`: required checkpoints and blocking evals pass; pending
  claims remain excluded.
- `complete`: no known required gap or unresolved conflict remains.

Master Resume Build accepts `usable_with_gaps` and `complete`, never
`in_progress`. Before promotion, the profile draft must pass deterministic
schema validation and the separate grounding eval. If a canonical profile
already exists, it is backed up before the validated draft replaces it.

### Evals

Schema validation is deterministic and blocking. It checks required fields,
structured dates, unique IDs, valid lifecycle and confirmation combinations,
resolvable Source References, skill evidence links, Target Track state, and
profile usability.

The grounding eval is judgment-based, blocking, and runs in a separate agent
invocation on a cheaper available model. It evaluates bounded claim batches
against referenced normalized sources and exact transcript events. Each claim
receives a structured `supported`, `unsupported`, `ambiguous`, or
`contradicted` verdict.

A non-supported verdict triggers removal or HITL clarification, an upstream
profile update, and re-evaluation. Softer writing-quality findings remain
flagged and non-blocking. The structured eval report is retained beside the
profile draft.

### Guardrails

MVP v1 prompt-injection resistance is explicitly best effort, not a runtime
security boundary. Skill instructions treat imported and web content as
data, instruct the agent to behave as if it holds no pre-granted
permissions and confirm before any tool use beyond its documented minimal
set, and adversarial fixtures test behavioral resistance. This is a
behavioral instruction, not something a skill can actually enforce on its
host. Runtime-enforced candidate-scoped tools (which would mean running
Profile Build as a tool-scoped subagent rather than an in-session skill)
are deferred. See ADR 0004.

### Outputs

- Validated `candidate/profile.yml`.
- Candidate-wide normalized sources under `candidate/sources/`.
- Resumable run state, exact transcript, draft, and eval report.
- Approved Target Tracks ready for `/build-master-resume`.

Master Resumes are outputs of the separate Master Resume Build skill, not
direct Profile Build artifacts.
