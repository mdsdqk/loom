import type { CandidateSkills } from "../schema.js";
import { STOPWORDS } from "../text-terms.js";

/**
 * Tier 3 — how well a job description overlaps what the candidate can do.
 *
 * Deterministic and explainable: every match is reported, and the score is
 * built from two directional coverage numbers rather than one opaque ratio —
 * see `scoreDescription` below for why a single ratio was actively misleading.
 *
 * This is a filter, not a judgement. It answers "does this posting talk about
 * the things this person does", which is a much weaker question than whether
 * they should apply — that is what the later model pass and the candidate
 * themselves are for.
 */

/** Where a matched term came from, in descending order of how much it says about the candidate. */
export type MatchSource = "listed" | "title" | "experience";

export interface KeywordMatch {
  term: string;
  source: MatchSource;
}

export interface KeywordScore {
  /**
   * 0–1, the harmonic mean of `skillCoverage` and `demandCoverage`. See
   * `scoreDescription` for why neither half alone is safe to rank on.
   */
  score: number;
  /** Of the candidate's listed skills, the fraction this posting mentions. */
  skillCoverage: number;
  /** Of the posting's own distinctive terms, the fraction the candidate has. */
  demandCoverage: number;
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
 * Every term the candidate has, broken down to the word level.
 *
 * `demandCoverage` needs to ask "does the candidate have this word", and a
 * posting will often echo only half of a multi-word skill ("design" without
 * "system"). Splitting to words is a looser test than the phrase match
 * `mentions` uses for `matched`/`missing`, which is deliberate: this feeds a
 * coverage ratio, not the list of skills shown to the candidate, so it can
 * afford to be generous.
 */
function vocabularyWords(skills: CandidateSkills): Set<string> {
  const words = new Set<string>();
  for (const term of [...skills.listed, ...skills.held_titles, ...skills.experience_terms]) {
    for (const word of normalize(term).split(" ")) {
      if (word) words.add(word);
    }
  }
  return words;
}

/**
 * Tokens from the *original* (not lowercased) text shaped like a specific
 * requirement rather than descriptive prose — either carrying the digits or
 * punctuation a technology name needs (`Node.js`, `C++`, `S3`, `CI/CD`), or
 * written capitalized in the middle of a sentence, which is how a posting
 * actually renders a product or technology name: "hands-on experience with
 * EKS / Kubernetes is preferred". A word capitalized only because it opens a
 * sentence is not evidence of anything — "We are looking for..." does not
 * nominate "We" — so it is excluded by requiring the character before it not
 * be a sentence terminator (or the very start of the text). A bullet marker
 * or line break before it does *not* exclude it: a requirements section
 * rendered as a bare list ("- Kubernetes\n- Docker") is exactly the shape
 * this is trying to catch.
 *
 * This existed because plain word extraction (`distinctiveTerms`) counts a
 * job posting's *entire* non-boilerplate vocabulary — the benefits
 * paragraph, the culture blurb, "about the team" — most of which a candidate
 * could never plausibly be asked to have. Measured against a real corpus,
 * the median distinctive word in a posting turned out to itself be
 * corpus-rare (a posting's own flourish of prose, not a requirement), so even
 * weighting by document frequency barely narrowed the set: `demandCoverage`
 * still landed near 0.1 regardless of fit. Restricting to how the word is
 * *written* — shaped like a name, not like narration — is what actually
 * shrinks the denominator to something a candidate could realistically cover.
 */
export function requirementShapedTerms(text: string): string[] {
  const results: string[] = [];
  const pattern = /[A-Za-z][A-Za-z0-9+#./-]{0,30}/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    // A trailing period, hyphen or slash is usually just how the sentence (or
    // a line-wrapped word) ended, not part of the token's identity — without
    // trimming it first, "components." at the end of any sentence reads as
    // punctuation-shaped and every ordinary last word in the description
    // would qualify.
    const trimmed = match[0].replace(/[.\-/]+$/, "");
    if (!trimmed) continue;

    // Meaningful shape: a digit or `#`/`+` anywhere (S3, K8s, C#, C++), or a
    // dot/hyphen/slash *between* two alphanumerics (Node.js, CI/CD,
    // pre-migration) rather than trailing one that was already trimmed off.
    const hasMeaningfulShape = /[0-9#+]/.test(trimmed) || /[a-z][./-][a-z0-9]/i.test(trimmed);

    if (!hasMeaningfulShape) {
      // No digit or meaningful punctuation — only a mid-sentence capital
      // letter can still qualify this as a name rather than a common word.
      if (!/^[A-Z]/.test(trimmed)) continue;

      // Only an actual sentence terminator, list header, or bullet marker
      // disqualifies it — the very start of the text is not evidence either
      // way, and excluding it wrongly threw away a description whose first
      // line was already the ask. Boards render bullet lists as a bare
      // " - Design and validate..." with no real markup, and every one of
      // those leads with an ordinary action verb ("Design", "Own", "Bring")
      // capitalized only because it opens the bullet — without treating the
      // dash as a boundary too, a "Key responsibilities" list contributed
      // more noise to the denominator than the technology names buried
      // inside its bullets did.
      let i = match.index - 1;
      let crossedLineBreak = false;
      while (i >= 0 && /\s/.test(text[i])) {
        if (text[i] === "\n") crossedLineBreak = true;
        i--;
      }
      const sentenceStart = crossedLineBreak || (i >= 0 && ".!?:-•*".includes(text[i]));
      if (sentenceStart) continue;
    }

    const normalized = trimmed.toLowerCase();
    if (normalized.length < 2 || normalized.length > 31) continue;
    if (STOPWORDS.has(normalized)) continue;
    results.push(normalized);
  }

  return results;
}

/**
 * How much a term counts toward `demandCoverage`'s denominator, keyed by the
 * term itself.
 *
 * `requirementShapedTerms` already narrows a posting down to its
 * name-shaped words, but a name can still be boilerplate — a company's own
 * name, "LinkedIn" in a follow-us footer, "Equal" from the EEO statement
 * that recurs verbatim across all of that company's postings. Weighting by
 * how many *other* postings in the corpus use the same word is what catches
 * that: a term in every posting scores 0 and stops diluting the ratio; a
 * term in almost none of them scores near 1.
 */
export type DemandWeights = Map<string, number>;

/**
 * Builds `DemandWeights` from every description available, not just the ones
 * being scored right now — boilerplate recurs across every discipline a
 * board posts, so a broader corpus gives a steadier read on what is common
 * than only the descriptions that survived to this candidate's shortlist.
 */
export function buildDemandWeights(descriptions: Iterable<string>): DemandWeights {
  const documentFrequency = new Map<string, number>();
  let documentCount = 0;

  for (const text of descriptions) {
    documentCount += 1;
    for (const term of new Set(requirementShapedTerms(text))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const weights: DemandWeights = new Map();
  if (documentCount <= 1) {
    // Nothing to compare frequency against — every term is equally "rare".
    for (const term of documentFrequency.keys()) weights.set(term, 1);
    return weights;
  }

  const maxIdf = Math.log(documentCount);
  for (const [term, freq] of documentFrequency) {
    // Normalized inverse document frequency, clamped to [0, 1]: a term in
    // every document scores 0, a term in exactly one document scores 1.
    const idf = Math.log(documentCount / freq);
    weights.set(term, maxIdf === 0 ? 0 : Math.max(0, Math.min(1, idf / maxIdf)));
  }
  return weights;
}

/**
 * Scores a posting against the candidate's own vocabulary.
 *
 * The old version divided matched weight by the candidate's *entire* weighted
 * vocabulary — 39 listed skills + 7 held titles + 43 experience terms, fixed
 * regardless of the posting. That meant a short, perfectly-targeted JD could
 * never score well: it cannot mention skills it has no reason to need, so the
 * denominator punished it for being focused. Measured on a real 200-job run,
 * the top score went to a QA automation posting that happened to name many
 * technologies, not to the best-fitting role.
 *
 * The fix reports two directional numbers instead of collapsing straight to a
 * ratio:
 *   - `skillCoverage` — "how much of what I know does this job use". Denominator
 *     is the candidate's listed skills, so it never rewards a long description.
 *   - `demandCoverage` — "how much of what this job wants do I have". Denominator
 *     is sized to *this posting* (its own distinctive terms), which is the
 *     direction the old ratio never captured: a JD naming three things the
 *     candidate has and nothing else now beats one naming eight things among
 *     two hundred requirements that do not apply.
 * `score` combines them with a harmonic mean rather than an average, so a
 * posting cannot lead purely by being strong on one axis — a job that mentions
 * everything the candidate wants echoed back but barely uses their actual
 * skills, or the reverse, still scores low on the number used for ranking.
 */
export function scoreDescription(
  description: string,
  skills: CandidateSkills,
  options: { maxExperienceTerms?: number; demandWeights?: DemandWeights } = {}
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

  const matched: KeywordMatch[] = [];
  for (const entry of vocabulary) {
    if (mentions(haystack, entry.term)) matched.push(entry);
  }
  const missing = skills.listed.filter((term) => !mentions(haystack, term));

  const matchedListed = matched.filter((entry) => entry.source === "listed").length;
  const skillCoverage = skills.listed.length === 0 ? 0 : matchedListed / skills.listed.length;

  // The posting's own vocabulary, independent of the candidate — this is what
  // makes the denominator track "what this job asks for" instead of "what the
  // candidate happens to know". Each term counts by its corpus rarity rather
  // than equally, so a description's boilerplate stops diluting the ratio —
  // see `buildDemandWeights`. Without a corpus to weigh against (the default,
  // for tests and any caller that has not built one), every term counts
  // equally.
  const demandTerms = new Set(requirementShapedTerms(description));
  const vocabWords = vocabularyWords(skills);
  let demandMatchedWeight = 0;
  let demandTotalWeight = 0;
  for (const term of demandTerms) {
    const weight = options.demandWeights?.get(term) ?? 1;
    demandTotalWeight += weight;
    if (vocabWords.has(term)) demandMatchedWeight += weight;
  }
  const demandCoverage = demandTotalWeight === 0 ? 0 : demandMatchedWeight / demandTotalWeight;

  const score =
    skillCoverage + demandCoverage === 0
      ? 0
      : (2 * skillCoverage * demandCoverage) / (skillCoverage + demandCoverage);

  return {
    score: Number(score.toFixed(4)),
    skillCoverage: Number(skillCoverage.toFixed(4)),
    demandCoverage: Number(demandCoverage.toFixed(4)),
    matched,
    missing,
  };
}

/**
 * Rescales a batch of scores so the strongest real matches actually read as
 * strong, without changing what `skillCoverage` and `demandCoverage`
 * literally mean.
 *
 * Both coverage fractions have a low honest ceiling for any candidate with a
 * broad skill list and any posting long enough to be a real job description:
 * on a real 1,378-job run, `skillCoverage` topped out at 0.31 (no single
 * posting needs a third of a 39-skill résumé) and `demandCoverage` at 0.24
 * (a full posting names more distinct requirements, "nice to haves" included,
 * than one candidate satisfies). A harmonic mean of two numbers that never
 * exceed ~0.3 cannot itself exceed ~0.3 — the best real match in that run
 * scored 0.19, which reads as "barely a match" even though it beat every
 * other posting decisively. That is the same misreading risk `relativeMatch`
 * already solves for the single best-scoring job in `rankJobs`; this solves
 * it for `score` itself, and for more than just the one best row.
 *
 * Rescaling against a 90th-percentile ceiling was tried first and rejected:
 * measured against a real 200-row run, it flattened the entire top decile —
 * 21 rows, five of the top ten — to exactly 1.00, even though their
 * underlying `skillCoverage` still ranged from 0.154 to 0.231. That erases
 * the distinction exactly where a candidate is looking hardest. Dividing by
 * the batch's actual maximum instead keeps every real difference: only the
 * single strongest job on a given axis reaches 1.0, and nothing needs
 * clamping afterward because nothing in the batch can exceed its own max.
 *
 * This is a batch operation — unlike `scoreDescription`, its answer depends
 * on every other job being scored alongside this one — so it runs once after
 * the whole set is scored, not per posting.
 */
export function rescaleForBatch(scores: KeywordScore[]): KeywordScore[] {
  const skillCeiling = Math.max(0, ...scores.map((s) => s.skillCoverage));
  const demandCeiling = Math.max(0, ...scores.map((s) => s.demandCoverage));

  return scores.map((entry) => {
    // A ceiling of 0 means nothing in the batch scored above zero on that
    // axis — there is nothing to rescale against, so leave it at zero rather
    // than dividing by it.
    const rescaledSkill = skillCeiling > 0 ? entry.skillCoverage / skillCeiling : 0;
    const rescaledDemand = demandCeiling > 0 ? entry.demandCoverage / demandCeiling : 0;
    const score =
      rescaledSkill + rescaledDemand === 0
        ? 0
        : (2 * rescaledSkill * rescaledDemand) / (rescaledSkill + rescaledDemand);

    return { ...entry, score: Number(score.toFixed(4)) };
  });
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
