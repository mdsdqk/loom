# Loom — Glossary

## Profile Build

The onboarding process that produces and maintains the candidate's structured
profile. Deliberately **not** called "interview" — that term is reserved for
job-interview preparation (a distinct, later product surface; see PRD §36).

Profile Build is a conversational agent session (not a scripted CLI prompt
loop) invoked via a command (`/build-profile`). It handles both onboarding
and later updates with the same skill — there is no separate
`/refine-profile`. On any run, it ingests whatever's newly available —
resume, LinkedIn export, any other context dump — and reconciles it against
any existing Candidate Profile rather than re-asking what's already known:
an existing profile is backed up, treated as the seed, walked
checkpoint-by-checkpoint for "still accurate? anything to add?" rather than
started fresh, and a new validated profile is promoted on top of it once
the run's blocking evals pass. After that profile becomes usable, Profile
Build offers to invoke Master Resume Build for each newly-approved Target
Track. How much a reconciliation run can narrow itself to just what
changed (versus re-walking every checkpoint) is a v2 personalization
refinement — v1 can be blunter about it as long as re-running is always
possible.

It must not fabricate facts. Where it estimates something the candidate
didn't state outright (e.g. inferring likely impact from a described
project), that estimate's provenance must remain distinguishable from
something the candidate stated directly.

Implemented as a portable conversational skill (`/build-profile`), not a
scripted CLI prompt loop. Canonical instructions live under
`.agents/skills/` (lowercase — matches Claude Code's own project-skill
convention, `.claude/skills/`); other hosts (Cursor, Codex) may need their
own adapter to discover it, since `.agents/` isn't a convention any of
them recognize on its own — it's this project's shared source of truth,
not something a host scans automatically. The candidate's history is too
varied for fixed questions to work across candidates.

## Candidate Profile

The output of Profile Build (`candidate/profile.yml`). This is **not a
resume** — it is the full nuanced context layer: every fact, story, and
piece of evidence learned about the candidate, including detail too
trivial or specific for any single resume (e.g. a one-off use of a niche
library that happens to match an obscure JD requirement later). It is the
shared source of truth that both Master Resumes and per-opportunity
tailored resumes draw from, restructured to avoid the repetition/bloat
that made the current hand-authored version hard to use as context.

The Candidate Profile stores grouped Evidence Claims rather than repeating
the same fact in summaries, skills, and track descriptions. Claims remain
usable only while active and carry compact Source References plus a
Confirmation tier. Pending, rejected, and superseded claims stay
distinguishable from active career facts. Skills link to evidence instead
of restating it.

A Profile Build run writes exact conversation events and checkpoint state
after every candidate response. It writes a profile draft after each
completed section, but never overwrites the canonical Candidate Profile
while the run is incomplete. Once the draft is usable and passes blocking
evals, an existing `candidate/profile.yml` is backed up before promotion.
That backup is rollback protection, not a user-facing version-history
feature. Abandoned runs are soft-deleted and retained, but cannot feed
generation.

Candidate Profile usability is explicit:

- **in_progress** — resumable, but unavailable to Master Resume Build.
- **usable_with_gaps** — required checkpoints and blocking evals passed;
  unresolved claims remain pending and are excluded from generation.
- **complete** — no known required gap or unresolved conflict remains.

## Master Resume

A per-track, ready-to-use resume (`candidate/tracks/{track}/resume.yml`).
It is the resume the candidate could hand to any recruiter asking for their
resume for that track, with no job-specific tailoring. It reflects the
candidate's real structure, style, and emphasis for that track. It is not
a filtered or reordered view of the Candidate Profile; it is the human-facing
resume itself. It exists only for approved Target Tracks and is produced by
Master Resume Build after Profile Build (see Track Readiness).

Per-opportunity tailored resumes are generated from the Master Resume
*and* the Candidate Profile together: the Master Resume supplies the
candidate's own structure/voice/priorities, while the Candidate Profile
supplies additional nuance and evidence (e.g. the obscure-but-relevant
fact) that the Master Resume alone wouldn't surface.

## Master Resume Build

The conversational skill (`/build-master-resume`) that turns one usable
Candidate Profile, one approved Target Track, and the candidate's
presentation preferences into a Master Resume. It receives no job
description. Profile Build can offer to invoke it after onboarding, but it
also remains independently callable.

Master Resume Build may ask the candidate to confirm relevant pending
evidence before drafting. It never edits `candidate/profile.yml` directly.
When a factual clarification or correction is needed, it stops and directs the
candidate through `/build-profile` reconciliation. The candidate then restarts
Master Resume Build from the newly promoted profile. This avoids bypassing the
Profile Build transaction or depending on cross-skill suspended state. Tone,
ordering, emphasis, and formatting remain presentation choices in the resume.
A draft becomes the track's `resume.yml` only after schema and grounding evals
pass and the candidate explicitly accepts it. Persistent numbered version
history is deferred beyond MVP v1.

## Evidence Claim

An atomic, independently usable career fact inside a grouped evidence item
in the Candidate Profile. For example, building a platform, adoption by
several teams, and a measured improvement are separate claims even when they
describe one achievement.

Every active or pending claim has a stable human-readable ID and at least
one Source Reference. Its lifecycle is one of `active`, `pending`,
`rejected`, or `superseded`. Master Resume factual fields refer to Evidence
Claim IDs so grounding can be checked without repeating provenance.

## Source Reference

A compact link from an Evidence Claim to a normalized immutable candidate
source record or an exact transcript event. It identifies where the fact
came from without embedding the full source excerpt in normal generation
context. Original imports and normalized sources remain separate from the
Candidate Profile.

Source References are run-qualified and follow one of these forms:

- `source:{run-id}:{source-id}#{record-id}`
- `transcript:{run-id}#{event-id}`

The run qualifier prevents references from different Profile Build runs from
colliding.

## Candidate Source

An immutable normalized record derived from a candidate-controlled import,
such as a resume section or LinkedIn CSV row. Candidate Sources live under
`candidate/sources/` and have IDs qualified by the ingestion run. V1 may store
duplicate normalized records across runs rather than hashing or deduplicating
them. Clarification changes Candidate Profile claims; it never rewrites the
original import or its normalized source record.

## Exact Transcript

The append-only JSONL record of the exact agent and candidate messages in one
Profile Build run. Each event has a stable ID so Evidence Claims and evals can
refer to what the candidate actually said rather than an agent summary.

## Session Checkpoint

The resumable `session.yml` snapshot updated after every candidate response.
It records run status, current section, completed sections, pending questions,
conflicts, gaps, and the latest transcript event. It is distinct from a
section checkpoint, which decides when a profile section has enough coverage.

## Profile Draft

The run-scoped Candidate Profile written after each completed section and
before final evaluation. A Profile Draft never replaces
`candidate/profile.yml` until it is usable and passes blocking evals.

## Structured Date

A machine-readable start and end value with explicit year or month precision,
plus a current-role marker where needed. Display strings belong to rendering,
not the canonical career timeline.

## Confirmation tiers

Confirmation is separate from a claim's lifecycle. The supported tiers are:

- **Implicit confirmation** — an unambiguous claim in a candidate-authored
  resume, LinkedIn export, or direct candidate answer. Imported claims are
  accepted this way unless sources contradict each other.
- **Soft confirmation** — a tentative candidate statement that the
  candidate subsequently affirms with a quick confirmation.
- **Hard confirmation** — an agent-proposed estimate that the candidate
  explicitly approves.
- **No confirmation** — a pending claim that cannot be used in generation.

Confirmation does not erase history. Rejected and superseded claims retain
their Source References so later runs can understand what changed.

## Eval

An automated or semi-automated check of an AI-generated output's quality
or correctness against defined criteria — distinct from a unit test, which
checks deterministic code. Applies wherever this project has an AI-driven
step with little or no surrounding code to unit-test (Profile Build,
resume tailoring): the eval *is* the test suite for that step.

Evals carry a severity tier that determines what happens on failure — this
tiering is a standing convention for any AI-driven step in this project,
not specific to Profile Build:
- **Blocking**: grounding/fabrication failures (an unsourced or
  semantically strengthened claim) and schema violations. The step cannot
  complete until fixed.
- **Flagged, non-blocking**: softer quality issues. Surfaced to the
  candidate (e.g. in the interview transcript) but don't stop completion.

Grounding evals run separately for the Candidate Profile and each Master
Resume. They judge bounded batches of claims against referenced profile
evidence, normalized sources, and relevant exact transcript events. Eval
reports are retained beside the artifact they evaluated.

## Guardrail

A constraint on an AI-driven step's *process*, not its output — what the
agent should do while it runs (tool scope, what it treats as untrusted
input, what requires confirmation before acting). Distinct from an Eval,
which judges what came out.

For MVP v1, Profile Build's prompt-injection guardrail is explicitly
best-effort: ingested content is treated as data, `SKILL.md` instructs the
agent to behave as if it holds no pre-granted permissions and to confirm
before any tool use beyond its documented minimal set (regardless of a
host's actual permission config), and adversarial fixtures test model
behavior. This is a behavioral instruction, not an enforced restriction —
a skill has no mechanism to actually rewrite a host's granted permissions.
Genuine enforcement would mean running Profile Build as a tool-scoped
subagent instead of an in-session skill, which is deferred (it would
reopen ADR 0001's "conversational skill" framing for a property this
project already treats as best-effort throughout v1).

## Target Track

A reusable pairing of role family and level, such as
`application-engineering-senior` or `application-engineering-staff`, with
target titles and positioning. Family alone is too
broad because readiness and resume emphasis differ by level. The Target
Track ID is also its stable directory slug under `candidate/tracks/`.

## Track Readiness

Profile Build's assessment of whether a candidate's evidence supports a
Target Track they've named. Expressed as a qualitative tier plus
narrative reasoning (never a bare score) — e.g. "stretch: missing
cross-team scope evidence" — and calibrated against a bar appropriate to
the candidate's actual domain and company scale (a B2B enterprise
engineer isn't graded against FAANG-scale throughput expectations). The
agent establishes that domain/scale context itself first — from resume
and LinkedIn signals, plus a web lookup on the candidate's employers/
products where useful — then soft-confirms its read with the candidate
rather than asking a generic "tell me about your company" question.

When Track Readiness comes back below the target (a stretch or
insufficient tier), Profile Build still offers to build that track's
Master Resume — but only after the candidate separately acknowledges the
assessment and approves construction. Aspirational emphasis is allowed;
unsupported scope or seniority is not.
