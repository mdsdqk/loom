# Opportunity Portal — implementation plan

## Scope

A local web interface over the existing `opportunities/` filesystem structure.
Two capabilities in this build:

1. Create an opportunity.
2. Read and change an opportunity's status.

Everything else the portal will eventually carry — YAML resume editing,
structured resume editing, live resume rendering — is out of scope here but
constrains the structure, so this plan states where those attach.

## What already exists

`tools/src/resume/opportunity.ts` owns opportunity creation:
`createOpportunity()` resolves company and title from the JD (or explicit
overrides), extracts a job ID and posting date, builds the slug, creates
`opportunities/<slug>/artifacts/`, copies in `jd.md` and the master
`resume.yml`, and writes `meta.yml`. It refuses to overwrite an existing
directory. `buildSlug()`, `extractCompanyAndTitle()`, `extractJobId()`,
`extractPostingDate()` and `normalizeDate()` are exported and unit-tested.

The portal calls this module. It does not reimplement slugging or JD parsing.

`meta.yml` currently holds `company`, `role`, and optionally `job_id` and
`posted_date`. There is no status field anywhere in the repo.

## Data model

### Status is history, not a field

PRD §26 requires that the system preserve the history of each application
rather than reducing it to its current state. Status is therefore an
append-only event list, with the current value derived from its last entry and
cached alongside it so CLI consumers can read one key.

```yaml
company: Northwind Systems
role: Senior Frontend Engineer
job_id: R-2291
posted_date: 2026-08-14
source: network-scan          # network-scan | manual | referral
url: https://example.com/jobs/R-2291

status: applied               # derived cache, equals the last history entry
history:
  - at: 2026-08-15T09:12:00Z
    status: scouted
    note: network-scan match, rank 0.71
  - at: 2026-08-16T18:40:00Z
    status: drafting
  - at: 2026-08-18T07:05:00Z
    status: applied
    note: submitted via Greenhouse
```

Writes recompute `status` from `history`. A validator asserts the two agree;
a `meta.yml` where they disagree is a repair case, not a crash.

Backward compatibility: a `meta.yml` with no `history` is valid. It reads as a
single synthetic `scouted` event dated from the directory's mtime, and the
first real status change materializes the list. No migration step runs on its
own.

### Status vocabulary

Seven states, ordered. The order is meaningful — it is the pipeline — and the
views depend on it.

| Status | Meaning |
|---|---|
| `scouted` | Known, not yet worked. Where network-scan matches land. |
| `drafting` | Tailoring materials. |
| `applied` | Submitted. |
| `screening` | Recruiter or HR contact. |
| `interviewing` | In a loop. |
| `offer` | Offer in hand. |
| `closed` | Terminal. Carries an outcome. |

`closed` events carry `outcome: rejected | withdrawn | expired | accepted`.
Splitting outcome from status keeps the pipeline linear while preserving why
something ended — a distinction a flat status enum loses.

The vocabulary lives in one module and is exported. It is not duplicated per
view, and it is not hardcoded in the UI.

### Interview rounds

`screening` and `interviewing` are loops, not points: the number of rounds
varies per company and is not known in advance. Each round is its own history
entry at the same status, carrying a 1-based `round` the store assigns by
counting prior passes, plus an optional `label` for what the round was.

```yaml
  - at: 2026-08-22T09:00:00Z
    status: interviewing
    round: 1
    label: phone screen
  - at: 2026-08-29T09:00:00Z
    status: interviewing
    round: 2
    label: system design
  - at: 2026-09-05T09:00:00Z
    status: interviewing
    round: 3
    label: hiring manager
```

The two loops are counted independently, so a take-home during screening does
not advance the interview round. Leaving and re-entering a loop continues its
numbering rather than restarting it.

The register shows this three ways: `INTERVIEWING R3` with one pip per round in
the row, a staircase inside the `interviewing` band on the trace (each round
climbs a fraction of its own band and never reaches the next status's level),
and the full round list with dates and labels in the expanded row.

### Scheduling, backdating and editing

An entry carries a `state`, and the distinction that matters day to day is not
"has it happened" but "is anyone waiting on me":

| State | Meaning | Whose move |
|---|---|---|
| `recorded` | It happened. | — |
| `scheduled` | Booked; nothing is required from the candidate until it arrives. | Theirs |
| `pending` | Work the candidate owes against a deadline — an assessment, a take-home. | **Yours** |

Both advance the status. Booking an interview is the company moving the
candidate to the interview stage, so an opportunity with an assessment set reads
`interviewing`, not `screening`. The status is the furthest stage any entry has
reached, which also keeps it from going backwards when a follow-up call is
booked mid-loop. `closed` is last in the pipeline, so a closed opportunity stays
closed whatever is still on the calendar.

A stage that has not happened yet is marked with `*` in the register, and the
badge beside it says whether it is scheduled or pending.

Booking is movement, so it restarts the idle clock. An opportunity whose newest
entry is a booking made three weeks ago has still gone quiet, and the threshold
catches that without a special case.

`pending` sorts first, takes the accent colour, and drives a filter, because it
is the only one that is actionable today.

```yaml
  - at: 2026-09-09T10:00:00Z     # when it was put on the calendar
    status: interviewing
    state: scheduled
    round: 2
    eta: within 72 hrs           # freeform, deliberately unvalidated
    label: functional assessment - coding round
```

`eta` is a string with no validation because the real ones do not fit a date
picker: "within 72 hrs", "Thu 14:00 IST", "TBD, likely the week after". On a
`scheduled` entry it reads as an expectation, on a `pending` one as a deadline.
Marking it done flips `state` to `recorded`, replaces `at` with when it actually
happened, and drops the `eta`.

Any entry can be backdated, and any entry can be edited in place. Editing is a
deliberate exception to append-only: entries get typed in after the fact, and a
wrong date should be fixable without leaving a correction event that reads like
a real status change. Anything edited gains `revised_at`, so a corrected entry
never silently poses as an original observation.

Because both backdating and editing can move an entry in time, history is
re-sorted on every write and **round numbers are recomputed from chronological
order** — a round is an ordinal position in time, not the order things were
typed in.

`tools/test/opportunity/fixtures/scheduled-round.meta.yml` is a stub of an
application mid-loop with two rounds booked, used by the tests.

### Configuration

`loom.config.yml` at the repo root, all keys optional:

```yaml
stall_threshold_days: 14
stall_threshold_days_by_status:
  interviewing: 7
never_stall: [offer, closed]
```

A missing file means defaults. A file that exists but does not parse is an
error rather than a silent fallback. An unknown status key in the override map
is ignored.

## Architecture

```
tools/src/opportunity/
  schema.ts      Zod schema for meta.yml, status enum, outcome enum
  store.ts       list / read / write / appendStatus over a resolvable root
  index.ts       re-exports; createOpportunity stays in resume/opportunity.ts

apps/web/
  server/       Hono API — thin transport, no filesystem logic of its own
  src/          Vite client
  reads and writes only through @loom/tools
```

The store is a library, not an endpoint. The web app, the existing CLIs and a
future MCP server all call the same functions. This follows the platform's
standing shape: composable pieces with clean interfaces, since agents will
orchestrate them.

Roots are resolved, never literal. `opportunitiesRoot` and `candidateRoot` are
parameters with defaults, exactly as `createOpportunity()` already takes
`opportunitiesRoot`.

### Writes

Writes are to gitignored files with no version-control undo, so:

- Write to a temp file in the same directory, then rename. No partial `meta.yml`.
- Preserve unknown top-level keys on write. The portal must not silently drop a
  field some other tool added.
- `appendStatus` appends; it never rewrites or deletes a history entry. Undo is
  a new event, not an erasure.

### Where the deferred work attaches

- **YAML resume editing** — a text surface over `artifacts/resume.yml`,
  validated by the existing `validateResume()` in `tools/src/resume/schema.ts`.
- **Structured resume editing** — a form over the same Zod schema; both editors
  write the same file and must reconcile.
- **Live rendering** — `tools/src/resume/renderer.ts` already renders via
  Nunjucks. A preview pane re-renders on change.

This is why the opportunity detail route is a shell with panes from the start,
rather than a status-editing dialog.

## Views

One data set, three structures. The visual system is fixed across all three;
only the structure differs, so choosing between them is a choice about
structure and not about art direction.

### Register — ruled rows

One row per opportunity on hairline rules, every column left-aligned off the
same edge. Company and role, current status with whatever is outstanding beside
it, the stage journey, time since the last thing that actually happened, and
which artifacts exist.

An earlier version carried a seven-cell pipeline track and a per-row time-scaled
pen trace. Both were unreadable against real data — every event falls inside a
few days of an 84-day window, so every trace collapsed into an identical squiggle
at the right edge. The register now reads as words: `applied → screening →
interviewing ×2`. Consecutive passes through one status collapse into a count.

Rows the candidate owes work on sort to the top.

### Board — columns by status

Kanban. Columns are the seven statuses; each card is an opportunity. Honest
about its costs: it hides how long something has been sitting, and it stops
being readable somewhere around forty items.

Included because it was asked for as a comparison, not because it is
recommended.

### Chart — time axis

One row per opportunity against a shared time axis, each drawn as a stepped
trace through its statuses. Events are ticks. A long flat run at the right edge
is a stalled application, which is the one question neither other view answers
directly.

## Visual direction

The interface is a chart recorder: a continuous, append-only instrument record
on a dark ground.

The fit is structural rather than decorative. A recorder's paper cannot be
rewritten — the pen has already passed — which is the same property PRD §26
asks of application history. Status therefore reads as a position along a
trace rather than as a colored pill, which is also the ATS-dashboard cliché
this avoids.

**Status is a mark, not a hue.** One ink carries the whole interface. Only two
colors mean anything, and both are reserved:

- `#D2612F` oxide — attention, stalled, adverse outcome
- `#4FA97E` green — favourable outcome

Validated together against the `#0E1113` ground: lightness band, chroma floor,
CVD separation, normal-vision floor and contrast all pass at two slots. Both
always ship with a label, never as color alone.

The oxide is also the recorder's printed grid — the same pigment at low alpha
rules the background, so the accent and the substrate share one hue.

## Open decisions

Whether network-scan matches appear in the portal as pre-opportunity rows, or
stay in `matches.yml` until promoted. Deferred; `source: network-scan` in the
schema keeps the door open.

## Decided

**Register ships first.** Ruled rows carrying company, a seven-cell position
track, the full status history on a shared axis, days idle, and which artifacts
exist. It scales, and its trace column delivers most of the chart view's value
without building a second surface. The chart remains the natural second view
over the same store; the board is not planned.

**Vite + Hono.** A small client against an explicit local API. The Hono layer
is transport only — every read and write goes through `@loom/tools`, so the
CLIs, the portal and a future MCP server share one implementation.

## Build state

Built and verified:

1. `tools/src/opportunity/` — `schema.ts`, `config.ts`, `config-file.ts`,
   `derive.ts`, `store.ts`, with 26 tests.
2. Hono routes over the store: config, list, read, append-status, create,
   master-resumes.
3. Register view rendering real data from `opportunities/`.
4. Status change through `appendStatus`, including round and outcome.
5. Create-opportunity form over `createOpportunity()`.

Not built: the chart view. It reuses `traceGeometry` and the same store, so it
is additive.

### Running it

```sh
pnpm --filter @loom/web dev     # Hono on 8787, Vite on 5173
```

`LOOM_OPPORTUNITIES_DIR`, `LOOM_CANDIDATE_DIR` and `LOOM_CONFIG_FILE` override
the roots; nothing is hardcoded to one candidate.

### Module split

`schema.ts`, `config.ts` and `derive.ts` import nothing from `node:`, and ship
to the browser through the `@loom/tools/opportunity/pure` subpath. The client
therefore computes status, rounds, idle days and staleness with exactly the
code the CLI uses — "stalled" means one thing everywhere.
