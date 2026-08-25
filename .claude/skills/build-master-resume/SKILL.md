---
name: build-master-resume
description: Turns one usable Candidate Profile and one approved Target Track into a ready-to-use, candidate-accepted Master Resume, with no job description involved. Use when the candidate wants a general-purpose resume for a specific track, either right after Profile Build or independently later.
---

# Build Master Resume

This is a thin host adapter, not the canonical instructions. Read and
follow `.agents/skills/build-master-resume/SKILL.md` in full — that's
where the actual workflow lives. Its reference docs in the same directory
(`MASTER-RESUME-SCHEMA.md`, `EVAL.md`) are for consulting on demand as
`SKILL.md` points to them, not for preloading up front.

This file exists only because Claude Code discovers project skills under
`.claude/skills/`, not `.agents/skills/` (see
`.claude/skills/build-profile/SKILL.md` for the fuller explanation — the
same reasoning applies here). Keep this file's frontmatter in sync with
the canonical file's if either changes; keep everything else here to a
minimum.
