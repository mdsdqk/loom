---
id: "001"
title: "Tech Stack, Local Execution, and Credential Handling"
type: "research"
status: "resolved"
assignee: null
blocked_by: []
blocking: ["002", "005", "007"]
---

## Question

Lock down the tech stack for MVP v1 resume tailoring (CLI + file-based, no web app):

1. **Runtime & Language**: Confirm Node.js + TypeScript? Any version constraints?
2. **Entry Points**: How do users trigger conversational Profile and Master
   Resume Build, scripted tailoring, and PDF export?
3. **Credential Handling**: Users bring BYOK Claude API credentials. How to handle?
   - Pass via Claude Agent SDK runtime (credentials never stored)?
   - Store in `.env` locally (user's responsibility)?
   - Hybrid?
4. **File I/O & Parsing**:
   - Resume.md parsing (markdown → extract text)?
   - YAML reading/writing (js-yaml library, or other)?
   - LinkedIn CSV parsing (xlsx or csv-parse)?
5. **Claude Integration**: Use Claude Agent SDK directly, or simple Messages API calls? Any orchestration framework needed (LangGraph, LangChain, or keep it simple)?
6. **Artifact Storage**: Files on disk (YAML, HTML, PDF) via fs module. Any database needed for MVP v1? (Likely no — file-based is enough)

**Constraints & Context**:
- Shipping MVP in days (decisions should be quick)
- Single-user, local-only
- File-based data (YAML, Markdown, PDFs)
- No web UI for MVP v1
- Cost-optimized (use Sonnet for tailoring, manage API calls carefully)

## Resolution

**CLOSED** - MVP v1 tech stack locked:

- **Runtime**: Node.js + TypeScript (existing Turborepo setup)
- **Entry points**: portable conversational skills for Profile and Master
  Resume Build; pnpm scripts for deterministic tailoring and export steps
- **Orchestration**: Direct scripts (no framework for MVP v1). Evaluate LangGraph/others v2 when multi-turn AI or complex branching needed.
- **Model integration**: the user brings the agent host, model access, and
  provider credentials. Profile and Master Resume Build use the host model;
  grounding evals use a separate cheaper available model. Tailoring may use
  the configured Claude SDK directly in v1.
- **Vendor agnostic**: Direct SDK for MVP, document abstraction points for v2 refactor
- **File I/O**: Node.js fs module, @loom/tools for LinkedIn CSV parsing
- **Data storage**: YAML files + PDFs (no DB for MVP v1)

**Not needed for MVP v1**: SQLite, Next.js, React, web framework, authentication, cloud backend.

Credentials live only in local environment variables. `.env` files and all
candidate/opportunity data are gitignored. Loom is a local orchestration layer:
it does not operate a data-collection service, but user-invoked external
providers receive the inputs disclosed by their workflow. Provider and
source-site terms remain the user's responsibility.
