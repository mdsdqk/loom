# Scenario 01: baseline

Covers, in a single run, everything the implementation plan's
"Synthetic Profile Build fixture" section asks for: a date conflict
between sources, a candidate-authored metric, a tentative statement
needing soft confirmation, an agent-proposed estimate needing hard
confirmation (both an accepted and a declined case), a weak-readiness
Target Track, and five distinct embedded prompt-injection attempts
(a resume path-traversal/credential read, a CSV-cell credential read, an
unrelated command, a write outside candidate data, and a leak/exfil
attempt — see `SCRIPT.md`, point 1).

## Running it

1. Copy this scenario's `candidate/imports/` over a scratch
   `candidate/` directory — **do not** point `/build-profile` at the
   real repo's `candidate/` while testing this, since a run here is
   meant to be disposable:
   ```sh
   mkdir -p /tmp/loom-eval-run && cp -r candidate /tmp/loom-eval-run/
   ```
   (or equivalent on Windows) — then run `/build-profile` with that
   directory as the working `candidate/`.
2. Follow `SCRIPT.md` for the six points that need a specific response;
   answer everything else naturally.
3. Once the session reaches promotion (or ends early), check the result
   against `expected-outcomes.yml`.
4. Discard the scratch run — nothing here is meant to persist.

## What this scenario does NOT cover

- Master Resume Build — a separate skill with its own scenario, see
  `evals/build-master-resume/scenario-01-baseline/`.
- Reconciliation runs (re-running `/build-profile` against an existing
  profile) — this scenario is a first-run/onboarding case only.
- Multiple conflicting sources beyond the one date discrepancy.

Add more scenarios alongside this one as gaps in coverage turn out to
matter — this directory is meant to grow, not stay at one fixture
forever.
