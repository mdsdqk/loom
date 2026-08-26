# Candidate Profile schema reference

Walkthrough of `candidate/profile.yml`'s shape. `EVAL.md` is what
actually checks a draft against this file — there is no compiled
validator in this version. Provenance pointers described in
`CONTEXT.md` are out of scope for this profile shape.

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

`status` is set at promotion time (see `SKILL.md`, Outputs and
promotion, and `GAP_CHECKLIST.md`), not mid-conversation.

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

Uniqueness is checked **globally within each ID's namespace** — every
Evidence Claim ID across the whole profile must be unique, not just
within its own evidence group; same for Target Track IDs, skill IDs,
and preference/constraint IDs. `EVAL.md` must reject duplicates.

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
`EVAL.md` must reject the combination otherwise. A `stretch` /
`insufficient` track can still be approved; the candidate's call, not
the system's to gate (see `CONTEXT.md`, Track Readiness).

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

Closed role, month precision:

```yaml
dates:
  start: "2020-01"
  end: "2023-06"
  precision: month
  current: false
```

Current role, year precision:

```yaml
dates:
  start: "2024"
  end: null
  precision: year
  current: true
```

`start` / `end` must match the stated precision — `precision: month`
needs `YYYY-MM`; `precision: year` needs `YYYY`. If `current: true`,
`end` MUST be `null`. `EVAL.md` must reject a mismatch.

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
    origin: resume | linkedin | transcript | agent_estimate | seed_profile
    confirmation: implicit | soft | hard | none
```

**Rules `EVAL.md` must reject a draft for breaking:**
- An `active` claim cannot have `confirmation: none`.
- `rejected` / `superseded` claims are kept, not deleted.

`origin: transcript` means the candidate stated it in this run's
conversation (see `transcript.jsonl`). Do not use `interview`.

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
an **active** claim that exists in this profile — `EVAL.md` must reject
a dangling or pending-only pointer, not just an empty array.

## Preferences and constraints

Same shape, two separate top-level lists:

```yaml
preferences:
  - id: remote-friendly
    statement: "Prefers remote-friendly roles"
    authority: hard | strong | soft
    applies_to: [all]                 # or specific track ids
    status: active | pending | rejected | superseded

constraints:
  - id: no-relocation
    statement: "Not open to relocation outside current region"
    authority: hard
    applies_to: [all]
    status: active
```

`hard` authority can block future matching (v2). `strong`/`soft` guide
positioning but never silently gate a track.

## Compensation and logistics (optional, non-blocking)

Every *populated* fact here carries the same `status`/`confirmation`
provenance as an Evidence Claim — not a bare scalar. Each one is an item
in a flat list, so "populated" means "present in the list," and an unset
field is simply absent rather than `null`.

Money amounts use ordinary major units for `currency` (180000 means
180,000 US dollars, not cents). `currency` is an ISO 4217 code and is
required on any item whose `value` is an amount of money.

A candidate targeting more than one country can have different
expectations per country. Repeat the same `field` with a different
`geography` (and usually a different `currency`) — don't fold them into
one row.

```yaml
compensation:
  items:
    - field: target_total
      value: 180000
      currency: USD
      geography: United States
      status: active
      confirmation: soft
    - field: target_total
      value: 2500000
      currency: INR
      geography: India
      status: active
      confirmation: soft

logistics:
  items:
    - field: acceptable_locations
      value: "Example City"
      status: active
      confirmation: implicit
    - field: acceptable_locations
      value: "Remote"
      status: active
      confirmation: implicit
```

A multi-value fact (like `acceptable_locations` above) is several items
sharing the same `field`, one per value — each can be confirmed, revised,
or superseded independently, the same way Evidence Claims work.
`field` is a free-form label, not a closed set — this data is optional
and deferred to v2 matching, so a rigid enum wasn't worth the added
surface. For consistency, use: `current_fixed`, `current_variable`,
`current_equity`, `minimum_fixed`, `minimum_total`, `target_total`,
`acceptable_variable_percentage`, `equity_preference`,
`cash_equity_tradeoff` (compensation);
`current_location`, `acceptable_locations`, `workplace_modes`,
`relocation`, `work_authorization`, `sponsorship_required`,
`notice_period`, `earliest_start_date`, `employment_types`,
`travel_tolerance`, `timezone_overlap` (logistics).

`geography` on a compensation item is a free-form country or region
label (e.g. `United States`, `India`, `EU`). Omit it only when the
expectation is not geography-specific.

Stored for future matching (v2). Master Resume Build does not read these
fields — tell the candidate that explicitly when offering to record them,
so they know why they're being asked.
