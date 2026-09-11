# Network Scan — implementation plan

## Context

The goal is a referral pipeline: find which companies the candidate's LinkedIn
network works at, and pull every open job at those companies. Matching,
ranking, and outreach drafting come later. This milestone is purely
deterministic code — no LLM anywhere in the pipeline.

Two scratch documents exist (`docs/.scratch/`). They are informational only.
This plan is built from measurements against the candidate's real export and
live ATS endpoints, taken during planning. The measurements contradict the
scratch docs in three places that matter, and reveal product signal both docs
ignore.

### What was measured

**Slug guessing does not work.** The scratch implementation doc's core
mechanism (`trySlugVariants(companyName)` per provider, first job list wins)
was probed against the 45 highest-connection companies: 5 hits, 4 of them the
wrong company. `collins.recruitee.com` returns 106 KFC Netherlands restaurant
jobs, not Collins Aerospace. The `google`/`accenture`/`ey` Recruitee boards are
abandoned trial accounts serving Recruitee's own "Senior Marketer (Sample)"
demo posting. One real hit (Okta) in 45.

**But guess-then-verify does work.** `boards-api.greenhouse.io/v1/boards/{token}`
returns the board's real name; `collins` 404s, `razorpaysoftwareprivatelimited`
returns "Razorpay Software Private Limited". Recruitee reports
`company_name: "KFC Nederland (CFE)"` for `collins`. SmartRecruiters returns
`company.name` per posting. Every false positive above is rejectable by a name
check plus a demo-board guard. Guessing is safe as a *supplementary* path only
when the account self-identifies and the name matches.

**Domain-first discovery finds accounts guessing cannot.**
`razorpay.com/careers` → Greenhouse `razorpaysoftwareprivatelimited` → 24 live
jobs; the guessable `razorpay` 404s. `freshworks.com/careers` →
SmartRecruiters `Freshworks` → 153 jobs. Real account IDs are legal entity
names and case-sensitive strings.

**The provider priority in both docs is wrong for this network.** 948
connections, 653 companies, top-heavy with enterprise and Indian employers:
M2P Fintech 33, Amazon 15, Collins Aerospace 11, Microsoft 11, IBM 10, EY 8,
AWS 8, Google 7. Verified live: Workday's public `cxs` API returns NVIDIA 2000
jobs, Salesforce 1451, PayPal 89. `amazon.jobs/en/search.json` is public with
10000+ hits. Greenhouse/SmartRecruiters cover the Indian product companies but
not the enterprises. **Workday is the highest-yield first adapter, not Ashby.**

**Two failure modes need designing in.** `netapp.com/careers` returns 403 to a
plain client. `m2pfintech.com` and `postman.com` return an identical ~240KB SPA
shell for every careers path with no ATS marker in static HTML — and M2P is the
#1 company by connection count.

### Product signal both scratch docs miss

Both docs read only `Connections.csv`. The export contains more, all
deterministically parseable:

- `Jobs/Job Seeker Preferences.csv` — the candidate's own declared target
  titles (Full Stack Engineer, Javascript Developer, Web Developer, Frontend
  Developer, Software Engineer), locations (Bengaluru, Dubai, Mumbai, Europe),
  job types, and `ACTIVELY_SEEKING` status. A candidate-authored job filter
  requiring zero inference and no `profile.yml` dependency.
- `Jobs/Saved Jobs.csv` — 61 saved jobs across 54 companies. **19 of those
  companies are in the network**: Razorpay (4 connections, 2 saved),
  Qualcomm (5), OpenText (5), LSEG (5), Caterpillar (4), NVIDIA (3),
  Persistent (3), Okta, Cadence, Rippling, PhonePe, Uber, SAP, and more.
  Demonstrated intent ∩ referral access, with no inference at all.
- `Company Follows.csv` — 69 followed orgs, 9 in-network. Declared interest.
- `Positions.csv` — the candidate worked at Finflux/M2P, which is also the #1
  network company (33 connections). Ex-colleagues are the strongest referral
  path that exists.
- `Education.csv` — PES University; alumni connections.

Razorpay is a complete working demo case today: in-network, saved jobs there,
verified Greenhouse board, 24 live postings.

### Decisions taken

- **Full breadth, no hand curation.** All 653 companies run through automatic
  discovery. Whatever resolves, resolves. The report must measure the funnel
  precisely so the next iteration is data-driven rather than guessed.
- **Full export ingest**, not just `Connections.csv`.
- **Browser as a discovery instrument only.** Playwright (already a dependency)
  renders a careers page once when static discovery fails, captures the ATS
  endpoint it calls, persists it, and is never launched for that company again.
  Never a job-fetching path.

## Architecture

Six stages, each a CLI, each reading and writing a YAML artifact. Stages are
independently re-runnable — discovery is slow and flaky, and a stage-5 failure
must not force re-crawling stages 1–4. Every stage is pure given its input
artifact plus the HTTP cache, so runs are reproducible and diffable.

```
LinkedIn export dir
  → 1 network-import     → network.yml        (offline, pure, no HTTP)
  → 2 network-domains    → domains.yml        (verified domains only)
  → 3 network-discover   → hiring-sources.yml (careers URL + provider + account)
  → 4 network-jobs       → jobs.yml           (adapter fetch + normalize)
  → 5 network-dedupe     → jobs.yml deduped, tagged against preferences
  → 6 network-report     → report.md          (funnel + leverage view)
```

Stages 2–4 read and write `registry/`, the durable cross-run cache. That
registry — public company → domain → ATS mappings, no personal data — is the
real asset this milestone builds and is checked into the repo.

### Files to create

```
tools/src/network-scan/
  schema.ts             # Zod: Connection, Company, CandidatePreferences,
                        #   CompanyDomain, HiringSource, RawJob, Job,
                        #   ScanFailure, ScanRun
  import/
    export-reader.ts    # preamble-skipping wrapper over parseTabular
    connections.ts      # parse + normalizeCompanyName + groupByCompany
    signals.ts          # saved jobs, follows, positions, education, preferences
    import-cli.ts       # `network-import`
  http/
    client.ts           # timeout, redirect cap, size cap, retry, per-host
                        #   rate limit, robots check, content-addressed cache
  domains.ts            # resolution ladder + verification predicate
  domains-cli.ts        # `network-domains`
  careers.ts            # sitemap → homepage links → bounded common paths
  fingerprint.ts        # HTML/URL → provider + account, data-driven patterns
  browser-probe.ts      # Playwright: render once, capture XHR endpoints
  discover-cli.ts       # `network-discover`
  providers/
    types.ts            # ProviderAdapter interface
    index.ts            # registry; adding an adapter touches no orchestration
    workday.ts greenhouse.ts smartrecruiters.ts lever.ts ashby.ts
    amazon.ts           # bespoke, pinned endpoint
    jsonld.ts           # schema.org JobPosting fallback
  jobs-cli.ts           # `network-jobs`
  dedupe.ts dedupe-cli.ts
  report.ts report-cli.ts

tools/src/network-scan/registry/
  company-domains.yml   # verified company → domain
  hiring-sources.yml    # company → careers URL, provider, account, endpoint
  provider-guards.yml   # known demo/sample postings per provider
```

### Reuse

- `tools/src/csv-parse.ts` — `parseTabular()` for every export CSV. It cannot
  skip LinkedIn's 3-line notes preamble, so `export-reader.ts` wraps it:
  locate the real header row, re-parse from there.
- `tools/src/yaml.ts` — `loadYaml` / `emitYaml` for every stage artifact.
  `parseCliArgs` is single-input-only, so these CLIs use `commander`, matching
  `tools/src/create-opportunity-cli.ts`.
- `zod` for schemas, matching `tools/src/resume/schema.ts`. Note: `zod` is
  currently in `devDependencies` while `resume/schema.ts` imports it at
  runtime — move it to `dependencies` as part of this work.
- `playwright` — already a dependency, no new install.
- Test shape follows `tools/test/csv-parse.test.ts`; fixtures in
  `tools/test/fixtures/`.
- `tools/package.json` — one `bin` + one `scripts` entry per CLI, matching the
  existing `create-opportunity` / `build-resume` entries.

### Provider adapter

```ts
interface ProviderAdapter {
  readonly id: ProviderId;
  /** Patterns identifying this provider in a careers page's HTML or URL. */
  readonly fingerprints: RegExp[];
  /** Extract the account identifier from a fingerprint match. */
  accountFrom(match: RegExpMatchArray, pageUrl: string): ProviderAccount | null;
  /** Account identifiers to try when no company surface links out. */
  guessAccounts(company: Company): ProviderAccount[];
  /** Confirm an account belongs to this company. Returns a confidence. */
  verify(account: ProviderAccount, company: Company): Promise<VerifyResult>;
  /** Public endpoint for an account, paginated. */
  endpoint(account: ProviderAccount, page: number): FetchSpec;
  /** Provider payload → RawJob[]. Pure, fixture-tested, never touches network. */
  normalize(payload: unknown, source: HiringSource): RawJob[];
}
```

Adding a provider is one file plus one line in `index.ts`. `normalize` is pure,
so every adapter is unit-testable against a captured fixture.

## Stage detail

**1. `network-import`** — offline, deterministic, no HTTP. Reads the whole
export directory. Normalizes company strings conservatively (strip legal
suffixes, parenthetical expansions, `- An M2P Company` tails), merging
`Finflux - An M2P Company` with `Finflux - By M2P` but never merging on fuzzy
similarity alone; ambiguous pairs go to a `review` list rather than silently
collapsing. Drops non-employers (`Freelance`, `Self-employed`, `Stealth
Startup`, blank — 41 blank rows). Attaches per-company signal flags:
`saved_job_here`, `followed`, `ex_employer`, `alumni_overlap`, connection
count, and a seniority tally derived from connection `Position` strings.
Parses `Job Seeker Preferences.csv` into a `CandidatePreferences` record.

**2. `network-domains`** — a domain is used only if *verified*:

1. `registry/company-domains.yml` hit.
2. Slugified candidates across `.com`, `.in`, `.io`, `.co`, `.ai`, `.tech`,
   then **verify**: fetch the root and require the company's distinguishing
   name tokens in `<title>`, `og:site_name`, or a copyright line.
3. Otherwise `status: unresolved`, with the attempted candidates recorded.

Nothing downstream consumes an unverified domain. Under full-breadth mode the
unresolved set is expected to be large; the point is that it is *counted and
attributed*, not silently wrong.

**3. `network-discover`** — per verified domain, stopping at first success:
registry hit → `/sitemap.xml` scanned for career-ish paths → homepage link
extraction → a bounded fixed list of common paths. Fingerprint the resulting
page against every adapter's patterns, plus markers for providers with no
adapter yet (Darwinbox, Keka, Zoho Recruit, Eightfold, Phenom, iCIMS,
SuccessFactors, Taleo) recorded as `provider: unsupported` with the account
retained — so adding those adapters later needs no re-crawl.

Workday needs tenant + `wd{n}` + site, all three read off the
`{tenant}.wd{n}.myworkdayjobs.com/{site}` URL. They cannot be guessed: probing
NetApp and Caterpillar with guessed site names returned HTTP 422 while
correctly-fingerprinted NVIDIA and Salesforce returned thousands of jobs.

If static discovery yields nothing (SPA shell, 403), fall back in order:
`guessAccounts` + `verify` against each provider, then a single bounded
Playwright render that captures XHR/fetch URLs matching job-ish patterns.
Whatever succeeds is written to `registry/hiring-sources.yml` with its
`discoveryMethod` and `confidence`, and the browser never runs for that
company again.

**Acceptance rule — the guard this whole plan exists to enforce.** A
`HiringSource` is accepted only when either (a) a company-controlled surface
linked to it, or (b) a guessed account self-identifies with a matching company
name *and* clears the demo-board guard (reject boards containing a provider's
known sample posting; flag boards whose posting count is implausibly small for
the employer). Path (b) is recorded at lower confidence and listed separately
in the report.

**4. `network-jobs`** — adapter lookup by provider id, fetch through the shared
client, paginate where the provider paginates (Workday `cxs` is offset-based
and caps at 20/page — NVIDIA alone is 100 requests, which is where rate
limiting actually bites), normalize to `Job`. Bounded concurrency, serialized
per host, robots respected. One company failing is a `ScanFailure` row, never
an abort.

**5. `network-dedupe`** — identity in order: `provider + provider job id`, then
canonical job URL, then `company + normalized title + normalized location`.
Never title alone. Then tag each job against `CandidatePreferences` with a
`matches_preferences` boolean and the reason. Every job is kept — the tag is a
view, not a filter, since the ask is a full dump.

**6. `network-report`** — two views. A **funnel** (companies → domains verified
→ careers found → provider detected → jobs fetched, with drop counts attributed
by stage and reason), which is the instrument that makes "full breadth, accept
misses" a measurement rather than a shrug. And a **leverage** view: jobs per
company joined against connection count, saved-job and follow flags,
ex-employer and alumni flags, and preference match count — so the highest-value
referral targets are visible without any ranking model.

## Provider build order

Driven by measured network composition:

1. **Workday** — enterprise volume, verified working.
2. **Greenhouse** — Razorpay, Okta; simplest adapter, and its
   `/v1/boards/{token}` metadata endpoint is what makes `verify` possible.
3. **SmartRecruiters** — Freshworks and Indian mid-market; per-posting
   `company.name` supports `verify`.
4. **Lever**, **Ashby** — cheap once the interface exists.
5. **Amazon** bespoke — 23 connections across Amazon + AWS, one pinned endpoint.
6. **JSON-LD `JobPosting`** — generic fallback for the long tail.

Darwinbox, Keka, Zoho Recruit, Eightfold, Phenom follow, fingerprinted from day
one so no re-crawl is needed when their adapters land.

## Verification

- `pnpm --filter @loom/tools test`. Per-adapter `normalize` runs against
  captured-and-anonymized fixture payloads, never live network. Table-driven
  tests for company-name normalization, the domain verification predicate, and
  the dedupe identity ladder.
- **Regression guard for the failure this plan exists to prevent**: a test
  asserting that an unverified guessed account never produces a
  `HiringSource`, using the real `collins` → KFC case and a synthetic
  `(Sample)` demo board as fixtures.
- `pnpm --filter @loom/tools build` and `lint` must pass.
- Staged live runs, each checked before widening: Razorpay alone (expect a
  Greenhouse source and ~24 jobs), then the 19 saved-job∩network companies,
  then all 653. A cold full run is roughly 1–2 hours under bounded concurrency
  and per-host rate limiting; the content-addressed HTTP cache makes re-runs
  minutes.
- Fixtures stay synthetic or anonymized per repo convention. Real export data
  never enters a fixture or a commit; run outputs land under
  `candidate/network-scan/`, already covered by the `candidate/*` gitignore.
- Success for this milestone is a measured funnel plus a job dump — not a
  coverage target. The funnel numbers decide what gets built next.

## Out of scope

Matching, scoring, ranking models, outreach drafts, grounding eval, any
`profile.yml` dependency, browser-based job scraping, LinkedIn scraping of any
kind, and anything that sends a message.
