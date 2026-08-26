---
name: build-profile
description: Conversational onboarding that turns a candidate's resume, LinkedIn export, and career history into a grounded, evidence-backed Candidate Profile with approved Target Tracks. Handles both first-run onboarding and later updates to an existing profile. Use when the candidate wants to start or update their Loom Candidate Profile.
---

# Build Profile

This is a thin host redirect, not the canonical skill. Claude Code
discovers project skills under `.claude/skills/`, but this project's
canonical, portable skill instructions live under `.agents/skills/`
(see `/CONTEXT.md`, Profile Build, and
`docs/plans/profile-build-implementation.md`, Host discovery, for why:
symlinking `.claude/skills` to `.agents/skills` doesn't work reliably in
this repo/environment, so other hosts get their own thin redirect instead).

Read and follow `.agents/skills/build-profile/SKILL.md` in full, along
with the companion files it references in that same directory
(`CANDIDATE_PROFILE_SCHEMA.md`, `SESSION_SCHEMA.md`, `GAP_CHECKLIST.md`,
`EVAL.md`). Do not treat this file as a summary or a substitute — it
carries no instructions of its own beyond this redirect.
