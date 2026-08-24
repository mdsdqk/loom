---
status: accepted
---

# Profile and Master Resume Build run as conversational skills

Ticket 007 (Architecture & Orchestration) had assumed `pnpm run questionnaire`
as the entry point for onboarding — an interactive stdin prompt loop, in
keeping with MVP v1's "no framework, plain Node scripts" decision.

When we grilled Profile Build (formerly "Questionnaire", ticket 003) into
scope, we decided against that: every candidate's resume, LinkedIn export,
and career history is different, and the questions worth asking to close
gaps in one candidate's profile are not the questions worth asking for
another. A fixed script can't do that; only an adaptive conversation can.

**Decision**: `/build-profile` is implemented as a portable conversational
agent skill, not a `pnpm` CLI script. Its canonical instructions live under
`.agents/skills/`; host-specific command adapters may make it directly
invokable in Claude Code, Cursor, Codex, or another compatible agent host.

Profile Build ends with a usable Candidate Profile. It then offers to invoke
`/build-master-resume` once for each approved Target Track. Master Resume
Build is a separate conversational skill because it has its own candidate
review loop and grounding eval, and must be callable later without rerunning
onboarding.

These skills are deliberate exceptions to ticket 007's "plain scripts, no
framework" default, scoped to adaptive, candidate-facing work. They do not
reopen that decision for deterministic tailoring orchestration, artifact
management, or export.
