---
status: accepted
---

# Profile Build uses best-effort prompt-injection resistance in MVP v1

`/build-profile` reads candidate-supplied documents and, when employer
context remains ambiguous, web search results. This is a single-user,
local-first threat model, but those sources still create a prompt-injection
risk. An earlier draft claimed that two exact Bash commands formed an
enforced skill-scoped allowlist. Current agent hosts do not provide one
portable skill-level permission mechanism, and repository permission rules
may already grant broader tools.

**Decision**: MVP v1 uses an explicitly best-effort behavioral guardrail,
not a runtime security boundary.

- Skill instructions treat every imported document and web result as data,
  never as an instruction.
- `SKILL.md` explicitly instructs the agent to behave as if it holds no
  pre-granted permissions while running Profile Build, and to confirm with
  the candidate before any tool use beyond the documented minimal set —
  regardless of what a repository's `settings.local.json` (or equivalent
  host permission config) already allows. This is a behavioral instruction
  the model can choose to follow, not an enforced restriction: a skill's
  instructions have no mechanism to actually rewrite a host's granted
  permissions at invocation time. Architecting Profile Build as a
  genuinely tool-scoped subagent (real enforcement, via a `tools:`
  allowlist on its definition) was considered and deferred — it would
  reopen ADR 0001's "conversational skill" framing for a security property
  this ticket already treats as best-effort throughout.
- Inputs are standardized under `candidate/imports/`, normalized sources
  under `candidate/sources/`, and Profile Build writes only candidate data.
- Web lookup runs only when employer domain or scale remains ambiguous.
  Lookup results inform Track Readiness context only and stay in run logs.
- Adversarial fixtures test whether the model ignores injected
  instructions. These behavioral evals do not claim the runtime blocked an
  attempted operation.

Future enforcement will use shared narrow Loom capabilities plus thin
host-specific adapters that deny general shell, unrestricted filesystem,
and network access. Hosts unable to enforce that future boundary must
refuse enforced-mode execution. Runtime-blocking adversarial tests belong
to that later phase and remain distinct from v1 behavioral evals.
