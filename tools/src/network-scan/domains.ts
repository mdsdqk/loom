import { lookup } from "node:dns/promises";
import type { CompanyDomain, DomainAttempt } from "./schema.js";
import { isSuccess } from "./http/client.js";
import type { HttpClient } from "./http/client.js";
import type { RobotsCache } from "./http/robots.js";
import { normalizationKey } from "./import/connections.js";

/**
 * Company → corporate domain.
 *
 * A domain is only ever accepted when the site itself confirms whose it is.
 * Guessing `{name}.com` and trusting the guess is how a scan ends up reporting
 * another company's jobs, so a candidate domain has to serve a page that names
 * the company before anything downstream is allowed to use it.
 */

/** Words that appear in company names without distinguishing the company. */
const GENERIC_TOKENS = new Set([
  "technologies",
  "technology",
  "tech",
  "solutions",
  "systems",
  "services",
  "software",
  "labs",
  "group",
  "holdings",
  "global",
  "international",
  "worldwide",
  "digital",
  "consulting",
  "consultancy",
  "partners",
  "ventures",
  "industries",
  "enterprises",
  "india",
  "usa",
  "online",
]);

/** Tried in order; the first candidate that verifies wins. */
const TLD_ORDER = [".com", ".in", ".io", ".ai", ".co"];

/** Universities sit on academic TLDs, which no amount of `.com` guessing reaches. */
const ACADEMIC_TLDS = [".edu", ".ac.in", ".ac.uk", ".edu.in"];
const ACADEMIC_NAME = /\b(university|college|institute|school|academy|polytechnic)\b/i;

/** Phrases that mark a parked or for-sale domain rather than a company site. */
const PARKED_MARKERS = [
  "domain is for sale",
  "domain may be for sale",
  "domain name is for sale",
  "buy this domain",
  "this domain is parked",
  "domain parking",
  "the domain name you requested",
  "inquire about this domain",
  "make an offer",
  "premium domain",
  "is for sale on",
  "domain registered at",
];

/**
 * Domain marketplaces and parking services. A candidate that lands on one of
 * these is selling the name, not running the company — and because the listing
 * page puts the domain in its own title, name matching alone would accept it.
 */
const MARKETPLACE_HOSTS = [
  "brandbucket.com",
  "sedo.com",
  "hugedomains.com",
  "afternic.com",
  "dan.com",
  "undeveloped.com",
  "squadhelp.com",
  "atom.com",
  "sav.com",
  "bodis.com",
  "parkingcrew.net",
  "above.com",
  "domainmarket.com",
  "buydomains.com",
  "namecheap.com",
  "godaddy.com",
  "safenames.com",
];

/** Strips subdomains down to `example.com`, for comparing redirect targets. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  // Two-part public suffixes (co.uk, com.au, co.in) need one extra label.
  const suffixLength = parts.length >= 3 && /^(co|com|net|org|gov|ac)$/.test(parts.at(-2)!) ? 3 : 2;
  return parts.slice(-suffixLength).join(".");
}

export function distinguishingTokens(companyName: string): string[] {
  const tokens = normalizationKey(companyName).split(" ").filter(Boolean);
  const distinguishing = tokens.filter((token) => !GENERIC_TOKENS.has(token));
  // A name made entirely of generic words still has to be matched on something.
  return distinguishing.length > 0 ? distinguishing : tokens;
}

/**
 * Bounded, ordered list of domains to try. Bounded matters: this runs for every
 * company in the network, so an unbounded candidate set would multiply into
 * thousands of pointless requests.
 */
export function candidateDomains(companyName: string): string[] {
  const tokens = normalizationKey(companyName).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const joined = tokens.join("");
  const hyphenated = tokens.join("-");
  const candidates: string[] = [];

  // Educational institutions live on academic TLDs (pes.edu), and are reachable
  // no other way — the alumni companies in a network are all of this shape.
  if (ACADEMIC_NAME.test(companyName)) {
    for (const tld of ACADEMIC_TLDS) candidates.push(tokens[0] + tld);
    if (tokens.length > 1) candidates.push(joined + ACADEMIC_TLDS[0]);
  }

  for (const tld of TLD_ORDER) candidates.push(joined + tld);
  if (hyphenated !== joined) candidates.push(`${hyphenated}.com`);
  if (tokens.length > 1) {
    candidates.push(`${tokens[0]}.com`);
    candidates.push(`${tokens[0]}.in`);
  }

  return [...new Set(candidates)];
}

export interface IdentitySignals {
  title: string;
  siteName: string;
  applicationName: string;
  description: string;
}

function firstMatch(html: string, pattern: RegExp): string {
  return (pattern.exec(html)?.[1] ?? "").trim();
}

/**
 * Pulls the fields a site uses to name itself out of its HTML head.
 *
 * Scanning is confined to the head and capped, and each `<meta>` tag is matched
 * individually rather than with one pattern spanning the document. Patterns of
 * the form `<meta[^>]+...[^>]+...` backtrack quadratically across a large body,
 * and V8 backtracks on the stack.
 */
export function extractIdentitySignals(html: string): IdentitySignals {
  const headEnd = html.search(/<\/head>/i);
  const head = html.slice(0, headEnd === -1 ? Math.min(html.length, 60_000) : headEnd);

  const signals: IdentitySignals = {
    title: firstMatch(head, /<title[^>]*>([^<]*)</i),
    siteName: "",
    applicationName: "",
    description: "",
  };

  for (const tag of head.match(/<meta\b[^>]{0,2000}>/gi) ?? []) {
    const key = (/\b(?:name|property)\s*=\s*["']([^"']{0,80})["']/i.exec(tag)?.[1] ?? "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    const content = (/\bcontent\s*=\s*["']([^"']{0,500})["']/i.exec(tag)?.[1] ?? "").trim();
    if (!content) continue;

    if (key === "og:site_name" && !signals.siteName) signals.siteName = content;
    else if (key === "application-name" && !signals.applicationName) {
      signals.applicationName = content;
    } else if ((key === "description" || key === "og:description") && !signals.description) {
      signals.description = content;
    }
  }

  return signals;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  /** Which signal carried the match, for auditing a questionable result. */
  matchedOn: string | null;
  weakName: boolean;
  /**
   * Only the distinguishing part of the name matched, not the whole name —
   * e.g. "Tata Consultancy Services" matching a page that says only "Tata".
   * Often a parent company rather than the employer we are looking for.
   */
  partialName: boolean;
}

/**
 * Decides whether a page belongs to the company.
 *
 * Requires every distinguishing token of the company name to appear in how the
 * site names itself. A contiguous phrase match scores higher than scattered
 * tokens, and a very short name (two characters or fewer) is capped low and
 * flagged, because such names collide easily.
 */
export function verifyIdentity(
  companyName: string,
  signals: IdentitySignals,
  bodyStart = ""
): VerificationResult {
  // Scoring uses the *whole* name. Matching only the distinguishing tokens is
  // still accepted, but scores well below a full-name match: "Tata Consultancy
  // Services" against a page saying just "Tata" finds the parent group, not
  // the employer, and that difference has to survive into the confidence.
  const fullTokens = normalizationKey(companyName).split(" ").filter(Boolean);
  const distinguishing = distinguishingTokens(companyName);
  const weakName = distinguishing.every((token) => token.length <= 2);

  const miss: VerificationResult = {
    verified: false,
    confidence: 0,
    matchedOn: null,
    weakName,
    partialName: false,
  };

  if (fullTokens.length === 0) return miss;

  const parked = PARKED_MARKERS.some((marker) =>
    normalizeText(`${signals.title} ${signals.description} ${bodyStart}`).includes(
      normalizeText(marker)
    )
  );
  if (parked) return { ...miss, matchedOn: "parked" };

  const sources: [string, string][] = [
    ["og:site_name", signals.siteName],
    ["title", signals.title],
    ["application-name", signals.applicationName],
    ["description", signals.description],
  ];

  const fullPhrase = fullTokens.join(" ");
  let best = miss;

  for (const [name, raw] of sources) {
    if (!raw) continue;
    const text = normalizeText(raw);
    const squashed = text.replace(/ /g, "");
    const has = (token: string) =>
      new RegExp(`\\b${token}\\b`).test(text) || squashed.includes(token);

    let base: number;
    let partialName = false;

    if (text.includes(fullPhrase) || squashed.includes(fullPhrase.replace(/ /g, ""))) {
      base = 0.95;
    } else if (fullTokens.every(has)) {
      base = 0.88;
    } else if (distinguishing.length < fullTokens.length && distinguishing.every(has)) {
      base = 0.72;
      partialName = true;
    } else {
      continue;
    }

    const confidence = weakName ? Math.min(base, 0.7) : base;

    if (confidence > best.confidence) {
      best = { verified: true, confidence, matchedOn: name, weakName, partialName };
    }
  }

  return best;
}

/**
 * Outcomes ordered by how much they explain, most explanatory first.
 *
 * A company is only unresolved after every candidate failed, and those failures
 * differ in usefulness: "the real site refused us" is a finding, while "the
 * fifth made-up domain has no DNS record" is noise. Attributing a company to
 * its *last* attempt reports mostly noise — it made bot-blocking, the single
 * largest real cause, look like a DNS problem.
 */
const OUTCOME_PRIORITY = [
  "parked",
  "offsite_redirect",
  "name_mismatch",
  "robots_disallowed",
  "blocked",
  "server_error",
  "tls",
  "timeout",
  "network",
  "not_found",
  "no_dns",
];

/** Buckets a raw attempt outcome into the vocabulary the funnel reports. */
export function classifyOutcome(outcome: string): string {
  const status = /^http_(\d{3})$/.exec(outcome)?.[1];
  if (status) {
    const code = Number(status);
    // 401/403/406/429 and friends are a live site declining an automated
    // client — a very different fact from the page not existing.
    if (code === 404 || code === 410) return "not_found";
    if (code >= 500) return "server_error";
    return "blocked";
  }
  return outcome;
}

/**
 * The single most explanatory reason a company failed to resolve, across all of
 * its attempts.
 */
export function summarizeAttempts(attempts: DomainAttempt[]): string {
  if (attempts.length === 0) return "no_candidates";

  let best = "no_dns";
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const attempt of attempts) {
    const outcome = classifyOutcome(attempt.outcome);
    const rank = OUTCOME_PRIORITY.indexOf(outcome);
    const effective = rank === -1 ? OUTCOME_PRIORITY.length : rank;
    if (effective < bestRank) {
      bestRank = effective;
      best = outcome;
    }
  }
  return best;
}

export interface DomainResolverDeps {
  client: HttpClient;
  robots: RobotsCache;
  /** Curated company key → domain, consulted before any guessing. */
  registry: Map<string, string>;
  /** Cheap existence check, so dead guesses never cost an HTTP request. */
  hostExists?: (host: string) => Promise<boolean>;
}

/**
 * Memoized existence check. Candidate domains repeat across companies with
 * similar names, and a resolved lookup is worth keeping for the run — DNS is
 * the one part of discovery the HTTP cache cannot make free.
 */
const dnsCache = new Map<string, Promise<boolean>>();

async function dnsExists(host: string): Promise<boolean> {
  let pending = dnsCache.get(host);
  if (!pending) {
    pending = lookup(host).then(
      () => true,
      () => false
    );
    dnsCache.set(host, pending);
  }
  return pending;
}

export interface CompanyLike {
  id: string;
  canonical_name: string;
  aliases?: string[];
}

/**
 * Runs the resolution ladder for one company: registry first, then verified
 * guesses. Records every attempt so an unresolved company can be explained.
 */
export async function resolveCompanyDomain(
  company: CompanyLike,
  deps: DomainResolverDeps
): Promise<CompanyDomain> {
  const attempts: DomainAttempt[] = [];
  const key = normalizationKey(company.canonical_name);

  const known = deps.registry.get(key);
  if (known) {
    return {
      company_id: company.id,
      domain: known,
      status: "verified",
      method: "registry",
      confidence: 0.98,
      matched_on: "registry",
      weak_name: false,
      partial_name: false,
      attempts,
    };
  }

  const hostExists = deps.hostExists ?? dnsExists;

  for (const candidate of candidateDomains(company.canonical_name)) {
    if (!(await hostExists(candidate))) {
      attempts.push({ domain: candidate, outcome: "no_dns" });
      continue;
    }

    const url = `https://${candidate}/`;
    if (!(await deps.robots.allows(url))) {
      attempts.push({ domain: candidate, outcome: "robots_disallowed" });
      continue;
    }

    const result = await deps.client.get(url);
    if (!isSuccess(result)) {
      attempts.push({ domain: candidate, outcome: result.reason });
      continue;
    }
    if (result.status >= 400) {
      attempts.push({ domain: candidate, outcome: `http_${result.status}` });
      continue;
    }

    // Follow the site's own redirect target, so www/apex and country
    // redirects settle on the domain the company actually serves from.
    let finalDomain = candidate;
    try {
      finalDomain = new URL(result.finalUrl).host.replace(/^www\./, "");
    } catch {
      // Keep the candidate if the final URL is unparseable.
    }

    const finalRegistrable = registrableDomain(finalDomain);
    if (MARKETPLACE_HOSTS.includes(finalRegistrable)) {
      attempts.push({ domain: candidate, outcome: "parked" });
      continue;
    }

    // A candidate that redirects to an unrelated registrable domain is a
    // for-sale listing or a squatter far more often than a rebrand. Such a
    // page still names the company — that is how it advertises the domain —
    // so require the destination itself to carry the company's name.
    if (finalRegistrable !== registrableDomain(candidate)) {
      const tokens = distinguishingTokens(company.canonical_name);
      const destination = finalRegistrable.replace(/[^a-z0-9]/g, "");
      if (!tokens.some((token) => destination.includes(token))) {
        attempts.push({ domain: candidate, outcome: "offsite_redirect", title: finalDomain });
        continue;
      }
    }

    const signals = extractIdentitySignals(result.body);
    const verification = verifyIdentity(company.canonical_name, signals, result.body.slice(0, 4000));
    if (!verification.verified) {
      attempts.push({
        domain: candidate,
        outcome: verification.matchedOn === "parked" ? "parked" : "name_mismatch",
        title: signals.title.slice(0, 120) || undefined,
      });
      continue;
    }

    // A company found on a country or novelty TLD rather than .com is more
    // often a squatter or a regional reseller, so it carries less confidence.
    const offComTld = !candidate.endsWith(".com");
    const confidence = Number(
      (offComTld ? verification.confidence - 0.07 : verification.confidence).toFixed(2)
    );

    attempts.push({ domain: candidate, outcome: "verified" });
    return {
      company_id: company.id,
      domain: finalDomain,
      status: "verified",
      method: "guess_verified",
      confidence,
      matched_on: verification.matchedOn ?? undefined,
      weak_name: verification.weakName,
      partial_name: verification.partialName,
      attempts,
    };
  }

  return {
    company_id: company.id,
    status: "unresolved",
    method: "none",
    confidence: 0,
    weak_name: false,
    partial_name: false,
    attempts,
  };
}
