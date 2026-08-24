# Evaluating a Candidate Profile draft

Two checks, run in this order — never skip straight to the second one,
since it's more expensive and the first one already catches most
mechanical problems for free (see `CONTEXT.md`, Eval severity tiers).

## 1. Schema validation (deterministic, blocking)

```sh
pnpm --filter @loom/tools profile-validate candidate/profile-build/runs/{run-id}/profile.draft.yml
```

This alone checks: required fields, slug safety, Source Reference format
and run-qualification, claim lifecycle/confirmation combinations,
cross-field uniqueness, demonstrated-skill-needs-active-evidence, and
`approved_to_build` requiring `candidate_acknowledged`. Exit code 0 =
pass. Any failure here is blocking — fix the draft and re-run before
touching the grounding eval at all.

## 2. Grounding eval (judgment-based, blocking, separate cheaper model)

Only runs once schema validation passes. This is where ADR 0003 applies:
**dispatch a separate agent invocation** to judge the draft, not a
self-check by the same conversation that produced it. Use a cheaper
available model if the host exposes one; if not, fall back to the
session's own model rather than skipping the eval (ADR 0003).

**Building the judge's input** — use the `profile-grounding-batches` CLI,
not hand-assembled prompts:

```sh
pnpm --filter @loom/tools profile-grounding-batches candidate/profile-build/runs/{run-id}/profile.draft.yml candidate/sources
```

This validates the draft (refusing to build batches for an already-invalid
profile), resolves every referenced normalized source via
`candidate/sources/source-manifest.yml`, and prints the batches as YAML.
It's built on `buildProfileGroundingBatches` from
`tools/src/grounding-eval/batch.ts` — reach for that module directly only
if you're writing new tooling, not as part of running this skill.

Each batch item is one `active`/`pending` Evidence Claim's `statement`
plus its resolved source text. Give the judge subagent these batches and
this instruction:

> For each item, decide whether `claim_text` is actually supported by the
> given sources. The claim may combine, summarize, or reframe the source
> text — but it must not strengthen ownership, causality, magnitude,
> organizational scope, adoption, recency, or certainty beyond what the
> sources state. Return one verdict per item.

**Expected response shape** — save the judge's response to a file matching
this shape before combining results; a malformed response is rejected,
not trusted:

```yaml
verdicts:
  - output_path: "experience[0].evidence[0].claims[0]"
    verdict: supported | unsupported | ambiguous | contradicted
    evidence_ids: []
    source_refs: ["source:run-20260824-a:sample-resume#para-3"]
    explanation: "..."
overall: pass | fail
```

**Combining results** — use the `profile-grounding-result` CLI, not
hand-merged output:

```sh
pnpm --filter @loom/tools profile-grounding-result candidate/profile-build/runs/{run-id}/profile.draft.yml <path-to-judge-response.yml>
```

Re-validates the draft, validates the judge response (`parseJudgeResponse`
from `tools/src/grounding-eval/schema.ts` — rejects a malformed response
rather than trusting it), and merges both via `combineGroundingResult`
(`tools/src/grounding-eval/result.ts`). Only `supported` passes;
`unsupported`/`ambiguous`/`contradicted` are all blocking, same severity —
no partial credit. Exit code 0/1 matches pass/fail, same convention as
every other `@loom/tools` validator.

## On a blocking failure

A non-`supported` verdict means: either remove the claim, or raise a new
clarifying question with the candidate and update the Candidate Profile
draft *first* — never edit the claim's wording just to make it pass the
judge without the underlying fact actually changing. Re-run both checks
after any change; don't assume a fix worked.

## Writing the result

Save the combined result to `profile.eval.yml` alongside the draft (see
`SESSION-SCHEMA.md`) before attempting promotion.
