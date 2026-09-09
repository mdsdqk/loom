# @loom/tools

Standalone CLI/library utilities used across the `loom` project. Everything
here is TypeScript on Node, built with `tsc`, tested with `vitest`, and
wired into the repo's pnpm + Turborepo workspace.

Three groups of tools live here:

- **`pdf-parser` / `csv-parser`** — turn a PDF or a CSV/Excel file into
  structured, readable YAML that's easy to diff, grep, or feed into something
  smarter downstream.
- **`create-opportunity` / `build-resume`** — turn a master resume and a job
  description into a per-opportunity workspace and a rendered PDF.
- **Network Scan** (`network-*`) — turn a LinkedIn export into a dump of open
  jobs at the companies your network works at.

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

## Resume artifacts

Two CLIs turn a master resume plus a job description into a per-opportunity
workspace and a rendered PDF.

### `create-opportunity`

Creates `opportunities/<slug>/` from a job description and a master resume, so
each application has its own isolated workspace.

```sh
cd tools

pnpm create-opportunity ../candidate/resume.yml path/to/jd.md

# override anything the JD does not state clearly
pnpm create-opportunity ../candidate/resume.yml jd.md --company "Acme" --role "Senior Engineer"
pnpm create-opportunity ../candidate/resume.yml jd.md --job-id R12345
pnpm create-opportunity ../candidate/resume.yml jd.md --opportunities-root ../opportunities
```

It writes:

```text
opportunities/<company>-<role>[-<job-id|posted-date>]/
  meta.yml                 # company, role, job_id, posted_date
  artifacts/
    jd.md                  # copy of the job description
    resume.yml             # copy of the master resume, ready to tailor
```

Company and role are read from the JD by **deterministic heuristics**, not a
model: labelled lines first (`Company:`, `Title:`, `Role:`), then the first
heading split on ` at `, ` - `, ` — ` or `|`. A job ID or posting date, when
present, disambiguates the slug so two openings at the same company for the
same title do not collide. If neither heuristic yields both fields it fails
rather than guessing — pass `--company` and `--role` explicitly in that case.

An existing opportunity directory is never overwritten; the command errors
instead, so a tailored resume already in progress cannot be clobbered.

### `build-resume`

Validates a `resume.yml` and renders it to PDF (Nunjucks template + Playwright
print-to-PDF).

```sh
cd tools

pnpm build-resume ../opportunities/acme-senior-engineer/artifacts/resume.yml
pnpm build-resume path/to/resume.yml -o out.pdf
```

**Validation gates rendering.** On a schema error nothing is written — every
issue is listed as `path: message` and the command exits non-zero — so a
previously good PDF survives a broken edit rather than being replaced by a
malformed one.

With no `-o`, the output is named from context, beside the input:

```text
resume-<candidate>-<role>.pdf
```

The candidate part prefers `preferred_name` from `candidate/meta.yml` and falls
back to `metadata.name` in the resume itself; the role comes from the
opportunity's `meta.yml`. Both metadata files are optional — the role is simply
omitted when absent, and only a resume with no name at all falls all the way
back to `resume.pdf`.

`resume.yml` is a plain, self-contained resume — `metadata`, `summary`,
`experience`, `skills`, `projects`, `education`, `recognition`. There are no
evidence IDs or grounding checks at this layer. Bullet text supports `**bold**`
as its only inline markup; everything else is HTML-escaped.

## Network Scan

A staged pipeline that turns a LinkedIn data export into a dump of open jobs
at the companies the candidate's network works at. Every stage is deterministic
code — there is no model anywhere in it.

Each stage is its own CLI reading and writing one YAML artifact, so a stage can
be re-run without repeating the ones before it. Discovery is slow and partly
unreliable; re-crawling everything because one later step failed is not an
option.

```text
LinkedIn export dir
  → network-import    → network.yml         (offline: companies + candidate signal)
  → network-domains   → domains.yml         (verified corporate domains)
  → network-discover  → hiring-sources.yml  (careers page + applicant-tracking system)
  → network-jobs      → jobs.yml            (open jobs, normalized and deduplicated)
  → network-report    → report.md           (funnel + referral leverage)
```

Every CLI takes `-c/--candidate <dir>` to choose whose workspace it operates on,
or reads `LOOM_CANDIDATE_DIR`, defaulting to `../candidate`. Nothing is tied to
a particular person: the export is the input, and the artifacts hang off the
candidate directory. Long runs are resumable, and every stage can be re-run on
its own.

### `network-import`

Reads the whole export directory, not just `Connections.csv`. Groups
connections into companies and attaches the signal the candidate's own export
already carries: jobs they saved, companies they follow, places they worked and
studied, and the target titles and locations they configured on LinkedIn.

```sh
cd tools
pnpm network-import path/to/Basic_LinkedInDataExport_MM-DD-YYYY
pnpm network-import path/to/export --stdout
```

Company grouping collapses variants that differ only by legal form
(`Contoso Inc.` / `Contoso Pvt Ltd`), a parenthetical expansion, or a corporate
relationship tail (`Finflux - An M2P Company` / `Finflux - By M2P`). It never
merges two names on similarity alone — near-miss pairs like `Amazon` and
`Amazon Web Services` land in a `review:` list for a human to judge, because
conflating distinct employers produces confidently wrong referral targets.

Runs entirely offline. Given the same export it produces identical output apart
from the timestamp.

### `network-domains`

Resolves each company to its corporate domain, consulting the registry first
and otherwise guessing a bounded set of candidates.

```sh
pnpm network-domains
pnpm network-domains --limit 25 --no-registry-write   # sample run
pnpm network-domains --min-connections 3              # skip the long tail
pnpm network-domains --fresh                          # ignore prior output
```

Runs are **resumable**. Results are checkpointed to the output file after every
batch (`--batch`, default 25), and a re-run skips companies already present, so
an interrupted or failed scan costs one batch rather than the whole thing.
`--fresh` starts over. This matters in practice: a full network is a long job
against hundreds of unrelated servers, and something always misbehaves.

**A guessed domain is only accepted once the site confirms whose it is.** The
page has to name the company in its `<title>`, `og:site_name`, or
`application-name` — every distinguishing token of the name, not just the
first. Domain marketplaces are rejected outright, as are redirects landing on
an unrelated domain: a for-sale listing puts the domain in its own title, so
name matching alone would happily accept it. Anything unconfirmed stays
`unresolved` with every attempt and its reason recorded, so a missing company
can be explained rather than guessed at.

Newly verified domains are folded back into
`src/network-scan/registry/company-domains.yml`, which is checked in. It holds
public company-to-domain mappings and no personal data, and hand-written
entries always outrank anything the scanner discovers — which is how acronym
names (`hpe.com`) and bot-protected sites get resolved.

Outbound requests go through one shared client (`src/network-scan/http/`):
bounded concurrency, one request at a time per host with a delay between them,
capped response sizes, bounded retries, `robots.txt` respected, and an on-disk
cache under `.cache/` that makes a re-run nearly free. Nothing in it works
around rate limits, bot protection, or access controls — a blocked response is
recorded as a failure and the scan moves on.

Run artifacts are written under `candidate/network-scan/`, which is gitignored:
`network.yml` contains connections' names and profile URLs.

### `network-discover`

Finds each company's careers page and identifies which applicant-tracking
system it runs on.

```sh
pnpm network-discover
pnpm network-discover --limit 50          # sample run
pnpm network-discover --min-connections 3 # skip the long tail
pnpm network-discover --browser           # render pages that need JavaScript
```

Discovery runs cheapest-first and stops at the first page that reads like a
careers page: `sitemap.xml`, then careers links on the homepage, then a small
fixed list of conventional paths. It never crawls — an unbounded crawler over
hundreds of employer sites is slow and rude, and the careers page is nearly
always one hop away. Page fetches are capped per company.

The page is then fingerprinted against every registered adapter, plus markers
for systems there is no adapter for yet (Darwinbox, Keka, Zoho Recruit,
Eightfold, iCIMS, SuccessFactors, Taleo and others). Those are recorded with
their account token, so adding the adapter later needs no re-crawl.

**A board is attributed to a company only when the company vouches for it or
the provider does.** Being linked from the company's own careers page is the
strong case. Where a provider exposes board metadata, the board's self-reported
employer is checked too, and *any* failed check disqualifies the board — both
the board naming a different employer and the board not existing at all. That
second case is not hypothetical: a live run fingerprinted placeholder text on a
careers page as a Greenhouse board literally named `this_part`, and only the
existence check kept it out.

With `--browser`, a careers page that exposes no provider in its static HTML is
rendered once with Playwright, and both the resulting DOM and the URLs it
requested are fingerprinted. Many large employers only reveal their board after
scripts run. The browser is a discovery instrument and never a fetching path:
what it finds goes to the registry, and it is not launched for that company
again. It identifies itself with the same user agent as the HTTP client and does
not attempt to defeat bot protection.

### `network-jobs`

Fetches open jobs from every hiring source with a known provider.

```sh
pnpm network-jobs
pnpm network-jobs --max-pages 20   # cap large boards
```

Paginates where the provider paginates, with a page cap per source (`--max-pages`)
so one enormous board cannot dominate a run. Boards cut short by that cap are
counted separately and reported, because their job counts are floors rather than
totals. One broken board is recorded as a failure and the scan continues.

Jobs are deduplicated by provider job id, then canonical URL, then a
company/title/location digest — never by title alone, since two genuinely
different "Senior Software Engineer" roles can be open at once.

Each job is tagged against the candidate's own declared LinkedIn job-seeker
preferences (`matches_preferences`). That is a view, not a filter: every job is
kept. It is plain token matching, no model and no ranking.

### `network-report`

Writes `report.md`: a **funnel** showing where companies were lost and why, and
a **leverage** view ranking what was found by how much referral access the
candidate actually has — connection count and seniority, jobs they saved,
companies they follow, former employers and alma maters.

The funnel is the point of the breadth-first design. Without it, "jobs found at
300 of 649 companies" is a shrug; with it, the next worthwhile improvement is
obvious.

### Adding a provider

One file under `src/network-scan/providers/` implementing `ProviderAdapter`,
plus one line in `providers/index.ts`. Discovery, fetching, deduplication and
reporting all work against the interface and need no change. `normalize` is
pure — no network, no clock — so each adapter is tested against a captured
fixture.

## CLI conventions

**`pdf-parser` and `csv-parser`** share the argument handling in `src/yaml.ts`:

- First positional argument is the input file path.
- `-o` / `--output <path>` — write YAML to a specific path.
- `--stdout` — print YAML to stdout instead of writing a file.
- With neither flag, output is written to `<input-basename>.yaml` next to
  the input file.

**The resume and network-scan CLIs** use [`commander`](https://www.npmjs.com/package/commander)
and each document their own flags above. Common to all of them:

- `-o` / `--output <path>` overrides the default output location.
- Failures print to stderr and set a non-zero exit code; stdout carries the
  result, so the commands compose in a shell pipeline.
- Every network-scan CLI accepts `-c` / `--candidate <dir>`, or reads
  `LOOM_CANDIDATE_DIR`, to pick whose workspace it operates on.

Every command is run from `tools/` in the examples above. From the repo root,
use `pnpm --filter @loom/tools <command>` — `pnpm run` needs no `--` separator
for script args, but the command still executes with `tools/` as its working
directory, so relative paths resolve from there. After
`pnpm --filter @loom/tools build`, each CLI is also available as a package
`bin`.

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
    pdf-parse.ts             # parsePdf()
    pdf-parser-cli.ts        # `pdf-parser`
    csv-parse.ts             # parseTabular() / parseDelimitedText()
    csv-parser-cli.ts        # `csv-parser`
    yaml.ts                  # shared YAML-output + CLI-arg helpers
    create-opportunity-cli.ts   # `create-opportunity`
    build-resume-cli.ts         # `build-resume`
    resume/
      opportunity.ts         # JD parsing, slugging, workspace creation
      build.ts               # validate-then-render
      renderer.ts            # Nunjucks + Playwright -> PDF
      schema.ts              # Zod resume schema
      templates/, styles/
    network-scan/
      import/                # `network-import` (offline export ingest)
      http/                  # shared client, robots.txt
      providers/             # one file per applicant-tracking system
      domains.ts             # `network-domains`
      careers.ts, fingerprint.ts, discover.ts, browser-probe.ts
      jobs.ts                # fetch, normalize, dedupe
      report.ts              # funnel + leverage report
      registry/              # checked-in company -> domain / ATS knowledge
  test/
    fixtures/                # synthetic only — never real personal data
```

This is intentionally a single flat package rather than one package per
tool — there isn't (yet) enough going on here to justify separate
workspace packages per parser. New tools should generally be added as more
files in `src/` (e.g. `docx-parse.ts` + `docx-parser-cli.ts`), following
the same `<thing>-parse.ts` / `<thing>-parser-cli.ts` naming split. Only
carve out subfolders or new packages once the flat layout actually starts
to hurt.
