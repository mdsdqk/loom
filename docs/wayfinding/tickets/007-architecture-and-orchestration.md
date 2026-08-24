---
id: "007"
title: "Architecture & Orchestration: LangGraph, Simple Scripts, Vendor Agnostic Design"
type: "grilling"
status: "resolved"
assignee: null
blocked_by: ["001"]
blocking: []
---

## Question

Design the architecture for MVP v1 resume tailoring. The core question: How should workflow orchestration work?

**Options under consideration**:

1. **LangGraph** (LangChain's workflow framework)
   - Pros: Built-in node/edge abstraction, state management, visual debugging
   - Cons: Adds dependency, complexity for simple workflow, vendor lock-in (LangChain)

2. **Simple scripts** (pnpm scripts, plain Node.js)
   - Pros: No framework, full control, lightweight, easy to understand
   - Cons: More manual orchestration, state management, error handling

3. **Hybrid** (LangGraph for AI tasks, scripts for file I/O)
   - Pros: Leverage LangGraph where useful, keep simple tasks simple
   - Cons: Extra complexity, boundary management

**Context**:
- Workflow is deterministic and controlled (Candidate + Job → Tailored Resume, not autonomous)
- Single-user, local-only
- No web backend or complex async/queuing needed (for MVP v1)
- User brings Claude API credentials (model selection is Sonnet for tailoring, handled by app logic)

**Key concerns**:
- **Vendor agnostic**: Can the design avoid lock-in to Claude SDK, LangChain, or specific frameworks? 
  - Should we abstract Claude calls so it's easy to switch models/providers later?
  - How to structure this for flexibility?
- **Simplicity**: MVP ships in days. Is LangGraph worth the overhead, or should we keep it simple?
- **State management**: How to track workflow state (questionnaire in progress, resume generation step, user edits, etc.)?
- **Error handling & retries**: How to handle Claude API failures, timeouts, etc.?
- **Testing**: How to test workflows without hitting Claude API repeatedly?

## Open questions:

1. **Primary orchestration choice**: LangGraph, simple scripts, or hybrid? Why?

2. **Claude SDK abstraction**: Should we abstract Claude calls (e.g., `callLLM(model, prompt)`) to make it vendor-agnostic?
   - Or just use Claude SDK directly, accept vendor tie-in for MVP, refactor in v2?

3. **State machine**: Should workflow be explicit state machine (states: questionnaire → tailoring → review → export)?
   - Or implicit (file structure represents state)?

4. **CLI entry points**: How should user trigger each step?
   - `/build-profile` and `/build-master-resume` for conversational work?
   - `pnpm run tailor-resume {jobDescriptionPath}` (generates tailored resume)?
   - `pnpm run export {resumePath}` (converts to PDF)?
   - Or one mega script that handles all steps?

5. **Logging & debugging**: How to trace workflow execution (especially for debugging Claude interactions)?

## Resolution

**CLOSED** - Orchestration approach for MVP v1:

**Decision**: Direct Node.js scripts (no LangGraph for MVP v1). Evaluate frameworks in v2.

**Entry points**:
- `/build-profile` - conversational onboarding skill that produces a usable
  Candidate Profile.
- `/build-master-resume <track>` - conversational skill that produces and
  validates one candidate-accepted Master Resume.
- `pnpm run tailor-resume {jobDescriptionPath}` - deterministic orchestration
  around AI generation (Candidate Profile + Master Resume + Job → YAML +
  metadata).
- `pnpm run export-resume {resumePath}` - render YAML to HTML and PDF.

**State management**: Profile Build uses explicit run state rather than file
existence. `session.yml` records status and checkpoints; exact conversation
events live in `transcript.jsonl`; a validated profile draft is promoted to
`candidate/profile.yml`. Master Resume Build similarly distinguishes draft,
eval report, and accepted `resume.yml`. Scripted downstream steps use explicit
artifact files and metadata.

**Error handling**: Simple try/catch, user-facing error messages, retry on Claude API failures (with backoff)

**Logging**: Console output + optional file logging for debugging

**When to introduce LangGraph** (v2+):
- Multi-step orchestration that cannot remain clear in direct scripts
- Complex branching/routing (conditional paths based on job/candidate)
- Scraper self-healing loops
- Need for observability/tracing complex flows

**Alternative frameworks evaluated**: LangChain Runnables, Vercel AI SDK, Anthropic tool_runner, Temporal (deferred, overkill for MVP)

**Portable skills**: canonical skill instructions live under
`.agents/skills/`; thin host adapters may expose commands in Claude Code,
Cursor, Codex, or another compatible agent host. The workflow definition is
portable, but tool permissions and command discovery remain host-specific.

**MVP v1 permission boundary**: prompt-injection resistance is best effort.
Skills instruct the agent to behave as if holding no pre-granted
permissions and confirm before any tool use beyond their documented
minimal set — a behavioral instruction, not enforced isolation, since a
skill has no mechanism to rewrite a host's actual granted permissions.
Genuine enforcement would mean tool-scoped subagents instead of in-session
skills; shared narrow capabilities and enforced host adapters are
deferred. See ADR 0004.
