---
name: create-master-resume
description: Turns one usable Candidate Profile and one approved Target Track into a ready-to-use, candidate-accepted Master Resume, with no job description involved. Use when the candidate wants a general-purpose resume for a specific track, either right after Profile Build or independently later.
---

# Create Master Resume

This is a thin host redirect, not the canonical skill. Claude Code
discovers project skills under `.claude/skills/`, but this project's
canonical, portable skill instructions live under `.agents/skills/`
(see `/CONTEXT.md`, Profile Build, and
`docs/plans/profile-build-implementation.md`, Host discovery, for why:
symlinking `.claude/skills` to `.agents/skills` doesn't work reliably in
this repo/environment, so other hosts get their own thin redirect instead).

Read and follow `.agents/skills/create-master-resume/SKILL.md` in full, along
with the companion files it references in that same directory
(`MASTER_RESUME_SCHEMA.md`, `EVAL.md`). Do not treat this file as a summary
or a substitute — it carries no instructions of its own beyond this redirect.
