# @loom/tools

Standalone CLI/library utilities used across the `loom` project. Everything
here is TypeScript on Node, built with `tsc`, tested with `vitest`, and
wired into the repo's pnpm + Turborepo workspace.

**`pdf-parser`** and **`csv-parser`** - turn a PDF or a CSV/Excel file into structured, readable YAML
that's easy to diff, grep, or feed into something smarter downstream.

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

Built on [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) (the
engine behind Firefox's PDF viewer).

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

## Shared CLI conventions

Both CLIs (`src/yaml.ts`) share the same flags and defaults:

- First positional argument is the input file path.
- `-o` / `--output <path>` — write YAML to a specific path.
- `--stdout` — print YAML to stdout instead of writing a file.
- With neither flag, output is written to `<input-basename>.yaml` next to
  the input file.

## Development

```sh
pnpm --filter @loom/tools build   # tsc -> dist/
pnpm --filter @loom/tools test    # vitest run
```

Or, from the repo root, `pnpm turbo run build` / `pnpm turbo run test`
builds/tests every workspace package (currently just this one).

Test fixtures live in `test/fixtures/`. They're small, synthetic, and
anonymized on purpose — never copy real personal data (e.g. an actual
resume or LinkedIn export) into a fixture. `test/fixtures/sample.pdf` is a
hand-built, uncompressed PDF (no binary/font-embedding needed for text
extraction); `test/fixtures/positions.csv` and `profile.xlsx` are
synthetic tabular data shaped like real exports without being real data.

## Layout

```
tools/
  src/
    pdf-parse.ts        # parsePdf()
    pdf-parser-cli.ts    # `pdf-parser` CLI entry
    csv-parse.ts         # parseTabular()
    csv-parser-cli.ts    # `csv-parser` CLI entry
    yaml.ts               # shared YAML-output + CLI-arg parsing helper
  test/
    pdf-parse.test.ts
    csv-parse.test.ts
    fixtures/
```

This is intentionally a single flat package rather than one package per
tool — there isn't (yet) enough going on here to justify separate
workspace packages per parser. New tools should generally be added as more
files in `src/` (e.g. `docx-parse.ts` + `docx-parser-cli.ts`), following
the same `<thing>-parse.ts` / `<thing>-parser-cli.ts` naming split. Only
carve out subfolders or new packages once the flat layout actually starts
to hurt.
