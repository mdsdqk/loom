import { ADAPTERS } from "./providers/index.js";
import type { ProviderAccount, ProviderId } from "./providers/types.js";

/**
 * Identifying which applicant-tracking system a careers page runs on.
 *
 * Detection is separate from job fetching on purpose: a page can be recognised
 * as a provider we have no adapter for, and recording that is still worth
 * doing — the account is captured now so adding the adapter later needs no
 * re-crawl of the whole network.
 */

export interface ProviderMatch {
  provider: ProviderId;
  account: ProviderAccount;
  /** The text that matched, kept so a questionable detection can be audited. */
  evidence: string;
}

/** Providers we can recognise but cannot yet fetch from. */
const UNSUPPORTED_MARKERS: [string, RegExp][] = [
  ["darwinbox", /([a-z0-9-]+)\.darwinbox\.(?:in|com)/i],
  ["keka", /([a-z0-9-]+)\.keka\.com/i],
  ["zoho_recruit", /([a-z0-9-]+)\.zohorecruit\.(?:com|in|eu)/i],
  ["freshteam", /([a-z0-9-]+)\.freshteam\.com/i],
  ["eightfold", /([a-z0-9-]+)\.eightfold\.ai/i],
  ["phenom", /phenompeople\.com|\.phenom\.com/i],
  ["icims", /([a-z0-9-]+)\.icims\.com/i],
  ["successfactors", /career\d*\.(?:successfactors|sapsf)\.(?:com|eu)/i],
  ["taleo", /([a-z0-9-]+)\.taleo\.net/i],
  ["oracle_cloud", /[a-z0-9-]+\.oraclecloud\.com\/hcmUI/i],
  ["bamboohr", /([a-z0-9-]+)\.bamboohr\.com/i],
  ["personio", /([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i],
  ["teamtailor", /([a-z0-9-]+)\.teamtailor\.com/i],
  ["jobvite", /jobs\.jobvite\.com\/([a-z0-9-]+)/i],
  ["ripplinghq", /ats\.rippling\.com\/([a-z0-9-]+)/i],
];

export interface UnsupportedMatch {
  provider: string;
  account?: string;
  evidence: string;
}

export interface FingerprintResult {
  matches: ProviderMatch[];
  unsupported: UnsupportedMatch[];
}

/**
 * Scans a page's HTML and URL for provider signatures.
 *
 * Both are searched because an employer may embed a board via a script tag,
 * iframe, or link without ever navigating to the provider's domain.
 */
export function fingerprint(html: string, pageUrl: string): FingerprintResult {
  // Cap the scanned text: fingerprinting runs on every discovered page, and
  // some careers pages ship hundreds of kilobytes of inline script.
  const haystack = `${pageUrl}\n${html.slice(0, 400_000)}`;

  const matches: ProviderMatch[] = [];
  const seen = new Set<string>();

  for (const adapter of ADAPTERS) {
    for (const pattern of adapter.fingerprints) {
      // Patterns are authored without /g, so exec is a single deterministic match.
      const match = pattern.exec(haystack);
      if (!match) continue;

      const account = adapter.accountFrom(match, pageUrl);
      if (!account) continue;

      const key = `${adapter.id}:${account.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      matches.push({
        provider: adapter.id,
        account,
        evidence: match[0].slice(0, 200),
      });
      break;
    }
  }

  const unsupported: UnsupportedMatch[] = [];
  for (const [provider, pattern] of UNSUPPORTED_MARKERS) {
    const match = pattern.exec(haystack);
    if (!match) continue;
    unsupported.push({
      provider,
      account: match[1],
      evidence: match[0].slice(0, 200),
    });
  }

  return { matches, unsupported };
}
