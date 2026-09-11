import { titleAffinity } from "./title-affinity.js";
import { recentHeldTitles } from "./rank.js";
import { LEVELS, titleLevel } from "./structural.js";
import type { Level } from "./structural.js";
import type { CandidatePreferences, Career } from "../schema.js";

/**
 * Tells the candidate when their declared job-seeker preferences and their
 * actual career history disagree, instead of silently trusting one over the
 * other.
 *
 * The matcher already widens targeting with recent career history (see
 * `recentHeldTitles`) and scores every job's seniority against the
 * candidate's current level (see `levelFit` in `structural.ts`) — both of
 * which quietly work around a stale declaration. Doing that *silently* would
 * be its own kind of wrong: the candidate typed those preferences for a
 * reason that may still be current even if the tool suspects otherwise, and
 * a five-year-old field might equally be exactly what they still want. This
 * module only produces evidence; it never edits the declaration or drops it
 * from targeting.
 */

export interface StalenessWarning {
  /** The declared preference title this warning is about. */
  declared_title: string;
  /** What the career history says the candidate is doing now. */
  current_title: string;
  /** Plain-language observation naming the declared title, the current title, and the evidence. */
  message: string;
}

/**
 * Checks one declared title against career reality.
 *
 * Two independent kinds of evidence, either enough on its own:
 *   - the title's own implied level reads two or more steps below the
 *     candidate's current one. Most declared titles carry no seniority
 *     prefix and `titleLevel` honestly defaults those to "mid" rather than
 *     guessing low — so this only fires for a title whose *wording* actually
 *     says junior ("Junior Web Developer"), which is deliberate: the matcher
 *     was already told not to penalise an unprefixed declared title for
 *     ranking, and the same restraint applies here.
 *   - the title shares no target at all with the candidate's recent history
 *     — not even a generic word like "engineer" or "developer". This is what
 *     actually catches "Web Developer" against a current "Senior Software
 *     Engineer": the string itself reads as an ordinary, unprefixed "mid"
 *     title and would not trip the level check, but it has nothing in common
 *     with what the candidate has held for years.
 */
function evidenceFor(declaredTitle: string, career: Career, recent: string[]): string[] {
  const evidence: string[] = [];
  const currentLevel = career.current_level as Level | undefined;

  if (currentLevel !== undefined) {
    const declaredLevel = titleLevel(declaredTitle);
    const step = LEVELS.indexOf(declaredLevel) - LEVELS.indexOf(currentLevel);
    if (step <= -2) {
      evidence.push(
        `reads as ${declaredLevel}, ${Math.abs(step)} levels below your current ${currentLevel} (${career.current_title})`
      );
    }
  }

  if (recent.length > 0 && titleAffinity(declaredTitle, recent) === 0) {
    evidence.push(`shares no target with your recent titles (${recent.join(", ")})`);
  }

  return evidence;
}

/**
 * Compares every declared preference title against career reality and
 * reports the ones that look stale, with the evidence for each.
 *
 * Returns nothing when there is nothing to compare — no declared titles, or
 * no career history to check them against — and nothing when everything
 * declared still agrees with where the candidate's history says they are.
 */
export function checkPreferenceStaleness(
  preferences: CandidatePreferences,
  career: Career
): StalenessWarning[] {
  if (!career.current_title || preferences.titles.length === 0) return [];

  const recent = recentHeldTitles(career);
  const warnings: StalenessWarning[] = [];

  for (const declared of preferences.titles) {
    const evidence = evidenceFor(declared, career, recent);
    if (evidence.length === 0) continue;

    warnings.push({
      declared_title: declared,
      current_title: career.current_title,
      message:
        `Declared target "${declared}" may be stale against your current "${career.current_title}": ` +
        `${evidence.join("; ")}. Still used as a target, but weighted below the roles your history shows — say so if that is wrong.`,
    });
  }

  return warnings;
}
