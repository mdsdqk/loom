# Loom

An AI-assisted platform for job searching and career growth. Loom maintains a
persistent, rich understanding of a candidate — experiences, projects,
skills, evidence, and preferences — and uses that understanding to help them
tailor resumes to specific opportunities.

Deterministic software handles predictable work; AI handles ambiguity,
reasoning, interpretation, and generation. See `docs/PRD.md` for the full
product thesis and `CONTEXT.md` for current domain terminology and truth
rules.

> **Current scope:** MVP v1 is a single-user, local workflow: Candidate
> Profile build, per-track Master Resume build, tailoring for a supplied job
> description, review, and PDF export. See `docs/wayfinding/map-v1.md` for
> the authoritative MVP spec. Job discovery, matching, application tracking,
> and the end-user web experience are later work.

## Repo layout

```
apps/web/       Opportunity portal (Vite + React client, Hono API)
tools/          Standalone CLI/library utilities (pdf-parser, csv-parser)
opportunities/  One directory per opportunity: meta.yml + artifacts/
candidate/      One candidate's workspace: profile, resumes, imports
docs/           Product docs, ADRs, wayfinding maps
loom.config.yml Portal settings (stall thresholds); optional
CONTEXT.md      Domain model and terminology
```

This is a pnpm + Turborepo workspace (see `pnpm-workspace.yaml`).

## Setup

```sh
pnpm install
```

## Common commands

Run from the repo root:

```sh
pnpm build   # turbo run build
pnpm test    # turbo run test
pnpm lint    # turbo run lint
```

Use `pnpm --filter <package> <script>` to target a single workspace package,
e.g. `pnpm --filter @loom/tools test`.

## Packages

- **`tools/`** — `@loom/tools`, CLI/library utilities for turning PDFs and
  CSV/Excel files into structured YAML. See `tools/README.md` for details.
- **`apps/web/`** — `@loom/web`, the opportunity portal. A Vite + React client
  over a Hono API, reading and writing `opportunities/` through `@loom/tools`.
  Run it with `pnpm --filter @loom/web dev`.

## License

MIT — see [LICENSE](LICENSE).
