---
name: build-profile
description: Conversational onboarding that turns a candidate's resume, LinkedIn export, and career history into a grounded, evidence-backed Candidate Profile with approved Target Tracks. Handles both first-run onboarding and later updates to an existing profile — there is no separate refine skill. Use when the candidate wants to start or update their Loom Candidate Profile.
---

# Build Profile

This is a thin host adapter, not the canonical instructions. Read and
follow `.agents/skills/build-profile/SKILL.md` in full, along with its
reference docs in the same directory
(`CANDIDATE-PROFILE-SCHEMA.md`, `SESSION-SCHEMA.md`, `GAP-CHECKLIST.md`,
`EVAL.md`) — that's where the actual workflow lives.

This file exists only because Claude Code discovers project skills under
`.claude/skills/`, not `.agents/skills/`. `.agents/skills/` is this
project's own portable, host-agnostic source of truth (see ADR 0001 and
`docs/plans/profile-build-implementation.md`, Host discovery) — it's not
something any host scans automatically, including this one. Keep this
file's frontmatter in sync with the canonical file's if either changes;
keep everything else here to a minimum.
