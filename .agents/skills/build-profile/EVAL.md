# Evaluating a Candidate Profile draft

Two checks, run in this order — never skip straight to the second one,
since it's more expensive and the first one already catches most
mechanical problems for free (see `CONTEXT.md`, Eval severity tiers).

**Every command below needs absolute paths.** `pnpm --filter @loom/tools <cli>`
always runs with `tools/` as its cwd, not the repo root — a bare relative
`candidate/...` path resolves to `tools/candidate/...`, which doesn't
exist. Resolve every `candidate/...` path to absolute before passing it.

## 1. Schema validation (deterministic, blocking)

```sh
pnpm --filter @loom/tools profile-validate <absolute-path>/candidate/profile-build/runs/{run-id}/profile.draft.yml <absolute-path>/candidate/sources <absolute-path>/candidate/profile-build/runs
```

The second and third arguments (sources dir, the `runs/` directory — its
parent, not this one run's subdirectory) are what let it actually catch a
**dangling** Source Reference — a claim citing a `source:` or `transcript:`
record that doesn't really exist — not just check the ref's string format.
Omitting either arg silently narrows the check to format-only for that ref
kind; always pass both here.

Pass the whole `runs/` directory, not just `runs/{run-id}/`: reconciliation
keeps prior claims and their original `transcript:{run-id}#{event-id}`
refs from earlier runs (ADR 0005, "does not erase history"), so resolving
them means indexing every run under `runs/`, not just the one currently
in progress.

This checks: required fields, slug safety, Source Reference format,
run-qualification, *and resolution* (with both args given), claim
lifecycle/confirmation combinations, cross-field uniqueness,
demonstrated-skill-needs-active-evidence, and `approved_to_build`
requiring `candidate_acknowledged`. Exit code 0 = pass. Any failure here
is blocking — fix the draft and re-run before touching the grounding eval
at all.

## 2. Grounding eval (judgment-based, blocking, separate cheaper model)

Only runs once schema validation passes. This is where ADR 0003 applies:
**dispatch a separate agent invocation** to judge the draft, not a
self-check by the same conversation that produced it. Use a cheaper
available model if the host exposes one; if not, fall back to the
session's own model rather than skipping the eval (ADR 0003).

**Building the judge's input** — use the `profile-grounding-batches` CLI,
not hand-assembled prompts:

```sh
pnpm --filter @loom/tools profile-grounding-batches <absolute-path>/candidate/profile-build/runs/{run-id}/profile.draft.yml <absolute-path>/candidate/sources <absolute-path>/candidate/profile-build/runs
```

The third argument is the `runs/` directory — its parent, covering every
`{run-id}/` subdirectory, not just the one in progress. Each run's
`session.yml` (for `run_id`) and `transcript.jsonl` are what resolve an
interview-origin claim's `transcript:{run-id}#{event-id}` reference to the
candidate's actual words, and a claim can cite an event from any prior
run, not only the current one — reconciliation keeps earlier runs' claims
and their original refs (ADR 0005). Without this argument, every such
reference resolves to empty text and the judge is asked whether a claim
is supported by nothing — this argument isn't optional in practice, even
though `source-normalize`'s directory (arg 2) is technically already
required.

This validates the draft (refusing to build batches for an already-invalid
profile), resolves every referenced normalized source via
`candidate/sources/source-manifest.yml`, and prints the batches as YAML.
It's built on `buildProfileGroundingBatches` from
`tools/src/grounding-eval/batch.ts` — reach for that module directly only
if you're writing new tooling, not as part of running this skill.

**Known limit**: the output is one flat list, not size-bounded chunks. For
a long career history with many active claims, this could exceed what's
reasonable to hand a single judge call in one shot. If that happens in
practice, split the batches list into smaller groups yourself and run the
judge multiple times, merging the verdicts before combining results — this
isn't automated yet.

Each batch item is one **active** Evidence Claim's `statement` plus its
resolved source/transcript text — `pending` claims are excluded here on
purpose: a pending claim isn't confirmed as true yet, so it shouldn't be
forced through this blocking pass/fail gate (see `GAP-CHECKLIST.md` — an
unresolved pending claim is a non-blocking gap for `usable_with_gaps`,
not a failure). Give the judge subagent these batches and this
instruction:

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
hand-merged output. Same two extra arguments as `profile-grounding-batches`
above, and for the same reason — omit them and dangling-reference
checking silently narrows to nothing:

```sh
pnpm --filter @loom/tools profile-grounding-result <absolute-path>/candidate/profile-build/runs/{run-id}/profile.draft.yml <absolute-path-to-judge-response.yml> <absolute-path>/candidate/sources <absolute-path>/candidate/profile-build/runs
```

Re-validates the draft, validates the judge response (`parseJudgeResponse`
from `tools/src/grounding-eval/schema.ts` — rejects a malformed response
rather than trusting it), and merges both via `combineGroundingResult`
(`tools/src/grounding-eval/result.ts`). Only `supported` passes;
`unsupported`/`ambiguous`/`contradicted` are all blocking, same severity —
no partial credit. **Coverage is checked, not just assumed**: this CLI
independently rebuilds the expected batch list and confirms the judge
actually returned a verdict for every item — an empty or truncated judge
response (`verdicts: []`) fails rather than silently passing, and a
declared `overall: fail` blocks even if every individual verdict happens
to say `supported`. Exit code 0/1 matches pass/fail, same convention as
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
