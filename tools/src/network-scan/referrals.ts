import type { Company, Connection, SeniorityBand } from "./schema.js";

/**
 * Who to ask.
 *
 * Finding the jobs is only half of a referral pipeline: a posting is only
 * actionable if it comes with the person at that company worth approaching.
 * Every input here already exists in the candidate's own export — who they are
 * connected to, what those people do, and how recently they connected — so the
 * ranking is arithmetic over stated facts, with no model and no inference about
 * anyone's willingness to help.
 *
 * The output is a suggestion to a human, never an action: nothing here contacts
 * anyone, and the ranking is shown with its reasons so the candidate can
 * disagree with it.
 */

/**
 * How much weight a connection's seniority carries for a referral.
 *
 * Leaders and hiring managers can route a referral directly; senior individual
 * contributors are usually trusted to vouch. A junior colleague can still file
 * one at most companies, so they score above zero rather than being excluded.
 */
const SENIORITY_WEIGHT: Record<SeniorityBand, number> = {
  leadership: 5,
  lead: 4,
  senior: 3,
  mid: 2,
  junior: 1,
  unknown: 1,
};

/** LinkedIn writes `Connected On` as e.g. "17 Aug 2026". */
export function parseConnectedOn(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A recency multiplier, not a cliff.
 *
 * A connection made years ago is weaker than a recent one, but it is still a
 * connection — someone the candidate worked with in 2019 may be a far better
 * referrer than a conference acquaintance from last month. The curve is gentle
 * and bottoms out rather than reaching zero.
 */
export function recencyFactor(connectedOn: Date | null, now: Date): number {
  if (!connectedOn) return 0.8;
  const years = (now.getTime() - connectedOn.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 1) return 1;
  if (years <= 3) return 0.9;
  if (years <= 6) return 0.8;
  return 0.7;
}

export interface Referrer {
  name: string;
  position?: string;
  seniority: SeniorityBand;
  linkedinUrl?: string;
  connectedOn?: string;
  score: number;
  /** Plain-language reasons, so the ranking can be argued with. */
  reasons: string[];
}

export function scoreReferrer(connection: Connection, company: Company, now: Date): Referrer {
  const weight = SENIORITY_WEIGHT[connection.seniority];
  const recency = recencyFactor(parseConnectedOn(connection.connected_on), now);

  const reasons: string[] = [];
  if (connection.seniority === "leadership" || connection.seniority === "lead") {
    reasons.push("senior enough to route a referral directly");
  } else if (connection.seniority === "senior") {
    reasons.push("senior individual contributor");
  }
  if (recency === 1) reasons.push("connected within the last year");
  else if (recency <= 0.7) reasons.push("a long-standing connection");

  // A former colleague is the strongest referral there is: they can speak to
  // the candidate's work first-hand rather than vouching on acquaintance.
  let bonus = 0;
  if (company.signals.ex_employer) {
    bonus += 3;
    reasons.push("you worked at this company — likely a former colleague");
  }
  if (company.signals.alumni) {
    bonus += 1;
    reasons.push("you studied here");
  }

  return {
    name: connection.name,
    position: connection.position,
    seniority: connection.seniority,
    linkedinUrl: connection.linkedin_url,
    connectedOn: connection.connected_on,
    score: Number((weight * recency + bonus).toFixed(2)),
    reasons,
  };
}

/**
 * The people at one company worth approaching, best first.
 *
 * Ordering is fully determined — score, then seniority, then name — so the same
 * export always produces the same suggestion rather than depending on the order
 * connections happened to appear in the CSV.
 */
export function rankReferrers(company: Company, now: Date = new Date(), limit = 3): Referrer[] {
  const order: SeniorityBand[] = ["leadership", "lead", "senior", "mid", "junior", "unknown"];

  return company.connections
    .map((connection) => scoreReferrer(connection, company, now))
    .sort(
      (a, b) =>
        b.score - a.score ||
        order.indexOf(a.seniority) - order.indexOf(b.seniority) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    )
    .slice(0, limit);
}

/** Company id → the people to ask there. */
export function buildReferrerIndex(
  companies: Company[],
  now: Date = new Date(),
  limit = 3
): Map<string, Referrer[]> {
  return new Map(companies.map((company) => [company.id, rankReferrers(company, now, limit)]));
}
