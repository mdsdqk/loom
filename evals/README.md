# Evals

Fixture-based regression testing for this project's conversational
skills (`/build-profile`, `/build-master-resume`) — a human (or, later,
an automated harness) runs a skill against a synthetic fixture here and
checks the actual result against that fixture's documented expectations.

**This is a different thing from `tools/src/grounding-eval/` and
`tools/test/`.** Those are runtime library code and unit tests — they
run on every `pnpm test`, check deterministic logic, and never touch a
live model. This directory checks whether the *skills themselves* — the
actual conversational behavior in `SKILL.md` — still do what they're
supposed to, which can only be checked by actually running them. There's
no harness today that can drive a conversational skill unattended, so for
now every fixture here is a **manual acceptance** exercise: a human plays
the candidate, follows the fixture's script, and compares the outcome
against `expected-outcomes.yml`. Automating that is a real future step,
not something skipped by accident — it needs a way to script an agent
session end-to-end, which doesn't exist in this project yet.

## Layout

```text
evals/
  {skill-name}/
    {scenario-name}/
      README.md               # what this scenario tests and how to run it
      candidate/imports/...   # synthetic input files (git-safe, fictional)
      SCRIPT.md                # conversation script, for scenarios that need live dialogue
      expected-outcomes.yml   # what a correct run should produce
```

## Rules for fixture content

- **Fictional only** — no real names, companies, locations, or personal
  details, ever. Same rule as everywhere else in this codebase.
- **Self-contained** — a scenario's `candidate/imports/` is a complete,
  runnable input set on its own; running a skill against it shouldn't
  require anything from the real, gitignored `candidate/` directory.
- **Expectations describe invariants, not exact wording** — "this claim
  must end up `active` with `confirmation: implicit`," not "the summary
  must say these exact words." Model output varies run to run; the
  structural/grounding properties shouldn't.
