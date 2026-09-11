import { foldSeparators } from "./taxonomy.js";

/**
 * Tier 5 input — how close a job's title reads to the roles the candidate
 * actually asked for.
 *
 * Missing entirely until a real run put "Agile Test Automation Engineer,
 * Quality Assurance" at #1 with three more QA/test-automation titles in the
 * top 20, for a candidate whose stated titles were Full Stack Engineer,
 * Javascript Developer, Web Developer, Frontend Developer and Software
 * Engineer. `keyword score` alone could not catch this: a QA posting lists a
 * lot of technology names, so it scored well on skill overlap despite naming
 * a discipline the candidate never asked for. Title affinity is a second,
 * independent signal — not a replacement for keyword score, a check on it.
 */

/**
 * Words that appear in almost every engineering title and so say nothing
 * about *which* engineering role this is. Two titles agreeing only on
 * "Engineer" are not evidence of a match — a QA Engineer and a Frontend
 * Engineer agree on that word and nothing else. Weighted down rather than
 * dropped: an exact-title match still needs to score highest.
 */
const GENERIC_ROLE_WORDS = new Set([
  "senior", "junior", "staff", "principal", "lead", "sr", "jr", "i", "ii", "iii", "iv",
  "associate", "engineer", "engineering", "developer", "development", "specialist",
  "software", "programmer", "professional", "expert",
]);

/** Distinguishing words carry full weight; generic role words carry a fraction of it. */
const GENERIC_WORD_WEIGHT = 0.2;

function tokenWeight(token: string): number {
  return GENERIC_ROLE_WORDS.has(token) ? GENERIC_WORD_WEIGHT : 1;
}

function titleTokens(title: string): string[] {
  return foldSeparators(title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * Whether two title tokens name the same thing, tolerating the compound
 * spelling boards disagree on: "Fullstack", "Full-Stack" and "Full Stack" are
 * one word split three different ways. `foldSeparators` already unifies the
 * hyphenated form; this handles the concatenated one by treating a token as
 * matching a longer token that contains it whole. The length floor keeps a
 * short word like "go" from matching by coincidence inside something like
 * "ergonomics".
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

/**
 * Weighted overlap between two titles' tokens, each token used at most once.
 *
 * This is whole-token, weighted Jaccard — not substring search across the
 * whole title, which is how a keyword matcher becomes nonsense (see
 * `keywords.ts`'s `mentions`). Partial credit falls out of the weighting
 * naturally: "Senior Fullstack Engineer" against "Full Stack Engineer" shares
 * the distinguishing word and the (down-weighted) generic ones, but not
 * "Senior", so it scores well without scoring perfectly.
 */
function weightedOverlap(a: string[], b: string[]): number {
  const remaining = [...b];
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const token of a) totalWeight += tokenWeight(token);
  for (const token of b) totalWeight += tokenWeight(token);

  for (const token of a) {
    const index = remaining.findIndex((candidate) => tokensMatch(token, candidate));
    if (index === -1) continue;
    matchedWeight += tokenWeight(token) + tokenWeight(remaining[index]);
    remaining.splice(index, 1);
  }

  return totalWeight === 0 ? 0 : matchedWeight / totalWeight;
}

/**
 * How well a job's title matches the best of the candidate's stated titles.
 *
 * 0–1. Preferences left empty score every title identically (there is nothing
 * to prefer), which is why `rankJobs` only applies this component's weight
 * when the candidate actually listed titles.
 */
/**
 * A target title, and how much it should count.
 *
 * A declared preference that the candidate's own history does not corroborate
 * is weaker evidence than one it does. LinkedIn never prompts anyone to revisit
 * these, and a five-year-old list can still name a tier of role the candidate
 * has long since moved past — obeying it at full strength ranked such a job
 * almost level with their current title.
 */
export interface WeightedTitle {
  title: string;
  /** 1 for corroborated targets; lower for a declaration history disputes. */
  weight: number;
}

export function titleAffinity(
  jobTitle: string,
  preferredTitles: (string | WeightedTitle)[]
): number {
  if (preferredTitles.length === 0) return 0;

  const targets: WeightedTitle[] = preferredTitles.map((entry) =>
    typeof entry === "string" ? { title: entry, weight: 1 } : entry
  );

  const jobTokens = titleTokens(jobTitle);
  let best = 0;
  for (const target of targets) {
    const preferred = target.title;
    const preferredTokens = titleTokens(preferred);
    if (preferredTokens.length === 0) continue;
    // Scale by the target's own credibility, so an uncorroborated declaration
    // can still match — it just cannot claim a perfect score.
    best = Math.max(best, weightedOverlap(jobTokens, preferredTokens) * target.weight);
  }
  return Number(best.toFixed(4));
}
