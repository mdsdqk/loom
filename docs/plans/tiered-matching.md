# Tiered job matching — plan

## Context

Network Scan retrieves open jobs at companies where the candidate has
connections. It currently ends with a literal tag: does the job's title match a
title the candidate typed into LinkedIn, in a location they named. That is
enough to prove the pipeline and no more. On a real run it leaves 150 tagged
jobs out of 16,156 — a number arrived at by string matching, with no notion of
whether the candidate could actually do the job.

This plan adds matching proper: a funnel of increasingly expensive passes, each
one cutting the set enough to make the next affordable. The ordering is dictated
by cost, and the costs are not evenly spread — one stage in the middle dominates
everything.

The goal is **referrals**, not job matching. That distinction decides the final
ranking, and it is easy to lose sight of halfway down a scoring pipeline.

## What the data allows

Measured over 16,156 jobs from a real run:

| field | coverage | notes |
|---|---|---|
| title | 100% | |
| locations | 99% | |
| description | **40%** | **Workday returns none, and it is 9,684 of the jobs** |
| department | 39% | vendor categories: `aws`, `fulfillment-ops`, `finance` |
| employment type | 25% | |
| compensation | 0% | extraction is broken; see Prerequisites |

Two consequences shape everything below.

**The job description is the bottleneck, not the matching logic.** Any pass that
reads a JD needs one detail request per job for every Workday posting — about
9,700 of them. That is the expensive step, and every cheap pass exists to shrink
what reaches it.

**Titles barely repeat.** 12,487 distinct titles across 16,156 jobs, 11,630
distinct after stripping seniority qualifiers. Caching a title-classification
result helps far less than it first appears.

## The funnel

Each tier records why it rejected a job. A funnel that only reports survivors
cannot be debugged or tuned.

### Tier 0 — structural rejects (free, no network)

Pure field comparisons on data already held:

- **Location** — already built. Compatible location, remote, or unknown.
- **Seniority band from the title** — "Intern", "Director", "VP", "Head of" are
  as disqualifying as the wrong discipline. Derived from the same title parsing
  the import stage already uses for connections.
- **Employment type** — where stated and the candidate excluded it.
- **Freshness** — where `published_at` exists, drop stale postings.

### Tier 0.5 — collapse near-duplicate postings (free)

**Same title + same company repeats 3,334 times, 20% of the corpus.** Target
posts "Security Specialist" 138 times; Accenture posts "Custom Software
Engineer" 66 times. These are one role listed per location.

Collapse to a single row carrying a location list. Done here, every later tier
and every token of LLM spend is paid once instead of 138 times.

### Tier 1 — discipline (cheap, incomplete data)

The candidate is an engineer; finance and retail postings are noise.

`department` is only 39% populated and its vocabulary is per-vendor, so the rule
is asymmetric: **department may reject, never require.** Absence carries no
information and must not be treated as a miss. Where Amazon says `finance` or
`fulfillment-ops`, that is decisive and free.

### Tier 2 — job family from the title (cheap; mostly deterministic)

The single largest cut available. **A plain engineering-word test on titles
keeps 27% and rejects 11,637 jobs before any JD is fetched.**

Run this as a taxonomy first, not a model: map title tokens to job families
(engineer / developer / SDE / SRE → engineering; accountant / controller /
auditor → finance). A lookup handles the clear majority.

Send only the genuinely ambiguous residue to a cheap LLM — "Solutions
Architect", "Technical Program Manager", "Applied Scientist", "Data Scientist"
are real judgment calls for a software engineer. Batch them, cache by
normalized title, and expect the cache to help less than usual given how varied
titles are.

Tier 2 answers *could this plausibly be my kind of job*, nothing more.

### Tier 2.5 — fetch the description (expensive; not a filter)

An enrichment stage, and the reason the tiers above exist.

Workday's list endpoint returns title, location and a path — no text. Fetching
descriptions means one request per surviving job. Placed after tiers 0–2 it runs
over hundreds of jobs instead of ten thousand.

Text is stored complete, in the `descriptions.jsonl` sidecar rather than the job
index — see `descriptions.ts`. Descriptions run to ~8KB each and roughly 126MB
across a full corpus, which does not belong in a file every stage parses.

### Tier 3 — keyword and skill scoring (cheap, deterministic)

Score the description against the candidate's skills and produce a number with
its matched terms. Deterministic, explainable, and reproducible.

This is only as good as the profile behind it. Today the available input is the
LinkedIn `Skills.csv` (39 entries) and declared target titles; the richer
Candidate Profile (`candidate/profile.yml`) does not exist yet. Tier 3 can ship
against the LinkedIn skills and improve when the profile does.

Reject below a threshold — with the threshold **calibrated, not chosen**; see
Calibration.

### Tier 4 — model pass over the description (expensive)

For what survives: a confidence score plus reasoning, against the full profile.

Last because it is the only stage that cannot be explained by inspection, and
because by here the set is small enough to afford it. Its output is advisory and
always carries reasoning, so a bad score can be argued with rather than trusted.

### Tier 5 — rank by referral leverage, not match quality

The step most easily forgotten, and the one the product is actually for.

A 70% match where the candidate has a senior former colleague is worth more than
a 90% match where their only contact is one junior connection made years ago.
The referral scoring already built (`referrals.ts`) combines seniority, how
recently they connected, and whether the candidate worked or studied there.

Final ordering multiplies match quality by referral leverage. Neither alone is
the answer.

## Calibration

**The candidate's own saved jobs are ground truth.** The LinkedIn export
contains 61 jobs they saved — real positive labels, produced without being asked.

Before any threshold is set, check where the matcher ranks those. A scorer tuned
by eye looks plausible and is unfalsifiable; a scorer measured against saved
jobs can be shown to work or not. This should exist before Tier 3 ships, because
it is the only thing that distinguishes a tuned threshold from a guessed one.

Caveat worth stating: 61 labels is a small set, all positive, and biased toward
what the candidate happened to browse. It can show a matcher is bad. It cannot
prove one is good.

## Prerequisites

Both are bugs in the retrieval stage that would silently cap matching quality:

1. **Descriptions were truncated at 4,000 characters on ingestion.** Measured
   against one real board, *100% of 310 descriptions* exceeded that — median
   7,830, max 16,533 — so more than half of every JD was discarded, including
   the requirements sections tiers 3 and 4 depend on. Fixed: text is stored
   complete in a sidecar.
2. **Compensation extraction returns nothing** for all providers. Worth fixing
   before matching, since pay is a real filter for a real candidate.

## Order of work

1. Fix compensation extraction (prerequisite 2).
2. Tier 0 and 0.5 — free, and 0.5 removes 20% of the corpus immediately.
3. Calibration harness over saved jobs — before any threshold exists.
4. Tier 2 taxonomy — the 73% cut.
5. Tier 2.5 enrichment fetch.
6. Tier 1 department rejects — cheap, small effect, easy alongside.
7. Tier 3 keyword scoring.
8. Tier 5 referral-weighted ranking — worth doing before Tier 4, since it
   improves the shortlist without any model.
9. Tier 2 LLM residue, then Tier 4.

The model passes come last deliberately. Everything above them is deterministic,
inspectable, and testable against fixtures, and each one makes the model passes
cheaper. If the funnel above is right, the LLM sees hundreds of jobs rather than
sixteen thousand.
