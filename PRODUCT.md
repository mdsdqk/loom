# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + Hono. The candidate chose this over a Next.js App Router build: a small
client against an explicit local API, leaner and faster to boot than Next at
the cost of maintaining the endpoint layer by hand. The API is a thin transport
over `@loom/tools`; no filesystem logic lives in it.

The repo is a pnpm + Turborepo TypeScript workspace (`pnpm-workspace.yaml`,
`turbo.json`) with `apps/web/` reserved for this application.

## Users

One candidate running their own job search on their own machine, self-hosted
and local-first. They are the only user of their instance. The product is
explicitly multi-candidate in design — nothing about one person's companies,
schools, employers, titles, locations, or paths may be baked into source — but
a running instance serves a single candidate at a time.

The candidate is technical enough to have cloned a repo and run a CLI, and
already drives the rest of Loom through agent skills (`/build-profile`) and
CLIs (`create-opportunity`, `build-resume`, the `network-*` scan tools). The
portal is not their first contact with the system; it is a faster surface over
work they are currently doing through the filesystem and a terminal.

## Product Purpose

Loom maintains a persistent, structured understanding of a candidate —
experiences, projects, skills, evidence, preferences — and uses it to tailor
resumes to specific opportunities. Deterministic code handles predictable work;
AI handles ambiguity, reasoning, interpretation and generation.

This surface is the opportunity portal: the place where the candidate creates
an opportunity and tracks where each one stands. Success is that the candidate
can see the state of every opportunity at a glance and change that state in one
gesture, without opening a YAML file or a terminal.

## Positioning

Loom's mechanism is grounded provenance: every factual claim in a generated
resume traces back to a normalized immutable candidate source or an exact
conversation transcript event, and unconfirmed claims are structurally excluded
from generation. It is local-first and file-backed — the candidate's data never
leaves their machine, and every artifact is a plain file they can read, diff and
version themselves.

A hosted job-tracker cannot truthfully claim either property.

## Operating Context

The filesystem is the database. There is no server, no cloud backend and no
schema migration step.

- `opportunities/<slug>/meta.yml` — one opportunity's metadata. Today it holds
  `company` and `role`; the `create-opportunity` CLI also writes `job_id` and
  `posted_date`. **No status field exists yet.**
- `opportunities/<slug>/artifacts/` — `jd.md`, the tailored `resume.yml`, and
  rendered `resume-*.pdf` files.
- `candidate/` — one candidate's workspace: `profile.yml`, `resume.yml`, per-track
  master resumes, `imports/`, and `network-scan/` outputs.
- `opportunities/*` and `candidate/*` are gitignored. The portal's writes are not
  protected by version control and must not be destructive.

Slugs are `<company>-<title>`, disambiguated by job/requisition ID, then posting
date, then nothing. `tools/src/resume/opportunity.ts` owns that logic and the
directory creation; the portal must call it rather than reimplement it.

Adjacent surfaces already exist and feed this one: the network-scan pipeline
produces ranked `matches.yml` entries (company, title, locations, URL, rank,
referral signals), which are the natural upstream source of new opportunities.

## Capabilities and Constraints

In scope for this build:

- Create an opportunity from a job description plus a chosen master resume,
  reusing `createOpportunity()`.
- Read every opportunity from disk and present them together.
- Record and change an opportunity's status, persisted into `meta.yml`.
- Present the same opportunity set through more than one view. The candidate
  has stated they dislike kanban but wants to compare it against alternatives
  before committing.

Known near-term extensions the structure must not foreclose (explicitly not in
this build): editing a resume as raw YAML, editing a resume through structured
fields, and live resume rendering that updates as those edits are made.

Constraints:

- PRD §26: the system should preserve the history of each application rather
  than reducing it to its current state. Status is therefore history plus a
  derived current value, not a single mutable field.
- CONTEXT.md's distinction between candidate-provided, candidate-confirmed,
  AI-inferred and AI-generated information is described as fundamental to
  trust, and must stay visible wherever the portal shows generated material.
- No candidate-specific values may be hardcoded. Paths under `candidate/` and
  `opportunities/` are resolvable roots, not literals.
- Writes go to gitignored files with no undo from version control.

Undecided product facts: the status vocabulary itself, and whether the portal
also surfaces network-scan matches as pre-opportunity candidates.

## Brand Commitments

The product is named Loom. MIT licensed, open source, single-user and
local-first.

The candidate keeps a TasteVault at `C:/source/taste-vault/references` — 14
references, each with an explicit sentiment and a 1-3 rating. Every reference is
a portfolio surface; none is a dashboard or application UI, so they bind
sensibility rather than layout. The user has named Linear as a comparable
application-UI benchmark.

The strongest binding signal is the negative pole: three references are rejected
solely for having "no character" — plain, mundane, "does the job surely, but
nothing more." The opposite pole is equally bounded: bubbly, artsy, retro and
decorative treatments are also rejected. The target sits between them.

## Evidence on Hand

Real, in-repo, usable as demonstration material:

- Nine opportunities with real `meta.yml`, `jd.md` and `resume.yml` files under
  `opportunities/`.
- `candidate/network-scan/matches.yml` — a real ranked match set with funnel
  counts and preference warnings from a live scan.
- `docs/PRD.md` (1619 lines), `CONTEXT.md`, `docs/wayfinding/map-v1.md`,
  five ADRs.
- `tools/src/resume/schema.ts` — the validated resume shape.

Absences that must not be fabricated: there is no status data anywhere in the
repo, no application history, no interview or recruiter-communication records,
and no outcome data. Any such content in a mockup is synthetic demonstration
material and must be labeled as such.

Mockups must not display the current candidate's real name, employers or
contact details as if they were fixture data; personal data is anonymized before
it appears in committed files.

## Product Principles

1. **The filesystem is the truth.** Every portal action resolves to a readable,
   diffable file. Nothing exists only in the UI.
2. **History over current state.** Status is an append-only record; the current
   value is derived from it.
3. **Generic by construction.** Any candidate's export drops in. No employer,
   school, title, location or path is hardcoded.
4. **Composable pieces, not a pipeline.** Components are independently
   invocable with clean interfaces, because agents will orchestrate them.
5. **Provenance stays visible.** Where the interface shows generated or inferred
   content, it stays distinguishable from what the candidate stated.

## Accessibility & Inclusion

No candidate-specific requirement established. The surface is a
keyboard-driven operator tool for a technical user; full keyboard reachability
and visible focus are treated as baseline, not as a stated user need.
