# Evaluating a Master Resume draft

Same two-check order as Profile Build's evaluation (see
`/CONTEXT.md`, Eval severity tiers) — deterministic first, judgment
second, never the reverse.

**Every command below needs absolute paths.** `pnpm --filter @loom/tools <cli>`
always runs with `tools/` as its cwd, not the repo root — a bare relative
`candidate/...` path resolves to `tools/candidate/...`, which doesn't
exist. Resolve every `candidate/...` path to absolute before passing it.

## 1. Schema and cross-reference validation (deterministic, blocking)

```sh
pnpm --filter @loom/tools master-resume-validate <absolute-path>/candidate/tracks/{track}/resume.draft.yml <absolute-path>/candidate/profile.yml
```

Unlike Profile Build's schema check, this one is a genuine cross-document
validation — it needs the actual Candidate Profile, not just the draft's
own shape. It checks: the draft's own structure, every `profile_ref`
resolves and **exactly matches** the referenced Candidate Profile record
(see `MASTER-RESUME-SCHEMA.md`), and every `evidence_ids` entry points at
an **active** Evidence Claim — a reference to a `pending`, `rejected`, or
`superseded` claim fails here, it's not a softer case for the judge to
weigh in on. Exit code 0 = pass. Fix and re-run before touching the
grounding eval.

## 2. Grounding eval (judgment-based, blocking, separate cheaper model)

Only runs once step 1 passes. Same ADR 0003 rule as Profile Build: a
**separate agent invocation**, cheaper model where the host exposes one,
falling back to the session's own model rather than skipping the eval.

**Building the judge's input:**

```sh
pnpm --filter @loom/tools master-resume-grounding-batches <absolute-path>/candidate/tracks/{track}/resume.draft.yml <absolute-path>/candidate/profile.yml <absolute-path>/candidate/sources <absolute-path>/candidate/profile-build/runs
```

The third and fourth arguments resolve the `source:`/`transcript:`
references a cited Evidence Claim itself points at — the judge gets the
actual candidate-controlled corpus behind each claim, not just the
claim's own statement in isolation (ADR 0003, ticket 009). The fourth
argument is the whole `runs/` directory, not one specific run — a cited
Evidence Claim can originate from any Profile Build run that fed into the
current Candidate Profile, not only the most recent one.

This validates the Candidate Profile first (refusing to build batches
against an invalid one), then batches every *generated prose* field —
summary, intros, bullets, project descriptions, recognition — against
its referenced active Evidence Claims *and* the sources/transcript events
those claims cite. `profile_ref` fields are **not** included; those were
already checked exactly in step 1 and don't need judgment.

Give the judge subagent these batches and this instruction:

> For each item, decide whether `claim_text` is actually supported by the
> given evidence. The text may combine, summarize, or reframe the
> evidence — but it must not strengthen ownership, causality, magnitude,
> organizational scope, adoption, recency, or certainty beyond what the
> evidence states. Return one verdict per item.

Save the response matching this shape before combining results — a
malformed response is rejected, not trusted:

```yaml
verdicts:
  - output_path: "experience[0].bullets[0]"
    verdict: supported | unsupported | ambiguous | contradicted
    evidence_ids: []
    source_refs: []
    explanation: "..."
overall: pass | fail
```

**Combining results:**

```sh
pnpm --filter @loom/tools master-resume-grounding-result <absolute-path>/candidate/tracks/{track}/resume.draft.yml <absolute-path>/candidate/profile.yml <absolute-path-to-judge-response.yml>
```

Re-validates the draft (step 1), validates the judge response, and merges
both. Only `supported` passes — `unsupported`/`ambiguous`/`contradicted`
all block, same severity as a schema failure. **Coverage is checked, not
just assumed**: this CLI independently rebuilds the expected batch list
and confirms the judge actually returned a verdict for every generated
prose field — an empty or truncated judge response fails rather than
silently passing, and a declared `overall: fail` blocks even if every
individual verdict happens to say `supported`. Exit code 0/1.

## On a blocking failure

A schema/cross-reference failure or a non-`supported` verdict means: fix
the draft directly if it's a wording problem within what the evidence
already supports, or — if the underlying fact itself needs to change —
**stop this run** and follow the `/build-profile` reconciliation path
first (see `SKILL.md`, "Pending and factual corrections"). Never edit
wording just to make a check pass without the underlying fact actually
being true. Re-run both checks after any change.

## Writing the result

Save the combined result to `resume.draft.eval.yml` alongside the draft
before presenting it to the candidate or attempting promotion.
