---
id: "004"
title: "Resume Tailoring: Interaction Pattern & Learning Mechanism"
type: "prototype"
status: "reopened"
assignee: null
blocked_by: ["002", "003", "009"]
blocking: ["008"]
---

## Question

Design the resume tailoring workflow for MVP v1. Given: Candidate Profile +
accepted Master Resume + Job Description → Generate a grounded tailored resume
+ reasoning → User reviews and edits → Export PDF.

**Requirements** (from PRD + grilling):
1. System generates tailored resume YAML from the complete Candidate Profile,
   the selected track's Master Resume, and the Job Description.
2. System explains reasoning (what was emphasized, why, what was adjusted)
3. User can review and either:
   - Accept as-is
   - Ask agent to modify ("Expand the platform architecture section", "Remove generic language")
   - Edit YAML directly
4. Track versions (resume_tailored.v1.yml, v2.yml, etc.)
5. Store final version as resume_final.yml
6. Render to PDF for submission

**Workflow**:
```
Candidate Profile
    + Role Track
    + Job Description
        ↓
Claude (Sonnet) generates tailored resume YAML
        ↓
System outputs: resume_tailored.v1.yml + resume.meta.yml (reasoning)
        ↓
User reviews diffs from master resume
        ↓
User either:
  (a) Asks agent: "Edit X" → Claude modifies YAML → v2.yml
  (b) Manually edits v1.yml → user saves → system records changes
  (c) Accepts v1 as final
        ↓
Final: resume_final.yml → render HTML → resume.pdf
```

**Open questions**:

1. **Resume YAML modification**: When user asks agent to "expand platform architecture", how does the agent:
   - Understand the request (Claude understands natural language)?
   - Modify the YAML (edit structure, rewrite bullets, adjust fields)?
   - Show the result (diff against v1, explain changes)?

2. **Manual editing**: User edits resume_tailored.v1.yml directly (YAML format). How does system detect changes?
   - User tells agent "I've edited it, check v1.yml"?
   - Or system watches file changes?
   - How to compute diffs and store in metadata?

3. **Reasoning metadata**: What to store in resume.meta.yml?
   - "Why this section was reordered" (candidate data relevant to job)
   - "Why this bullet was added/removed" (job signal that triggered it)
   - "What candidate preferences constrained this" (preferences applied)
   - Structure/format?

4. **Versioning logic**: When user makes edits:
   - Each iteration gets a new v number (v1.yml → v2.yml → v3.yml)?
   - Or does user directly edit and save (v1.yml → updated v1.yml)?
   - How to track user's final choice?

5. **Preference application**: How does the system apply explicit candidate preferences?
   - Example: if the candidate says "do not claim unsupported
     certifications," how does the system enforce that constraint?
   - Where's the check logic?

6. **Rendering to PDF**: delegated to ticket 008, which selected Handlebars
   and Puppeteer.

**Constraints**:
- MVP ships in days → keep workflow simple
- Token-bounded (Sonnet for generation, manage API calls)
- File-based (no database, just YAML and PDFs on disk)
- User edits files directly or via agent (no UI preview for MVP v1)

## Resolution

**REOPENED (2026-08-24)** — see note at end of this section. Original
resolution below is superseded on the input model; the interaction flow
(versions, review, export) still stands.

**CLOSED** - Resume tailoring workflow for MVP v1:

**Entry point**: `pnpm run tailor-resume <jd-path> [--track <track-name>]`

**Process**:

1. **Track detection**: Claude analyzes the job description, selects the best
   Target Track (for example `application-engineering-senior` or
   `application-engineering-staff`), and explains its reasoning.

2. **Master resume loading**: Load candidate/tracks/{detected-track}/resume.yml

3. **Tailoring prompt to Claude**:
   ```
   Given:
   - Master resume (YAML) — the candidate's own accepted structure, tone, and priorities for this track
   - Job description (text)
   - Candidate Profile (profile.yml) — complete structured evidence/context
     layer, read in full for MVP v1
   
   Task:
   - Create tailored resume (same YAML structure)
   - Filter bullets (keep high-emphasis, remove low if needed)
   - Reorder (most relevant first)
   - Adjust language/tone for this role
   - Never invent facts
   - Use only active Candidate Profile Evidence Claims
   - Attach evidence_ids to generated factual prose and profile_ref pointers
     to structured copied fields
   - If relevant pending evidence could materially improve the resume, stop
     tailoring and direct the candidate through `/build-profile`
     reconciliation, then restart tailoring from the promoted profile
   - Respect preferences
   
   Output:
   - Tailored resume YAML
   - Reasoning metadata (what changed, why)
   - Summary text (explanation)
   ```

4. **Claude outputs** (saved to opportunities/{slug}/artifacts/):
   - `resume_tailored.v1.yml` - tailored variant
   - `resume.meta.yml` - reasoning + changes
   - `summary.txt` - human-readable explanation

   The tailored resume must pass deterministic schema/reference validation and
   a separate grounding eval before review. Candidate edits trigger the same
   checks again before acceptance.

5. **User review & edit** (two paths):
   
   **Path A - Manual edit**:
   - User opens resume_tailored.v1.yml, edits directly
   - Tells agent: "I've edited it"
   - System computes diff (v1_original vs v1_edited)
   - Saves changes to metadata
   
   **Path B - Chat edit**:
   - User in session: "Expand platform architecture section"
   - Claude modifies resume_tailored.v1.yml → saves as resume_tailored.v2.yml
   - System tracks all versions + reasoning
   - Repeat until happy

6. **Final version**:
   - User accepts current version
   - Copy to resume_final.yml
   - Ready for export to PDF

7. **Export**: `pnpm run export-resume <slug>`
   - Render resume_final.yml via Handlebars template → HTML → PDF
   - Save as resume.pdf

**CLI flow**:
```bash
pnpm run tailor-resume jobs/examplecorp-staff-engineer.md
# Output: resume_tailored.v1.yml + resume.meta.yml + summary.txt

# User reviews, edits (manual or chat), iteration...

pnpm run accept-resume opportunities/examplecorp-staff-engineer
# Output: resume_final.yml

pnpm run export-resume opportunities/examplecorp-staff-engineer
# Output: resume.pdf
```

**Notes**:
- Reference career-ops workflow for refinement during implementation
- Metadata tracks all versions + reasoning for v2 learning
- Support both manual edit + chat edit flows for flexibility

---

## Reopened — Input model update (2026-08-24)

Grilled alongside pulling Profile Build (`003`, renamed from
"Questionnaire") forward into MVP v1. See `/CONTEXT.md` for the settled
vocabulary (Candidate Profile, Master Resume, Track Readiness).

**What changes**: Step 3's tailoring prompt was scoped to "Master resume +
job description + candidate preferences/constraints (from profile.yml)" —
treating `profile.yml` as a small preferences lookup. That's no longer
accurate. `profile.yml` (the Candidate Profile) is the full evidence/
context layer: every fact and story learned about the candidate, including
detail too trivial or specific for any Master Resume, kept precisely so an
obscure JD requirement can surface a coincidental match a filtered or
reordered Master Resume view would miss, such as a one-off visualization
project matching a "dashboard experience a plus" line.

**Updated input model for tailoring**:
```
Master Resume (track-level, YAML)   — candidate's own structure/tone/priorities
      +
Candidate Profile (profile.yml)     — full evidence layer, consulted directly
      +
Job Description
      ↓
Tailored resume for this opportunity
```

The Master Resume is not simply filtered further — the Candidate Profile
is searched directly for job-relevant evidence that didn't make it into
the Master Resume, and that evidence can surface in a tailored variant
even though it isn't in the track's general-purpose resume.

**MVP v1 retrieval decision**: tailoring reads the complete Candidate Profile.
Semantic retrieval, tag-only retrieval, and cached projections are deferred
until profile size or measured cost makes them necessary. Only active Evidence
Claims are usable. Reported skills and pending claims require HITL before
prominent or factual use.

**Blocked by**: `003` producing a usable Candidate Profile and the separate
`/build-master-resume` skill producing an accepted Master Resume for at least
one approved Target Track.

**Grounding requirement**: generated prose retains active Evidence Claim IDs.
Structured identity, company, role, date, education, and demonstrated-skill
fields retain `profile_ref` pointers and must exactly match the referenced
Candidate Profile records. Generated wording may reframe or combine evidence
but cannot strengthen ownership, causality, magnitude, organizational scope,
adoption, recency, or certainty.
