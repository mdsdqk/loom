# Candidate Profile schema reference

Human-readable walkthrough of `candidate/profile.yml`'s shape. The
**executable schema is authoritative** — `tools/src/profile/schema.ts`
(Zod). If this doc and the code ever disagree, the code wins; update this
doc to match, not the other way around. Validate any draft against it via:

```sh
pnpm --filter @loom/tools profile-validate <absolute-path-to-profile.yml>
```

**Always pass absolute paths to these CLIs.** `pnpm --filter @loom/tools <cli>`
always runs with `tools/` as its working directory, not the repo root — a
bare relative path like `candidate/profile.yml` resolves to
`tools/candidate/profile.yml`, which doesn't exist. Resolve `candidate/...`
paths to absolute ones (e.g. against the repo root you're already
operating in) before passing them to any command in this file or
`EVAL.md`.

## Top level

```yaml
schema_version: 1
status: in_progress | usable_with_gaps | complete
identity: {...}
narrative: {...}            # optional
role_tracks: [...]
experience: [...]
education: [...]
projects: [...]
skills:
  demonstrated: [...]
  reported: [...]
preferences: [...]
constraints: [...]
compensation: {...}         # optional
logistics: {...}            # optional
```

`status` reflects promotion-time state (see Profile Build's Completion
step in `SKILL.md`), not something set mid-conversation.

## Identity

```yaml
identity:
  name: "Alex Example"
  preferred_name: "Alex"            # optional
  location: "Example City"          # optional
  contact:
    email: "alex@example.com"       # all contact fields optional
    phone: "..."
    linkedin: "..."
    github: "..."
    portfolio: "..."
  open_to_relocation: true          # optional
```

## Narrative

```yaml
narrative:
  one_sentence: "..."          # optional — a single canonical pitch
  positioning_notes: "..."     # optional — how the candidate wants to be seen
```

Deliberately small. Not a place for scattered self-description — one
canonical spot, not five variants (see `CONTEXT.md`, Candidate Profile).

## Slugs (IDs)

Every `id` field in this document (Evidence Claim, Evidence Group,
Target Track, experience/education/project, skill, preference/constraint)
is a **slug**: lowercase ASCII letters, digits, single hyphens
(`examplecorp-developer-platform-built`). No path traversal (`.`, `..`),
no Windows-reserved names (`con`, `prn`, `com1`, etc. — these IDs can
become directory segments, e.g. `candidate/tracks/{track-id}/`).

Uniqueness is enforced **globally within each ID's namespace** — every
Evidence Claim ID across the whole profile must be unique, not just
within its own evidence group; same for Target Track IDs, skill IDs,
and preference/constraint IDs.

## Source References

Every claim and preference/constraint carries `source_refs`: compact
links to where a fact came from, never full excerpts. Two forms only:

```text
source:{run-id}:{source-id}#{record-id}
transcript:{run-id}#{event-id}
```

Both segments before `#` are the run that produced the reference — this
is what lets reruns create new records without colliding with a prior
run's provenance. See `SESSION-SCHEMA.md` for transcript event IDs and
the source-normalization tooling (`tools/src/source-normalization/`) for
source/record IDs.

## Target Tracks

```yaml
role_tracks:
  - id: application-engineering-staff
    family: application-engineering
    level: staff
    target_titles:
      - "Staff Application Engineer"
      - "Staff Software Engineer, Application Platform"
    positioning: "Application platform and architecture leadership"   # optional
    readiness:
      tier: strong | stretch | insufficient
      reasoning: "..."                    # required — never a bare score
      supporting_evidence_ids: [...]
      gaps: [...]
      candidate_acknowledged: true
      approved_to_build: true
```

`approved_to_build: true` **requires** `candidate_acknowledged: true` —
the schema rejects the combination otherwise. A `stretch`/`insufficient`
track can still be approved; the candidate's call, not the system's to
gate (see `CONTEXT.md`, Track Readiness).

## Experience / Education / Projects

All three follow the same evidence-group pattern (Education and Projects
were extrapolated from Experience's shape — the plan never specified them
directly, so double-check these against real use before treating them as
final):

```yaml
experience:
  - id: examplecorp
    company: "ExampleCorp"
    title: "Senior Software Engineer"
    dates: {...}                        # see Structured dates below
    evidence:
      - id: examplecorp-platform
        topic: "Internal developer platform"
        tags: [platform, developer-experience]
        claims: [...]                    # see Evidence Claims below

education:
  - id: state-university
    institution: "State University"
    degree: "B.S. Computer Science"      # optional
    field_of_study: "Computer Science"   # optional
    dates: {...}                         # optional
    evidence: [...]

projects:
  - id: minimap-visualizer
    name: "Minimap Visualizer"
    description: "..."                   # optional
    dates: {...}                         # optional
    evidence: [...]
```

## Structured dates

```yaml
dates:
  start: "2020-01"       # or "2020" if precision: year
  end: "2023-06"          # or null for a current role
  precision: year | month
  current: true            # optional; if true, end MUST be null
```

`start`/`end` must match the stated precision — a `precision: month` date
needs `YYYY-MM`, not just `YYYY`.

## Evidence Claims

Independently usable career facts, grouped for readability but atomic
individually — building a platform, its adoption, and a measured
improvement are three separate claims even if they describe one
achievement (see `CONTEXT.md`, Evidence Claim).

```yaml
claims:
  - id: examplecorp-developer-platform-built
    statement: "Architected and shipped an internal developer platform"
    status: active | pending | rejected | superseded
    origin: resume | linkedin | interview | agent_estimate | seed_profile
    confirmation: implicit | soft | hard | none
    source_refs:
      - "source:run-20260824-a:sample-resume#para-3"
```

**Rules the schema enforces:**
- An `active` claim cannot have `confirmation: none`.
- `active`/`pending` claims need at least one `source_refs` entry.
- `rejected`/`superseded` claims are kept, not deleted — they retain
  their Source References so later runs understand what changed.

See Confirmation tiers in `CONTEXT.md` for what each tier means and when
to use it (soft for candidate-stated claims, hard for agent-estimated
ones).

## Skills

```yaml
skills:
  demonstrated:
    - id: typescript
      name: "TypeScript"
      evidence_ids: [examplecorp-developer-platform-built]   # >= 1 ACTIVE claim required
  reported:
    - id: data-visualization
      name: "Data visualization"    # no evidence required, but needs HITL
                                     # before prominent factual use downstream
```

A demonstrated skill needs at least one `evidence_ids` entry pointing at
an **active** claim — the schema checks this, not just that the array is
non-empty.

## Preferences and constraints

Same shape, two separate top-level lists:

```yaml
preferences:
  - id: remote-friendly
    statement: "Prefers remote-friendly roles"
    authority: hard | strong | soft
    applies_to: [all]                 # or specific track ids
    status: active | pending | rejected | superseded
    source_refs: [...]

constraints:
  - id: no-relocation
    statement: "Not open to relocation outside current region"
    authority: hard
    applies_to: [all]
    status: active
    source_refs: [...]
```

`hard` authority can block future matching (v2). `strong`/`soft` guide
positioning but never silently gate a track.

## Compensation and logistics (optional, non-blocking)

Every *populated* fact here carries the same `status`/`confirmation`/
`source_refs` provenance as an Evidence Claim — not a bare scalar. Each
one is an item in a flat list, so "populated" means "present in the
list," and an unset field is simply absent rather than `null`:

```yaml
compensation:
  items:
    - field: target_total
      value: 9000000
      status: active
      confirmation: soft
      source_refs: ["transcript:run-20260824-a#event-12"]

logistics:
  items:
    - field: acceptable_locations
      value: "Example City"
      status: active
      confirmation: implicit
      source_refs: ["source:run-20260824-a:sample-resume#bullet-2"]
    - field: acceptable_locations
      value: "Remote"
      status: active
      confirmation: implicit
      source_refs: ["source:run-20260824-a:sample-resume#bullet-2"]
```

A multi-value fact (like `acceptable_locations` above) is several items
sharing the same `field`, one per value — each can be confirmed, revised,
or superseded independently, the same way Evidence Claims work.
`field` is a free-form label, not a closed set the schema enforces — this
data is optional and deferred to v2 matching, so a rigid enum wasn't
worth the added surface. For consistency, use: `current_fixed`,
`current_variable`, `current_equity`, `current_currency`, `minimum_fixed`,
`minimum_total`, `target_total`, `acceptable_variable_percentage`,
`equity_preference`, `cash_equity_tradeoff` (compensation);
`current_location`, `acceptable_locations`, `workplace_modes`,
`relocation`, `work_authorization`, `sponsorship_required`,
`notice_period`, `earliest_start_date`, `employment_types`,
`travel_tolerance`, `timezone_overlap` (logistics).

Stored for future matching (v2). Master Resume Build does not read these
fields — tell the candidate that explicitly when offering to record them,
so they know why they're being asked.
