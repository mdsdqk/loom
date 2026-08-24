# @loom/tools

Standalone CLI/library utilities used across the `loom` project. Everything
here is TypeScript on Node, built with `tsc`, linted with `eslint`, tested
with `vitest`, and wired into the repo's pnpm + Turborepo workspace.

Current Tools:

- **Parsers** (`pdf-parser`, `csv-parser`) — turn a PDF or CSV/Excel file
  into structured, readable YAML.
- **Profile Build / Master Resume Build support** (`profile-validate`,
  `master-resume-validate`, `source-normalize`,
  `profile-grounding-batches`, `master-resume-grounding-batches`,
  `profile-grounding-result`, `master-resume-grounding-result`) —
  deterministic schema validation, cross-reference checking, source
  normalization, and grounding-eval scaffolding for the `/build-profile`
  and `/build-master-resume` skills (`.agents/skills/`). These CLIs are
  what those skills' `SKILL.md`/`EVAL.md` actually invoke via Bash — see
  those files for how each one fits into the larger workflow, and
  `docs/plans/profile-build-implementation.md` for why this tooling
  exists in the first place.

## Setup

From the repo root:

```sh
pnpm install
```

This installs dependencies for every workspace package, including this one.

## `pdf-parser`

Extracts text from a PDF as a **generic layout dump** — per page, it
reconstructs reading-order lines (by clustering text items with matching
y-coordinates) and paragraphs (by detecting vertical gaps larger than the
page's typical line pitch). It does not attempt to identify sections,
headings, tables, or any document-specific structure.

Built on [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist).

### CLI

Run from inside `tools/` (paths are resolved relative to your shell's cwd,
same as any CLI):

```sh
cd tools

# writes <input-basename>.yaml next to the input file
pnpm pdf-parser path/to/file.pdf

# explicit output path
pnpm pdf-parser path/to/file.pdf -o out.yaml

# print to stdout instead of writing a file
pnpm pdf-parser path/to/file.pdf --stdout
```

From the repo root, use `pnpm --filter @loom/tools pdf-parser <args>`
instead — note that `pnpm run`'s script args don't need a `--` separator
(unlike `npm run`), but the command still executes with `tools/` as its
working directory, so file paths need to be relative to `tools/` (or
absolute).

Once built (`pnpm --filter @loom/tools build`), the same CLI is also
available as a package `bin`, so anything in the workspace can run
`pdf-parser <file>` directly (e.g. via `pnpm exec` or a workspace script).

### Library

```ts
import { parsePdf } from "@loom/tools/src/pdf-parse.js";

const result = await parsePdf("path/to/file.pdf");
```

### Output shape

```yaml
source: file.pdf
pageCount: 2
pages:
  - page: 1
    lines:
      - "Jane Doe"
      - "Software Engineer"
    paragraphs:
      - - "Jane Doe"
        - "Software Engineer"
      - - "Experience"
        - "..."
  - page: 2
    lines: []
    paragraphs: []
    warnings:
      - "No extractable text (possibly a scanned image)"
```

`lines` is the flat reading order for the page; `paragraphs` groups those
same lines by detected vertical gaps. A page with no extractable text (e.g.
a scanned image with no text layer) comes back with empty `lines`/
`paragraphs` and a `warnings` entry — there's no OCR fallback.

## `csv-parser`

Reads a `.csv`, `.xlsx`, or `.xls` file and emits every sheet as a list of
row objects (first row = keys), using
[`xlsx`](https://www.npmjs.com/package/xlsx) (SheetJS) — the same library
handles both plain CSV and real Excel workbooks, including multi-sheet
files and quoted/multi-line cell values.

### CLI

```sh
cd tools

pnpm csv-parser path/to/file.csv
pnpm csv-parser path/to/file.xlsx -o out.yaml
pnpm csv-parser path/to/file.csv --stdout
```

Same repo-root-vs-`tools/`-cwd caveat as `pdf-parser` above applies here.

### Library

```ts
import { parseTabular } from "@loom/tools/src/csv-parse.js";

const result = parseTabular("path/to/file.xlsx");
```

### Output shape

```yaml
source: file.csv
sheets:
  - name: Sheet1
    rowCount: 2
    rows:
      - Company Name: Example Corp
        Title: Software Engineer
        Started On: Jan 2021
        Finished On: Dec 2022
      - Company Name: Sample Industries
        Title: Senior Software Engineer
        Started On: Jan 2023
        Finished On: ""
```

A `.csv` file always comes back as a single synthetic sheet; `.xlsx`/`.xls`
files produce one entry per real sheet in the workbook, in order.

## `profile-validate`

Validates a Candidate Profile YAML document against the schema in
`src/profile/schema.ts` — required fields, slug safety, Source Reference
format, claim lifecycle/confirmation combinations, cross-field
uniqueness, and the `approved_to_build`/`candidate_acknowledged` rule.
Returns a structured result rather than throwing (`validateCandidateProfile`
in `src/profile/validate.ts`), so the CLI and (eventually) a skill's own
eval step get the same thing.

```sh
pnpm --filter @loom/tools profile-validate path/to/profile.yml
```

Exit code 0/1 matches pass/fail; failures print `path: message` per issue.

## `master-resume-validate`

Validates a Master Resume against its own schema *and* cross-references
it against a specific Candidate Profile — every `profile_ref` must
resolve and exactly match, every `evidence_ids` entry must point at an
*active* claim (`src/master-resume/validate.ts`). Needs both files, in
this order:

```sh
pnpm --filter @loom/tools master-resume-validate path/to/resume.yml path/to/profile.yml
```

## `source-normalize`

Turns one raw import (a Markdown/PDF resume, or a LinkedIn CSV) into a
normalized, run-qualified source record under `candidate/sources/`, and
records it in `source-manifest.yml`. CSV rows normalize one-row-per-record;
Markdown/PDF text chunks on blank-line paragraphs — deliberately
mechanical, not an attempt to judge what's a meaningful claim boundary
(`src/source-normalization/normalize.ts`).

```sh
pnpm --filter @loom/tools source-normalize --run <run-id> --source-id <id> --type resume-markdown|resume-pdf|linkedin-csv [--sources-dir <dir>] <import-path>
```

## `profile-grounding-batches` / `master-resume-grounding-batches`

Build the bounded input batches for a grounding eval's judgment half
(`src/grounding-eval/batch.ts`) — one Evidence Claim's statement plus its
resolved source text (Candidate Profile), or one generated prose field
plus its referenced active claims (Master Resume). Neither of these
*calls* a judge model — that's a separate agent dispatch only a skill
session can make (ADR 0003); these just prepare its input.

```sh
pnpm --filter @loom/tools profile-grounding-batches path/to/profile.yml path/to/sources-dir
pnpm --filter @loom/tools master-resume-grounding-batches path/to/resume.yml path/to/profile.yml
```

## `profile-grounding-result` / `master-resume-grounding-result`

The other half: validates a judge's raw response
(`src/grounding-eval/schema.ts`'s `parseJudgeResponse` — never trusted
unvalidated) and combines it with the deterministic pre-check issues into
one final result (`src/grounding-eval/result.ts`). Only a `supported`
verdict passes; `unsupported`/`ambiguous`/`contradicted` all block, same
severity.

```sh
pnpm --filter @loom/tools profile-grounding-result path/to/profile.yml path/to/judge-response.yml
pnpm --filter @loom/tools master-resume-grounding-result path/to/resume.yml path/to/profile.yml path/to/judge-response.yml
```

## Shared CLI conventions

`pdf-parser` and `csv-parser` share the same flags and defaults (via
`src/yaml.ts`):

- First positional argument is the input file path.
- `-o` / `--output <path>` — write YAML to a specific path.
- `--stdout` — print YAML to stdout instead of writing a file.
- With neither flag, output is written to `<input-basename>.yaml` next to
  the input file.

The newer CLIs don't follow this pattern — they're not "transform one
file into YAML next to it" tools, so their arguments are positional and
specific to what each one does (see each section above). What they do
share: `src/yaml.ts`'s `loadYaml`/`emitYaml` helpers underneath, and exit
code 0/1 for pass/fail on every validator.

## Development

```sh
pnpm --filter @loom/tools build   # tsc -> dist/
pnpm --filter @loom/tools lint    # eslint (root config, see ../eslint.config.mjs)
pnpm --filter @loom/tools test    # vitest run
```

Or, from the repo root, `pnpm turbo run build` / `lint` / `test`
builds/lints/tests every workspace package (currently just this one).

Test fixtures live in `test/fixtures/`. They're small, synthetic, and
anonymized on purpose — never copy real personal data (e.g. an actual
resume or LinkedIn export) into a fixture. `test/fixtures/sample.pdf` is a
hand-built, uncompressed PDF (no binary/font-embedding needed for text
extraction); `test/fixtures/positions.csv` and `profile.xlsx` are
synthetic tabular data shaped like real exports without being real data.
Most of the newer tests (`profile/`, `master-resume/`,
`source-normalization/`, `grounding-eval/`) build their fixtures inline
in the test file instead — small enough that a shared file would be more
indirection than it's worth; reach for `test/fixtures/` when a fixture
needs to be a real binary/tabular file, as `pdf-parse`/`csv-parse`'s do.

This is unit-test coverage for the deterministic code in this package —
a different thing from `/evals` at the repo root, which is fixture-based
regression testing for the *skills'* actual conversational behavior
(`.agents/skills/`). See `/evals/README.md` for that distinction in full.

## Layout

```
tools/
  src/
    pdf-parse.ts, pdf-parser-cli.ts        # parsePdf() / `pdf-parser`
    csv-parse.ts, csv-parser-cli.ts        # parseTabular() / `csv-parser`
    yaml.ts                                 # shared loadYaml/emitYaml + CLI-arg parsing
    profile/
      schema.ts            # CandidateProfile (Zod) + inferred types
      validate.ts           # validateCandidateProfile() -- structural + optional dangling-ref check
      validate-cli.ts        # `profile-validate`
    master-resume/
      schema.ts            # MasterResume (Zod) + inferred types
      validate.ts           # validateMasterResume() -- structural + cross-reference against a profile
      validate-cli.ts        # `master-resume-validate`
    source-normalization/
      schema.ts            # NormalizedSource / SourceManifest (Zod)
      normalize.ts           # paragraph/CSV-row -> record normalizers
      manifest.ts            # manifest read/append + resolveSourceRef index
      normalize-cli.ts       # `source-normalize`
    grounding-eval/
      schema.ts            # judge batch-item/response shapes (Zod)
      batch.ts               # buildProfileGroundingBatches / buildMasterResumeGroundingBatches
      result.ts              # combineGroundingResult
      profile-batch-cli.ts, master-resume-batch-cli.ts    # `*-grounding-batches`
      profile-result-cli.ts, master-resume-result-cli.ts   # `*-grounding-result`
  scripts/
    migrate-candidate-imports.sh   # one-off pre-imports/ migration, run manually (sibling of src/, not part of the package's own code)
  test/
    pdf-parse.test.ts, csv-parse.test.ts
    profile-validate.test.ts
    master-resume-validate.test.ts
    source-normalization.test.ts
    grounding-eval.test.ts
    fixtures/
```