import type { CandidateSkills } from "../schema.js";

/**
 * Tier 3 — how well a job description overlaps what the candidate can do.
 *
 * Deterministic and explainable: the score is a weighted count of the
 * candidate's own terms found in the posting, and every match is reported. A
 * number a candidate cannot interrogate is worse than no number, because they
 * cannot tell a genuine mismatch from a scoring artefact.
 *
 * This is a filter, not a judgement. It answers "does this posting talk about
 * the things this person does", which is a much weaker question than whether
 * they should apply — that is what the later model pass and the candidate
 * themselves are for.
 */

/** A skill the candidate listed outranks a word that merely recurs in their history. */
const WEIGHTS = { listed: 3, title: 2, experience: 1 } as const;

export interface KeywordMatch {
  term: string;
  source: keyof typeof WEIGHTS;
}

export interface KeywordScore {
  /** 0–1. Share of the candidate's weighted vocabulary the posting mentions. */
  score: number;
  matched: KeywordMatch[];
  /** Listed skills the posting never mentions, most useful first. */
  missing: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9+#. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a term appears in the text as a term, not as a fragment.
 *
 * Substring matching would find "java" inside "javascript" and "go" inside
 * "algorithm", which is how keyword matchers quietly become nonsense. Multi-word
 * skills ("system design") are matched as a phrase.
 */
function mentions(haystack: string, term: string): boolean {
  const needle = normalize(term);
  if (!needle) return false;

  // Escape the regex metacharacters that survive normalization: C++, C#, .NET,
  // Node.js all carry meaning in their punctuation and must match literally.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
}

/**
 * Scores a posting against the candidate's own vocabulary.
 *
 * The denominator is the candidate's full weighted vocabulary, so the score
 * says "how much of what I do does this job mention" rather than "how much of
 * this job do I match". That direction is deliberate: it does not punish a job
 * for having a long description.
 */
export function scoreDescription(
  description: string,
  skills: CandidateSkills,
  options: { maxExperienceTerms?: number } = {}
): KeywordScore {
  const haystack = normalize(description);

  // Experience terms are the noisiest input, so only the most distinctive are
  // used; without a cap they would swamp the listed skills entirely.
  const experience = skills.experience_terms.slice(0, options.maxExperienceTerms ?? 120);

  const vocabulary: KeywordMatch[] = [
    ...skills.listed.map((term) => ({ term, source: "listed" as const })),
    ...skills.held_titles.map((term) => ({ term, source: "title" as const })),
    ...experience.map((term) => ({ term, source: "experience" as const })),
  ];

  const total = vocabulary.reduce((sum, entry) => sum + WEIGHTS[entry.source], 0);
  if (total === 0) return { score: 0, matched: [], missing: [] };

  const matched: KeywordMatch[] = [];
  let earned = 0;
  for (const entry of vocabulary) {
    if (!mentions(haystack, entry.term)) continue;
    matched.push(entry);
    earned += WEIGHTS[entry.source];
  }

  const missing = skills.listed.filter((term) => !mentions(haystack, term));

  return { score: Number((earned / total).toFixed(4)), matched, missing };
}

/**
 * A readable explanation of a score.
 *
 * Listed skills first, since those are what the candidate said about themselves
 * and what they will recognise.
 */
export function explainScore(result: KeywordScore, limit = 12): string {
  const order = { listed: 0, title: 1, experience: 2 } as const;
  const terms = [...result.matched]
    .sort((a, b) => order[a.source] - order[b.source] || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map((entry) => entry.term);

  return terms.length === 0 ? "no overlap with your listed skills" : terms.join(", ");
}
