# Master Resume schema reference

Human-readable walkthrough of `candidate/tracks/{track}/resume.yml`'s
shape. The **executable schema is authoritative** —
`tools/src/master-resume/schema.ts` (Zod). If this doc and the code ever
disagree, the code wins; update this doc to match. Validate a draft
against its own shape (not yet cross-checked against a Candidate Profile
— see below and `EVAL.md`) via:

```sh
pnpm --filter @loom/tools master-resume-validate <absolute-path-to-resume.yml> <absolute-path-to-profile.yml>
```

**Always pass absolute paths.** `pnpm --filter @loom/tools <cli>` always
runs with `tools/` as its cwd, not the repo root — a bare relative
`candidate/...` path resolves to `tools/candidate/...`, which doesn't
exist.

## The core distinction: `profile_ref` vs. generated prose

Every factual field in a Master Resume is one of exactly two kinds — know
which one you're writing before you write it:

- **Structured, copied verbatim** (`profile_ref`) — identity, company,
  role/title, dates, skill names. These must **exactly match** the
  referenced Candidate Profile record. If wording legitimately needs to
  differ from the profile, that's a sign it should be generated prose
  instead, not a looser `profile_ref` match.
- **Generated prose** (`evidence_ids`) — summaries, role intros, bullets,
  project descriptions, recognition. May combine, summarize, or reframe
  the underlying Evidence Claims — but never strengthen ownership,
  causality, magnitude, organizational scope, adoption, recency, or
  certainty beyond what those claims actually support.

## Top level

```yaml
schema_version: 1
track_id: application-engineering-senior
identity: {...}
summary: {...}
experience: [...]
projects: [...]
skills: [...]
recognition: [...]
presentation:
  target_pages: 2
```

`track_id` must match an entry in the Candidate Profile's `role_tracks`
with `approved_to_build: true`. This is checked by `master-resume-validate`
itself (`tools/src/master-resume/validate.ts`), not just something the
skill is expected to remember to check manually in step 1 — a resume for
a missing or unapproved track fails deterministic validation outright.

## Identity

```yaml
identity:
  profile_ref: identity
  name: "Alex Example"
  location: "Example City"        # optional
  contact: {...}                   # optional; no evidence/profile_ref needed
```

`contact` formatting and section labels are presentation, not facts —
they don't need grounding at all.

## Summary

```yaml
summary:
  text: "Senior engineer with experience building reusable platforms..."
  evidence_ids: [examplecorp-developer-platform-built]
```

Generated prose — needs `evidence_ids`, not a `profile_ref`.

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

`company`/`role`/`dates` are structured facts, checked exactly against
the Candidate Profile experience entry `profile_ref` points at — note the
field is `role` here but `title` in the Candidate Profile; the *values*
must still match exactly despite the field name differing. `intro` and
every `bullets[]` entry are generated prose.

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

Same rule as everywhere else: prose needs `evidence_ids`. Neither shape
is given explicitly in the underlying plan — both extrapolated to match
the rest of the document's pattern; double-check against real use.

## Skills

```yaml
skills:
  - id: typescript
    profile_ref: skills.demonstrated.typescript
    name: "TypeScript"              # must match the profile record exactly
```

Only demonstrated skills can appear here with a `profile_ref` —
`master-resume-validate` rejects a `profile_ref` pointing into
`skills.reported.*` outright, so there's no path for a `reported`-only
skill to show up on a Master Resume without first becoming demonstrated
in the Candidate Profile (see `CANDIDATE-PROFILE-SCHEMA.md`, Skills).

## Presentation

```yaml
presentation:
  target_pages: 2
```

Default is 2, configurable. Actual PDF page-fit enforcement is rendering's
responsibility (ticket 008), not this skill's — `target_pages` here is
the *intent* driving how much content to include, not a guarantee of the
rendered output's exact length.

## Duplicate-ID checks

`id` fields in `experience`, `projects`, `skills`, and `recognition` are
each checked for uniqueness within their own list (schema-enforced) —
narrower than the Candidate Profile's global-namespace uniqueness, since
a Master Resume is a much smaller, single-track document.
