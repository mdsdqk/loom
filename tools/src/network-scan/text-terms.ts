/**
 * Generic text-term extraction, shared by anything that needs "the
 * distinctive words in this free text" without a domain-specific dictionary.
 *
 * Used on both sides of matching: the candidate's own experience prose
 * (`import/signals.ts`, unchanged) and, since scoring a job description
 * needed the same kind of language-agnostic proxy for "what does this
 * posting actually ask for" (`matching/keywords.ts`), the description text
 * too. One stopword list and one tokenizer, so a change to either side is
 * honest about touching both rather than silently drifting apart.
 */

/**
 * Words too common in job and profile text to distinguish anything. Matching
 * on them would score every job against every candidate.
 */
export const STOPWORDS = new Set([
  "and", "the", "for", "with", "our", "you", "your", "are", "will", "team", "work", "working",
  "experience", "years", "role", "job", "position", "company", "business", "new", "using", "use",
  "including", "across", "within", "strong", "good", "great", "ability", "skills", "knowledge",
  "development", "developing", "build", "building", "built", "help", "support", "ensure", "manage",
  "based", "well", "have", "has", "been", "this", "that", "from", "into", "other", "more", "who",
  "what", "when", "how", "all", "any", "can", "not", "was", "were", "they", "them", "their",
]);

/** Splits free text into distinctive lowercase terms. */
export function distinctiveTerms(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Keep the punctuation that carries meaning in technology names.
    .replace(/[^a-z0-9+#./ -]+/g, " ")
    .split(/[\s,/]+/)
    .map((term) => term.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((term) => term.length > 2 && term.length < 32 && !STOPWORDS.has(term));
}
