# Master Resume schema reference

Walkthrough of `candidate/tracks/{track}/resume.yml`'s shape. `EVAL.md`
is what actually checks a draft against this file — there is no compiled
validator in this version.

## The core distinction: `profile_ref` vs. generated prose

Every factual field in a Master Resume is one of exactly two kinds —
know which one you're writing before you write it:

- **Structured, copied verbatim** (`profile_ref`) — identity, company,
  role/title, dates, education institution/degree/dates, skill names.
  These must **exactly match** the referenced Candidate Profile record.
  If wording legitimately needs to differ from the profile, that's a
  sign it should be generated prose instead, not a looser `profile_ref`
  match.
- **Generated prose** (`evidence_ids`) — summaries, role intros,
  bullets, project descriptions, recognition. May combine, summarize,
  or reframe the underlying Evidence Claims — but never strengthen
  ownership, causality, magnitude, organizational scope, adoption,
  recency, or certainty beyond what those claims actually support.

`profile_ref` is a dot-path into the Candidate Profile: array segments
are looked up by `id`, object segments by property name. Examples:
`identity`, `experience.examplecorp`, `education.state-university`,
`skills.demonstrated.typescript`.

## Top level

```yaml
schema_version: 1
track_id: application-engineering-senior
identity: {...}
summary: {...}
experience: [...]
education: [...]            # optional
projects: [...]
skills: [...]
recognition: [...]
presentation:
  target_pages: 2
```

`track_id` must match an entry in the Candidate Profile's `role_tracks`
with `approved_to_build: true`. `EVAL.md` must reject a resume for a
missing or unapproved track.

`education` may be omitted when the candidate has none worth showing
on this track's resume. `projects` and `recognition` may be empty
lists. `experience` and `skills` should not be.

## Identity

```yaml
identity:
  profile_ref: identity
  name: "Alex Example"
  location: "Example City"        # optional
  contact: {...}                   # optional; no evidence/profile_ref needed
```

`name` (and `location`, when present) must exactly match the
`profile_ref` target. `contact` formatting and section labels are
presentation, not facts — they don't need grounding at all.

## Summary

```yaml
summary:
  text: "Senior engineer with experience building reusable platforms..."
  evidence_ids: [examplecorp-developer-platform-built]
```

Generated prose — needs `evidence_ids`, not a `profile_ref`. At least
one id, and every id must point at an **active** Evidence Claim that
exists in the Candidate Profile.

## Experience

```yaml
experience:
  - id: examplecorp
    profile_ref: experience.examplecorp
    company: "ExampleCorp"                 # must match profile_ref target exactly
    role: "Senior Software Engineer"       # must match the profile's `title` exactly
    dates: {...}                            # must match the profile_ref target exactly
    intro:                                  # optional, generated prose
      text: "Technical lead for an internal platform..."
      evidence_ids: [examplecorp-lead-scope]
    bullets:
      - text: "Architected an internal platform used by several teams..."
        emphasis: high | medium | low
        tags: [platform, developer-experience]
        evidence_ids:
          - examplecorp-developer-platform-built
          - examplecorp-developer-platform-adoption
```

`company` / `role` / `dates` are structured facts, checked exactly
against the Candidate Profile experience entry `profile_ref` points at
— note the field is `role` here but `title` in the Candidate Profile;
the *values* must still match exactly despite the field name
differing. `intro` and every `bullets[]` entry are generated prose.

`dates` follows the Candidate Profile's Structured Date shape
(`start` / `end` matching `precision`; `current: true` has `end: null`).
See `.agents/skills/build-profile/CANDIDATE_PROFILE_SCHEMA.md`.

## Education

Optional. When present, each entry is a structured copy of a Candidate
Profile education record — same `profile_ref` exact-match rule as
experience.

```yaml
education:
  - id: state-university
    profile_ref: education.state-university
    institution: "State University"        # must match profile_ref target exactly
    degree: "B.S. Computer Science"        # optional; must match if present
    field_of_study: "Computer Science"     # optional; must match if present
    dates: {...}                            # optional; must match if present
```

Do not invent education that isn't on the profile. Omit the whole
section rather than leaving a dangling `profile_ref`.

## Projects / Recognition

```yaml
projects:
  - id: minimap-visualizer
    name: "Minimap Visualizer"
    description:                    # optional, generated prose
      text: "..."
      evidence_ids: [...]

recognition:
  - id: platform-launch-recognition
    text: "..."
    evidence_ids: [...]
```

Same rule as everywhere else: prose needs `evidence_ids`. Project
`name` is a label for this resume, not a `profile_ref` field — don't
invent a project the profile doesn't support; ground any descriptive
prose in active claims.

## Skills

```yaml
skills:
  - id: typescript
    profile_ref: skills.demonstrated.typescript
    name: "TypeScript"              # must match the profile record exactly
```

Only demonstrated skills can appear here with a `profile_ref`.
`EVAL.md` must reject a `profile_ref` pointing into
`skills.reported.*` — a reported-only skill needs evidence and HITL
in the Candidate Profile before it can show up on a Master Resume
(see `.agents/skills/build-profile/CANDIDATE_PROFILE_SCHEMA.md`,
Skills).

## Presentation

```yaml
presentation:
  target_pages: 2
```

Default intent is 2, configurable. Actual PDF page-fit enforcement is
rendering's responsibility (ticket 008), not this skill's —
`target_pages` here is how much content to include, not a guarantee of
the rendered output's exact length. Must be a positive integer.

## Slugs and uniqueness

Every `id` field in this document (`experience`, `education`,
`projects`, `skills`, `recognition`) is a **slug**: lowercase ASCII
letters, digits, single hyphens. No path traversal (`.`, `..`), no
Windows-reserved names (`con`, `prn`, `com1`, etc. — `track_id` is
also a directory segment under `candidate/tracks/{track-id}/`).

Uniqueness is checked **within each list**, not globally across the
resume — narrower than the Candidate Profile's global-namespace
uniqueness, since a Master Resume is a much smaller, single-track
document. `EVAL.md` must reject duplicates inside a list.
