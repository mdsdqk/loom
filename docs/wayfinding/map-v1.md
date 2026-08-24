# Loom: AI-assisted job search platform

**wayfinder:map**

## Destination

A usable local prototype that builds a grounded Candidate Profile, produces
candidate-accepted Master Resumes for multiple Target Tracks, tailors a resume
to a supplied job description, supports review and editing, and exports PDF.

MVP v1 is for one candidate, multiple tracks, and user-provided JDs. It is
designed so others can use it later, but arbitrary-candidate onboarding is not
the first acceptance bar.

```text
/build-profile
  -> Candidate Profile
  -> /build-master-resume per approved Target Track
  -> accepted Master Resumes
  -> tailor-resume with a supplied JD
  -> review and edit
  -> export PDF
```

Single-user, local-first, and open source. Users bring their agent host, model
access, and provider credentials. No job scraping, matching, application
tracking, or learning system in v1.

## Success criteria

- Profile Build produces a concise profile whose active factual claims trace
  to normalized candidate sources or exact transcript events.
- The candidate can resume an interrupted Profile Build run without losing the
  exact conversation or checkpoint state.
- At least one approved Target Track produces an accepted, grounded Master
  Resume.
- Tailoring reads the complete Candidate Profile plus the selected Master
  Resume and supplied JD.
- Generated and candidate-edited resumes pass schema and grounding evals.
- The candidate can inspect reasoning, edit output, accept a final version,
  and export a usable PDF.
- Development fixtures assert expected tracks, required evidence, forbidden
  unsupported claims, and page budgets without requiring exact model wording.

## Product and architecture notes

- **PRD authority**: `docs/PRD.md` remains the long-term product synthesis.
  This map and its tickets are authoritative for MVP scope.
- **Execution model**: conversational skills handle adaptive candidate-facing
  work. Direct TypeScript scripts handle deterministic orchestration and
  rendering.
- **Portable skills**: canonical instructions live under `.agents/skills/`
  (lowercase — matches Claude Code's own `.claude/skills/` convention).
  Discovery is a thin per-host redirect file, not a symlink — symlinks
  don't survive this repo's git config (`core.symlinks=false`) or work
  reliably for directories on this Windows setup, confirmed by testing.
  Cursor/Codex adapters aren't built yet; don't assume their conventions
  without checking.
- **Storage**: YAML, JSONL, Markdown, HTML, and PDF files on the local
  filesystem. No database or cloud backend.
- **Credentials**: local environment variables only; `.env`, candidate data,
  and opportunity data are gitignored.
- **Legacy candidate data**: a candidate directory predating the
  `imports/`/`sources/` split (loose `resume.md`, a PDF, a LinkedIn export
  folder directly under `candidate/` — this repo's own current state) needs
  a one-off migration script run manually before the first `/build-profile`
  invocation; not handled automatically by the skill.
- **Model routing**: the main skills use the user's selected host model.
  Grounding evals use a separate cheaper available model where the host
  exposes one, falling back to the session's own model otherwise.
- **Cost**: Profile Build ends on checkpoint coverage with per-checkpoint retry
  budgets and a soft overall ceiling, not a hard cutoff.
- **Prompt injection**: v1 resistance is best effort and behaviorally tested.
  It is not a runtime security boundary. Enforced candidate-scoped tools are
  deferred.

## Profile Build

`/build-profile` is a conversational skill. It:

1. Lists user-supplied files under `candidate/imports/`.
2. Normalizes them into immutable candidate-wide source records.
3. Creates exact `transcript.jsonl` events and separate `session.yml`
   checkpoints after every candidate response.
4. Writes a profile draft after each completed section.
5. Captures grouped achievements as atomic Evidence Claims with compact Source
   References, lifecycle, and confirmation.
6. Resolves contradictory sources through HITL; unresolved alternatives remain
   pending and unusable.
7. Captures structured dates, demonstrated and reported skills, preferences,
   constraints, optional future compensation/logistics data, Target Tracks,
   and Track Readiness.
8. Promotes the draft only after blocking schema and grounding evals pass.

Profile state is `in_progress`, `usable_with_gaps`, or `complete`. Only the
latter two feed Master Resume Build.

A single `/build-profile` handles both onboarding and later updates — there
is no separate `/refine-profile`. MVP v1 can resume an incomplete run,
perform onboarding seeded by an existing profile, or start a new run
against an already-usable profile: the existing profile is backed up and
treated as the seed for reconciliation, never refused.

## Evidence and provenance

Every active or pending claim has:

- a stable human-readable ID;
- lifecycle `active`, `pending`, `rejected`, or `superseded`;
- confirmation `implicit`, `soft`, `hard`, or `none`;
- one or more Source References.

Imported candidate-authored claims become active with implicit confirmation
unless sources conflict. Tentative candidate statements need soft
confirmation. Agent estimates remain pending until hard confirmation.

Normal generation reads compact Candidate Profile evidence. Grounding evals
judge bounded claim batches against referenced profile evidence, normalized
source records, and exact transcript events. Eval reports are retained.

## Master Resume Build

`/build-master-resume <track>` is a separate conversational skill. Its inputs
are one usable Candidate Profile, one approved Target Track, general
preferences, and presentation preferences. It receives no JD.

Each factual prose field references active Candidate Profile Evidence Claim
IDs. Pending evidence triggers HITL before drafting. Schema and grounding
evals run before candidate review and again after candidate edits. Explicit
candidate approval promotes the validated draft to
`candidate/tracks/{track}/resume.yml`.

Target Tracks pair role family and level, for example
`application-engineering-senior` and `application-engineering-staff`.
Stretch positioning may emphasize trajectory and
transferable evidence, but cannot claim unsupported scope or seniority. The
default page budget is configurable and initially two pages.

Persistent numbered Master Resume version history is deferred beyond v1.

## Resume tailoring

Ticket 004 remains reopened for its own implementation grilling. Settled input
behavior:

```text
accepted Master Resume
  + complete Candidate Profile read
  + supplied Job Description
  -> grounded tailored resume
```

MVP v1 reads the whole profile. Retrieval indexes and cached profile
projections are deferred. Tailored factual fields retain Evidence Claim IDs,
and schema plus grounding evals run after generation and candidate edits.

## Rendering

The selected pipeline is YAML to Handlebars HTML to Puppeteer PDF. Resume
bullets use the structured object schema from ticket 002. `**text**` means bold;
`~text~` is Loom's custom italic marker. Rendering does not expose evidence IDs
in the visible document.

PDF correctness, portability, ATS extraction, page-overflow checks, fonts, and
HTML sanitization still need a dedicated implementation grilling session.

## Decisions and records

- **[001: Tech stack and local execution](tickets/001-tech-stack-and-deployment.md)**
- **[002: Candidate, profile, resume, and opportunity model](tickets/002-candidate-and-job-data-model.md)**
- **[003: Profile Build](tickets/003-profile-build.md)**
- **[009: Master Resume Build](tickets/009-master-resume-build.md)**
- **[004: Resume tailoring interaction](tickets/004-resume-tailoring-interaction.md)**, reopened
- **[007: Architecture and orchestration](tickets/007-architecture-and-orchestration.md)**
- **[008: Resume rendering](tickets/008-resume-rendering-yaml-to-pdf.md)**
- `/CONTEXT.md`
- `docs/adr/0001-*` through `docs/adr/0005-*`
- `docs/plans/profile-build-implementation.md`

## Still open

- Tailoring interaction, immutable/manual edit behavior, artifact metadata, and
  acceptance lifecycle.
- Exact provider configuration for scripted tailoring.
- Rendering verification and PDF quality criteria.
- Opportunity slug creation and JD import lifecycle.

## Out of scope

- Optimizing a reconciliation `/build-profile` run to narrow itself to just
  what changed instead of re-walking every checkpoint (v2 personalization
  refinement — re-running itself is in scope for v1, this is just about
  how efficient that experience gets).
- Persistent Master Resume version history.
- Source hashing and deduplication.
- Runtime-enforced cross-agent tool isolation.
- Semantic profile retrieval and lookup caching.
- Job discovery, scraping, matching, and triage.
- Application tracking and interview preparation.
- Learning from edits.
- Multi-user service, web UI, and WYSIWYG editor.

## Status

Profile Build product decisions and its implementation plan are approved.
Implementation should start by freezing executable Candidate Profile and Master
Resume schemas plus synthetic fixtures, then build source normalization,
resumable Profile Build, Master Resume Build, and their validators/evals.

Tailoring and rendering still require separate implementation grilling before
the full MVP is planning-complete.
