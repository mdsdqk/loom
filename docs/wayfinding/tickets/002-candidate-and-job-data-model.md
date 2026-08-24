---
id: "002"
title: "Candidate, Profile, Resume, and Opportunity File Model"
type: "grilling"
status: "resolved"
assignee: null
blocked_by: ["001"]
blocking: ["003", "004", "005", "006", "008", "009"]
---

## Question

Lock down the file-based data model for MVP v1 (resume tailoring only). The structure has been sketched, but we need the precise organization:

All example candidate data in this ticket is fictional.

**Known structure** (from grilling):
```
candidate/
  profile.yml                        # Validated Candidate Profile
  tracks/
    {track-name}/
      resume.yml                     # Master resume for this track

opportunities/
  {company-role-id}/
    jd.md                            # Job description (user-provided)
    artifacts/
      resume_tailored.v1.yml         # Tailored resume variation 1
      resume_tailored.v2.yml         # Variation 2, etc.
      resume_final.yml               # Final version user approved
      resume.html                    # Rendered HTML
      resume.pdf                     # Final PDF for submission
      resume.meta.yml                # Metadata: reasoning, what changed, why
```

**Open questions**:

1. **Candidate profile structure**: What fields belong in
   `candidate/profile.yml`, and how should Profile Build represent extensive
   history without repetition?

2. **Role track structure**: How to store multiple role tracks? Separate resume.yml per track? How to represent emphasis/positioning per track?

3. **Resume YAML format**: Exact structure for resume.yml. Example:
   ```yaml
   name: "Alex Example"
   location: "Example City"
   experience:
     - role: "Senior Engineer"
       company: "ExampleCorp"
       dates:
         start: "2020-01"
         end: "2023-06"
         precision: month
       bullets:
         - "Achievement 1"
         - "Achievement 2"
       skills: ["TypeScript", "Node.js"]
       emphasis: "high"
   ```
   Or different structure?

4. **Metadata format**: What to store in resume.meta.yml? (reasoning for each change, what was added/removed/rewritten, date, user edits, etc.)

5. **Explicit preferences storage**: Where should preferences such as "do not
   claim unsupported certifications" or "prefer concise summaries" live?

6. **Provenance tracking** (MVP v1): How should candidate imports, exact
   Profile Build answers, agent estimates, and generated presentation remain
   distinguishable?

**Constraint**: Structure should be human-readable, git-friendly, support easy diffing and versioning.

## Resolution

**CLOSED** - File-based data model for MVP v1 (YAML + Markdown). File
layout below is still accurate; the *semantics* of `profile.yml` vs the
per-track `resume.yml` were sharpened later while grilling ticket 003
(Profile Build) — see `/CONTEXT.md` (Candidate Profile, Master Resume)
for the authoritative definitions. In short: `profile.yml` is the full
evidence/context layer (not a resume), and each `tracks/{track}/resume.yml`
is a ready-to-use, candidate-accepted resume for that track — not a
filtered view of `profile.yml`.

**Candidate Profile** (`candidate/profile.yml`):
```yaml
schema_version: 1
status: usable_with_gaps

identity:
  name: "Alex Example"
  preferred_name: "Alex"
  location: "Example City"
  contact: {...}

role_tracks:
  - id: application-engineering-staff
    family: application-engineering
    level: staff
    target_titles: ["Staff Application Engineer"]
    positioning: "Application platform and architecture leadership"
    readiness:
      tier: stretch
      reasoning: "..."
      supporting_evidence_ids: [examplecorp-developer-platform-built]
      gaps: ["..."]
      candidate_acknowledged: true
      approved_to_build: true

experience:
  - id: examplecorp
    company: "ExampleCorp"
    title: "Senior Software Engineer (Lead)"
    dates:
      start: "2020-01"
      end: "2023-06"
      precision: month
    evidence:
      - id: examplecorp-developer-platform
        topic: "Internal developer platform"
        tags: [platform, developer-experience, tooling]
        claims:
          - id: examplecorp-developer-platform-built
            statement: "Architected and shipped an internal developer platform"
            status: active
            origin: resume
            confirmation: implicit
            source_refs:
              - source:run-20260824-a:sample-resume#examplecorp-bullet-1

          - id: examplecorp-developer-platform-adoption
            statement: "The platform was adopted by several internal teams"
            status: active
            origin: interview
            confirmation: implicit
            source_refs:
              - transcript:run-20260824-a#event-38

          - id: examplecorp-lead-scope
            statement: "Acted as technical lead for the platform"
            status: active
            origin: interview
            confirmation: implicit
            source_refs:
              - transcript:run-20260824-a#event-40

          - id: examplecorp-developer-platform-impact
            statement: "Reduced environment setup time by about 18%"
            status: pending
            origin: agent_estimate
            confirmation: none
            source_refs:
              - source:run-20260824-a:sample-resume#examplecorp-bullet-1
              - transcript:run-20260824-a#event-42

skills:
  demonstrated:
    - name: "TypeScript"
      evidence_ids: [examplecorp-developer-platform-built]
  reported:
    - name: "Data visualization"

preferences:
  - id: remote-friendly
    statement: "Prefers remote-friendly roles"
    authority: strong
    applies_to: [all]
    status: active
    source_refs: [transcript:run-20260824-a#event-72]

constraints: [...]
compensation: {...} # optional future matching data
logistics: {...}    # optional future matching data
```

The executable contract lives with the Profile Build skill schema. Related
achievements are grouped for readability, but independently usable facts
remain atomic claims with their own lifecycle, confirmation, and sources.
Original and normalized sources do not live inside `profile.yml`.

**Master Resumes** (candidate/tracks/{track}/resume.yml):
```yaml
identity:
  profile_ref: identity
  name: "Alex Example"
  contact: {...}
title: "Senior Software Engineer"
summary:
  text: "..."
  evidence_ids: ["examplecorp-developer-platform-built"]

experience:
  - id: "examplecorp"
    profile_ref: experience.examplecorp
    company: "ExampleCorp"
    role: "Senior Software Engineer"
    dates:
      start: "2020-01"
      end: "2023-06"
      precision: month
    stack: ["TypeScript", "Node.js", "Python", "Cloud Platform"]
    
    intro:
      text: "Technical lead for an internal platform..."
      evidence_ids: ["examplecorp-lead-scope"]
    
    bullets:
      - text: "Designed an **internal developer platform**..."
        impact: "reducing environment setup time by about 18%"
        emphasis: "high"
        tags: ["platform", "leadership", "developer-experience"]
        evidence_ids:
          - "examplecorp-developer-platform-built"
          - "examplecorp-developer-platform-adoption"

projects: [...]
skills:
  - category: "Languages"
    items:
      - id: typescript
        profile_ref: skills.demonstrated.typescript
        name: "TypeScript"

recognition: [...]
presentation:
  target_pages: 2
```

Generated prose, including summaries, role introductions, bullets, projects,
and recognition, references active Candidate Profile Evidence Claim IDs.
Structured identity, company, role, date, education, and demonstrated-skill
fields use `profile_ref` and must exactly match the referenced profile record.
`/build-master-resume` receives no job description. A draft becomes the track's
`resume.yml` only after schema and grounding evals pass and the candidate
explicitly accepts it.

**Tailored Variants** (opportunities/{slug}/artifacts/resume_tailored.vN.yml):
- Same structure as master, but:
  - Filtered bullets (remove low emphasis)
  - Reordered (match job requirements first)
  - Adjusted tone/language
  - Metadata file tracks changes

**Metadata** (opportunities/{slug}/artifacts/resume.meta.yml):
```yaml
generated_at: "<timestamp>"
track_used: "frontend"  # Which master resume was used
reasoning:
  - "Job emphasizes platform engineering"
  - "Promoted platform experience because role requires it"
  - "Reordered leadership bullets after technical achievements"

changes:
  - action: "promoted"
    bullet: "internal developer platform"
    reason: "Job requires platform architecture experience"
  
  - action: "demoted"
    bullet: "legacy maintenance project"
    reason: "Less relevant to the selected role"

edits: []  # User edits tracked here
```

**File Structure**:
```
candidate/
  imports/                              # Immutable user-supplied inputs
  sources/                              # Normalized immutable source records
  profile-build/
    runs/{run-id}/
      session.yml                       # Resumable checkpoint
      transcript.jsonl                  # Exact conversation events
      profile.draft.yml
      profile.eval.yml
  profile.yml                           # Validated Candidate Profile
  tracks/
    application-engineering-senior/
      resume.draft.yml
      resume.draft.eval.yml
      resume.yml                        # Accepted Master Resume
    application-engineering-staff/
      resume.draft.yml
      resume.draft.eval.yml
      resume.yml

opportunities/
  {company-role-id}/
    jd.md                              # Job description
    artifacts/
      resume_tailored.v1.yml           # Variant 1
      resume_tailored.v2.yml           # Variant 2, etc.
      resume_final.yml                 # Final approved version
      resume.meta.yml                  # Reasoning + changes
      resume.html                      # Rendered HTML
      resume.pdf                        # Final PDF
```

**Key Features**:
- ✅ One master resume per track
- ✅ Target Tracks pair role family and level
- ✅ Atomic claims carry compact provenance and confirmation
- ✅ Generated prose references active evidence; copied structured facts use
  exact `profile_ref` validation
- ✅ Bullets have emphasis levels and matching tags
- ✅ Metadata tracks reasoning separately
- ✅ Git-friendly (diffs show what changed)
- ✅ Supports learning/pattern recognition in v2
