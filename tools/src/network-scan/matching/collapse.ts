import type { Job } from "../schema.js";

/**
 * Tier 0.5 — collapse one role listed many times.
 *
 * Employers routinely post a single opening once per location: on a real run,
 * the same title at the same company repeated 3,334 times — 20% of the whole
 * corpus — with Target listing one role 138 times and Accenture one 66 times.
 * Each of those is one job a candidate would apply to once.
 *
 * Collapsing here rather than at display time means every later tier, and every
 * token of model spend, is paid once for the role instead of once per city.
 *
 * This is distinct from deduplication: dedupe removes rows that are the *same
 * posting* arriving twice. This merges rows that are genuinely different
 * postings of the *same role*, and it keeps every posting's URL so nothing is
 * lost — a candidate can still apply to the city they want.
 *
 * Title alone used to decide both directions of that merge, and a review of a
 * real 200-match run found it wrong both ways:
 *   - too aggressive: Okta's "Senior Software Engineer" merged five postings
 *     for five different teams (Auth0 platform, identity administration, and
 *     others) into one row, hiding four jobs the candidate could have applied
 *     to separately.
 *   - too lax: "Software Engineer Manager, Okta Developer Foundation" and the
 *     same title with "(ODF)" appended survived as two rows for one posting,
 *     because the appended tag made the titles compare unequal.
 * Both are fixed the same way: bucket by company and a title stripped of its
 * parenthetical qualifier (so a team tag no longer forces two rows apart),
 * then let the description — now available in `descriptions.jsonl` — decide
 * whether postings inside that bucket are actually the same job.
 */

export interface CollapsedJob extends Job {
  /** Every location this role was posted in, across the merged postings. */
  all_locations: string[];
  /** URLs of the merged postings, best-first, including this one. */
  variant_urls: string[];
  /** How many postings collapsed into this row, including this one. */
  variant_count: number;
  /** Ids of every posting merged here, so a caller can trace a row back. */
  variant_ids: string[];
  /**
   * At least one merged posting had no description available, so this merge
   * fell back to matching by title alone for that pair rather than being
   * confirmed against the text. Absent (not `false`) when every posting in
   * the row was compared and agreed.
   */
  merge_uncertain?: boolean;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Groups postings by company and a title with its parenthetical qualifier
 * removed — "(ODF)", "(Backend)", "(As of Sept 2024)" all strip to nothing.
 *
 * This is only ever a *candidate* grouping, not the merge decision itself: two
 * postings landing in the same bucket means they are worth comparing by
 * description, not that they are the same job. Level qualifiers written into
 * the title itself are not stripped — "Senior Software Engineer" and
 * "Software Engineer" still bucket apart, because those are different jobs a
 * candidate would weigh differently.
 */
function titleStem(title: string): string {
  return normalizeText(title.replace(/\([^)]*\)/g, " "));
}

/** Words shorter than this carry too little meaning to count toward similarity. */
const MIN_TOKEN_LENGTH = 3;

function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter((word) => word.length >= MIN_TOKEN_LENGTH));
}

/**
 * How similar two postings' description text is, as word-level Jaccard
 * similarity — cheap, deterministic, and good enough to tell "same job
 * reposted" from "same title, different job" without a model call.
 *
 * A merge is confirmed at or above this threshold. Calibrated against the real
 * corpus: five genuinely different Okta "Senior Software Engineer" postings
 * that a title-only merge had conflated scored between 0.38 and 0.53 against
 * each other; the same Boeing posting re-listed with an edited qualifier
 * scored 0.98. The threshold sits well clear of both, rather than splitting
 * the difference.
 */
const DESCRIPTION_SIMILARITY_THRESHOLD = 0.7;

function descriptionSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Union-find over a single company+title-stem bucket. Bucket-scoped rather
 * than global, so its cost never depends on how many jobs the *company* has —
 * only on how many share this one title stem.
 */
class DisjointSet {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;

    let node = x;
    while (this.parent.get(node) !== root) {
      const next = this.parent.get(node)!;
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/**
 * Groups postings of the same role at the same company.
 *
 * `descriptions` is optional so callers without any text yet (or tests that
 * do not care) get the old title-only behaviour: bucketed jobs merge outright,
 * exactly as before this fix. That is also the deliberate fallback whenever a
 * pair inside a bucket cannot be compared — a posting missing its description
 * is not evidence that it differs, so the merge proceeds and the row is
 * flagged `merge_uncertain` rather than silently guessed at.
 *
 * Bucketing by company first, and by title stem second, is what keeps this
 * cheap: a real run has one company (Amazon) with 4,000 postings, and
 * comparing every pair of those directly would be 16 million description
 * comparisons for one employer alone. Bucketing means only postings that
 * already look like the same role — same company, same title once a team tag
 * is stripped — are ever compared, and the largest such bucket in that same
 * run held 67 postings.
 */
export function collapseVariants(
  jobs: Job[],
  descriptions: Map<string, string> = new Map()
): { jobs: CollapsedJob[]; merged: number } {
  const buckets = new Map<string, Job[]>();

  for (const job of jobs) {
    const key = `${job.company_id}::${titleStem(job.title)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(job);
    else buckets.set(key, [job]);
  }

  const collapsed: CollapsedJob[] = [];
  let merged = 0;

  for (const bucket of buckets.values()) {
    const dsu = new DisjointSet();
    for (const job of bucket) dsu.find(job.id);

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        const descA = descriptions.get(a.id);
        const descB = descriptions.get(b.id);

        if (!descA || !descB) {
          // Cannot check the text on at least one side — merge as the old
          // title-only logic would have, rather than assume they differ.
          dsu.union(a.id, b.id);
          continue;
        }

        if (descriptionSimilarity(descA, descB) >= DESCRIPTION_SIMILARITY_THRESHOLD) {
          dsu.union(a.id, b.id);
        }
        // Below threshold: same title stem, different job. Left un-unioned —
        // this is the fix for Okta's "Senior Software Engineer", five
        // distinct team postings a title-only merge had conflated into one.
      }
    }

    const groups = new Map<string, Job[]>();
    for (const job of bucket) {
      const root = dsu.find(job.id);
      const group = groups.get(root);
      if (group) group.push(job);
      else groups.set(root, [job]);
    }

    for (const group of groups.values()) {
      // Deterministic representative: the job whose id sorts first, so the
      // same input always produces the same row rather than depending on
      // fetch order.
      const ordered = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const [primary] = ordered;

      const locations = [...new Set(ordered.flatMap((job) => job.locations))];
      const urls = [
        ...new Set(ordered.map((job) => job.job_url).filter((u): u is string => Boolean(u))),
      ];

      collapsed.push({
        ...primary,
        // The merged row must carry *every* city the role was posted in.
        // Keeping only the representative posting's location made later
        // location filtering judge the role by one arbitrary city: a role
        // open in both Toronto and Bengaluru collapsed to Toronto and was
        // then rejected for a candidate in Bengaluru, silently losing a job
        // they could have taken.
        locations,
        all_locations: locations,
        variant_urls: urls,
        variant_count: ordered.length,
        variant_ids: ordered.map((job) => job.id),
        // A role is remote if any of its postings is.
        remote: ordered.some((job) => job.remote) || undefined,
        merge_uncertain:
          (ordered.length > 1 && ordered.some((job) => !descriptions.has(job.id))) || undefined,
      });
      merged += ordered.length - 1;
    }
  }

  collapsed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { jobs: collapsed, merged };
}
