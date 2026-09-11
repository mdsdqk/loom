import { discoverCareersPage } from "./careers.js";
import type { CareersDiscoveryDeps } from "./careers.js";
import { fingerprint } from "./fingerprint.js";
import type { BrowserProbe } from "./browser-probe.js";
import { ADAPTERS, getAdapter } from "./providers/index.js";
import type { FetchSpec, ProviderAccount } from "./providers/types.js";
import { isSuccess } from "./http/client.js";
import type { HttpClient } from "./http/client.js";
import type { HiringSource } from "./schema.js";

/**
 * Company → hiring source.
 *
 * The output is a cache of how a company exposes its jobs, so later scans fetch
 * directly instead of rediscovering. The acceptance rule is the same one that
 * governs domain resolution: a board is only attributed to a company when the
 * company's own careers page linked to it, or when the provider itself confirms
 * the board's employer. A name-derived guess on its own is never enough.
 */

export interface DiscoverDeps extends CareersDiscoveryDeps {
  client: HttpClient;
  /** Known company_id → hiring source, reused instead of rediscovered. */
  registry: Map<string, HiringSource>;
  /**
   * Optional last resort for pages that render their careers surface in the
   * browser. Omitted, discovery is HTTP-only and simply finds less.
   */
  browser?: BrowserProbe;
}

export interface DiscoverInput {
  companyId: string;
  companyName: string;
  domain: string;
}

/** JSON fetcher handed to adapters for their verification calls. */
function makeFetchJson(client: HttpClient) {
  return async (spec: FetchSpec): Promise<unknown | null> => {
    const result = await client.request({
      url: spec.url,
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
    });
    if (!isSuccess(result) || result.status !== 200) return null;
    try {
      return JSON.parse(result.body);
    } catch {
      return null;
    }
  };
}

/**
 * Tries name-derived account tokens against providers that expose a way to
 * confirm the board's employer. Providers without `verify` are deliberately
 * excluded: an unverifiable guess is exactly the failure mode this pipeline
 * exists to prevent.
 */
async function guessVerifiedAccount(
  companyName: string,
  client: HttpClient
): Promise<{ provider: string; account: ProviderAccount; reportedName?: string } | null> {
  const fetchJson = makeFetchJson(client);

  for (const adapter of ADAPTERS) {
    if (!adapter.guessAccounts || !adapter.verify) continue;
    for (const account of adapter.guessAccounts(companyName).slice(0, 2)) {
      const verification = await adapter.verify(account, companyName, fetchJson);
      if (verification.ok) {
        return { provider: adapter.id, account, reportedName: verification.reportedName };
      }
    }
  }
  return null;
}

export async function discoverHiringSource(
  input: DiscoverInput,
  deps: DiscoverDeps
): Promise<HiringSource> {
  const known = deps.registry.get(input.companyId);
  if (known) return { ...known, discovery_method: "registry" };

  const base: HiringSource = {
    company_id: input.companyId,
    company_domain: input.domain,
    provider: "unknown",
    confidence: 0,
    status: "no_careers_page",
  };

  const page = await discoverCareersPage(input.domain, deps);
  if (!page) return base;

  // Only fingerprint a page that actually reads like a careers page. The
  // discovery ladder returns its best non-matching page as a fallback, and a
  // marketing or error page can still mention some board somewhere — which is
  // not the company vouching for it.
  const found = page.looksLikeCareers
    ? fingerprint(page.html, page.url)
    : { matches: [], unsupported: [] };

  // A provider linked from the company's own careers page is the strong case:
  // the employer is vouching for the board, so no further verification is needed.
  const match = found.matches[0];
  if (match) {
    const adapter = getAdapter(match.provider);
    let verifiedName: string | undefined;

    if (adapter?.verify) {
      const verification = await adapter.verify(
        match.account,
        input.companyName,
        makeFetchJson(deps.client)
      );
      verifiedName = verification.reportedName;

      // Any failed verification disqualifies the board. Two distinct failures
      // reach here and both must be rejected:
      //   - the provider names a different employer (a real conflict), and
      //   - the board does not resolve at all, which is what a token scraped
      //     out of example text in a page looks like.
      // Requiring a reported name before rejecting let the second case through
      // as `active`: a live run recorded a Greenhouse board literally called
      // "this_part" for a company, from placeholder text on its careers page.
      if (!verification.ok) {
        return {
          ...base,
          careers_url: page.url,
          provider: match.provider,
          account: match.account.id,
          account_extra: match.account.extra,
          discovery_method: page.method,
          confidence: 0.3,
          status: "failed",
          verified_name: verification.reportedName,
          note: verification.reportedName
            ? `careers page links this board, but the provider reports "${verification.reportedName}"`
            : `board did not verify: ${verification.reason ?? "unknown reason"}`,
        };
      }
    }

    return {
      ...base,
      careers_url: page.url,
      provider: match.provider,
      account: match.account.id,
      account_extra: match.account.extra,
      discovery_method: page.method,
      confidence: verifiedName ? 0.99 : 0.95,
      status: "active",
      verified_name: verifiedName,
    };
  }

  // Nothing linked. Try name-derived account tokens, but only for providers
  // that can prove ownership: a guess is worthless without verification, which
  // is what made naive slug-guessing wrong 4 times out of 5 when measured.
  if (page.looksLikeCareers) {
    const guessed = await guessVerifiedAccount(input.companyName, deps.client);
    if (guessed) {
      return {
        ...base,
        careers_url: page.url,
        provider: guessed.provider,
        account: guessed.account.id,
        discovery_method: "guess_verified",
        // Below a linked board: the company never pointed at this one, the
        // provider merely confirmed the name matches.
        confidence: 0.8,
        status: "active",
        verified_name: guessed.reportedName,
      };
    }
  }

  // Recognised, but no adapter yet. The account is kept so adding the adapter
  // later needs no re-crawl.
  const unsupported = found.unsupported[0];
  if (unsupported) {
    return {
      ...base,
      careers_url: page.url,
      provider: `unsupported:${unsupported.provider}`,
      account: unsupported.account,
      discovery_method: page.method,
      confidence: 0.9,
      status: "unsupported",
      note: unsupported.evidence,
    };
  }

  // Nothing in the static markup. Large employers commonly render the careers
  // surface client-side, so the board only appears once scripts have run.
  if (deps.browser && page.looksLikeCareers) {
    const rendered = await deps.browser.probe(page.url);
    if (rendered) {
      // Fingerprint the rendered DOM *and* the URLs it requested: an embedded
      // board often shows up only as an XHR to the provider's API.
      const afterRender = fingerprint(
        [rendered.html, ...rendered.requestUrls].join("\n"),
        rendered.finalUrl
      );

      const renderedMatch = afterRender.matches[0];
      if (renderedMatch) {
        return {
          ...base,
          careers_url: page.url,
          provider: renderedMatch.provider,
          account: renderedMatch.account.id,
          account_extra: renderedMatch.account.extra,
          discovery_method: page.method,
          // Weaker than a plain link: the page referenced this board while
          // rendering, which is good evidence but not the employer stating it.
          confidence: 0.85,
          status: "active",
          note: "found by rendering the careers page",
        };
      }

      const renderedUnsupported = afterRender.unsupported[0];
      if (renderedUnsupported) {
        return {
          ...base,
          careers_url: page.url,
          provider: `unsupported:${renderedUnsupported.provider}`,
          account: renderedUnsupported.account,
          discovery_method: page.method,
          confidence: 0.8,
          status: "unsupported",
          note: `found by rendering: ${renderedUnsupported.evidence}`,
        };
      }
    }
  }

  return {
    ...base,
    careers_url: page.url,
    discovery_method: page.method,
    status: page.looksLikeCareers ? "no_provider" : "no_careers_page",
    confidence: page.looksLikeCareers ? 0.5 : 0,
  };
}
