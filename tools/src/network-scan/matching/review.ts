import type { CandidateSkills, Job } from "../schema.js";
import type { RankedJob } from "./rank.js";

/**
 * Tier 4 — preparing the judgement calls for a model, and reading its answers
 * back.
 *
 * This module deliberately does **not** call a model. Loom runs on the host's
 * model access rather than its own credentials, and every earlier stage is pure
 * deterministic code that runs offline and is testable against fixtures. So the
 * boundary is drawn here: this builds batches and validates results, and a skill
 * dispatches them, matching how the repository already separates grounding
 * evaluation from the agent that performs it.
 *
 * Two distinct questions reach a model, and mixing them would waste the
 * expensive one:
 *   - `discipline` — is this title even the candidate's kind of work? Asked only
 *     for titles the taxonomy could not place, and answerable from the title.
 *   - `fit` — how well does this posting match this candidate, and why? Asked
 *     only of jobs that survived everything else.
 */

export type ReviewKind = "discipline" | "fit";

export interface ReviewItem {
  /** The job this question is about. */
  job_id: string;
  kind: ReviewKind;
  title: string;
  company: string;
  /** Present for `fit` questions only; omitted to keep discipline batches small. */
  description?: string;
}

export interface ReviewBatch {
  kind: ReviewKind;
  /** What the model is being asked, stated once for the batch. */
  question: string;
  /** The candidate's own words, so the model judges against fact not inference. */
  candidate?: CandidateSkills;
  items: ReviewItem[];
}

const DISCIPLINE_QUESTION =
  "For each job title, answer whether it is a software engineering role that a " +
  "software engineer would apply to. Titles here were ambiguous to a keyword " +
  "classifier. Answer only from the title. Reply for every id with a verdict of " +
  '"yes", "no", or "unclear".';

const FIT_QUESTION =
  "For each job, judge how well it fits the candidate described below, using " +
  "only the posting text and the candidate's stated skills and history. Reply " +
  "for every id with a score from 0 to 1 and one sentence of reasoning. Do not " +
  "infer skills the candidate has not stated.";

/**
 * Splits work into batches a model can answer in one pass.
 *
 * Descriptions are long, so fit batches are sized by character budget rather
 * than item count — a fixed count would produce batches that vary by an order
 * of magnitude in size.
 */
export function buildDisciplineBatches(
  jobs: Job[],
  batchSize = 40
): ReviewBatch[] {
  const batches: ReviewBatch[] = [];

  for (let start = 0; start < jobs.length; start += batchSize) {
    batches.push({
      kind: "discipline",
      question: DISCIPLINE_QUESTION,
      items: jobs.slice(start, start + batchSize).map((job) => ({
        job_id: job.id,
        kind: "discipline" as const,
        title: job.title,
        company: job.company_name,
      })),
    });
  }

  return batches;
}

export function buildFitBatches(
  ranked: RankedJob[],
  descriptions: Map<string, string>,
  skills: CandidateSkills,
  options: { charBudget?: number; maxDescriptionChars?: number } = {}
): ReviewBatch[] {
  const charBudget = options.charBudget ?? 40_000;
  const maxDescription = options.maxDescriptionChars ?? 6_000;

  const batches: ReviewBatch[] = [];
  let current: ReviewItem[] = [];
  let used = 0;

  for (const entry of ranked) {
    const full = descriptions.get(entry.job.id);
    if (!full) continue;

    // Truncation is acceptable *here* — this is a prompt, not storage. The full
    // text stays in the sidecar, so nothing is lost by trimming what is sent.
    const description = full.slice(0, maxDescription);

    if (current.length > 0 && used + description.length > charBudget) {
      batches.push({ kind: "fit", question: FIT_QUESTION, candidate: skills, items: current });
      current = [];
      used = 0;
    }

    current.push({
      job_id: entry.job.id,
      kind: "fit",
      title: entry.job.title,
      company: entry.job.company_name,
      description,
    });
    used += description.length;
  }

  if (current.length > 0) {
    batches.push({ kind: "fit", question: FIT_QUESTION, candidate: skills, items: current });
  }

  return batches;
}

export interface DisciplineAnswer {
  job_id: string;
  verdict: "yes" | "no" | "unclear";
}

export interface FitAnswer {
  job_id: string;
  score: number;
  reasoning: string;
}

export interface AppliedReview<T> {
  answers: Map<string, T>;
  /** Items the model was asked about but did not answer. */
  unanswered: string[];
  /** Answers for ids that were never asked about. */
  unexpected: string[];
}

/**
 * Reconciles a model's answers against what it was asked.
 *
 * A model that silently drops items, or invents ids, must not be allowed to
 * quietly shrink or corrupt the shortlist — both discrepancies are reported so
 * the caller decides what to do rather than discovering it later.
 */
export function applyAnswers<T extends { job_id: string }>(
  batches: ReviewBatch[],
  answers: T[]
): AppliedReview<T> {
  const asked = new Set(batches.flatMap((batch) => batch.items.map((item) => item.job_id)));
  const byId = new Map<string, T>();
  const unexpected: string[] = [];

  for (const answer of answers) {
    if (!asked.has(answer.job_id)) {
      unexpected.push(answer.job_id);
      continue;
    }
    byId.set(answer.job_id, answer);
  }

  return {
    answers: byId,
    unanswered: [...asked].filter((id) => !byId.has(id)),
    unexpected,
  };
}

/** Clamps a model-supplied score into range rather than trusting it blindly. */
export function normalizeFitScore(value: unknown): number | null {
  const score = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(score)) return null;
  return Math.min(1, Math.max(0, score));
}
