# Scenario 01: baseline

Tests the boundary between Master Resume Build and Profile Build — the
part of the design most likely to get silently bypassed under pressure to
"just fix the wording": a pending claim confirmation and a factual
correction to an existing draft both have to stop the run and redirect to
`/build-profile` rather than being applied directly (`SKILL.md`, "Pending
and factual corrections"). A genuine presentation-only edit is included
too, for contrast, to confirm the rule isn't over-applied.

Unlike Profile Build's scenarios, this one's input is a synthetic
Candidate Profile document (`candidate/profile.yml`) directly — Master
Resume Build takes an already-usable profile, not raw imports, so there's
no `candidate/imports/` here.

## Running it

1. Copy this scenario's whole `candidate/` directory — `profile.yml`,
   `sources/`, and `profile-build/runs/run-20260824-a/` — over a scratch
   `candidate/` directory — **do not** point `/build-master-resume` at
   the real repo's `candidate/` while testing this:
   ```sh
   mkdir -p /tmp/loom-eval-run && cp -r candidate /tmp/loom-eval-run/
   ```
   (or equivalent on Windows) — then run
   `/build-master-resume application-engineering-senior` with that
   directory as the working `candidate/`.

   `candidate/sources/source-manifest.yml`'s `normalized_path` entry is a
   baked-in absolute path (`/tmp/loom-eval-run/candidate/sources/...`),
   matching the copy target above exactly. If you copy to a different
   location, update that one path in the manifest to match, or the
   grounding eval step will fail to resolve the normalized source (not a
   grounding failure — a file-not-found on an unrelated path).
2. Follow `SCRIPT.md` for the three points that need a specific response;
   answer everything else naturally.
3. Once the session reaches promotion (or ends early), check the result
   against `expected-outcomes.yml`.
4. Discard the scratch run — nothing here is meant to persist.

## What this scenario does NOT cover

- A `stretch`/`insufficient` Target Track's aspirational-framing rules —
  this scenario's one track is `strong`. A future scenario should cover
  the weak-readiness path specifically.
- Rebuilding an existing accepted `resume.yml` (the backup-before-
  overwrite path) — this scenario's track has no prior `resume.yml`.

Add more scenarios alongside this one as gaps in coverage turn out to
matter.
