import { registrableDomain } from "./domains.js";
import { isSuccess } from "./http/client.js";
import type { HttpClient, HttpResponse } from "./http/client.js";
import type { RobotsCache } from "./http/robots.js";

/**
 * Finding a company's careers surface, given its verified domain.
 *
 * Strategies run cheapest-and-most-reliable first and stop at the first page
 * that looks like a careers page. None of them crawl: an unbounded crawler over
 * hundreds of employer sites is both slow and rude, and the careers page is
 * almost always one hop from the homepage or listed in the sitemap.
 */

const CAREER_WORDS =
  /(career|careers|jobs|job-openings|join-us|joinus|work-with-us|workwithus|opportunities|openings|vacancies|life-at|employment)/i;

/** A small, fixed set of conventional paths — deliberately not generated. */
const COMMON_PATHS = [
  "/careers",
  "/careers/",
  "/career",
  "/jobs",
  "/company/careers",
  "/about/careers",
  "/en/careers",
  "/join-us",
];

export type CareersDiscoveryMethod = "registry" | "sitemap" | "homepage" | "common_path";

export interface CareersPage {
  url: string;
  method: CareersDiscoveryMethod;
  html: string;
  /** Whether the page actually reads like a careers page rather than a soft 404. */
  looksLikeCareers: boolean;
}

export interface CareersDiscoveryDeps {
  client: HttpClient;
  robots: RobotsCache;
  /** Cap on pages fetched per company, so one site cannot dominate a scan. */
  maxFetches?: number;
}

async function fetchAllowed(
  url: string,
  deps: CareersDiscoveryDeps
): Promise<HttpResponse | null> {
  if (!(await deps.robots.allows(url))) return null;
  const result = await deps.client.get(url);
  if (!isSuccess(result) || result.status >= 400) return null;
  if (!/html|xml|text/i.test(result.contentType)) return null;
  return result;
}

/**
 * A soft-404 check. Many sites answer every path with their homepage, so a
 * 200 alone says nothing about whether a careers page was found.
 */
export function looksLikeCareersPage(html: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // The careers word lives in the hostname as often as the path — dedicated
  // careers subdomains and job-specific domains (careers.example.com,
  // example.jobs) are the norm for larger employers.
  const claimsCareers =
    CAREER_WORDS.test(parsed.pathname) || CAREER_WORDS.test(parsed.hostname);
  if (!claimsCareers) return false;

  // The URL claims to be careers; require the body to agree at least weakly,
  // so a soft 404 that redirects to a marketing page is not mistaken for one.
  return /\b(job|role|position|opening|vacanc|apply|hiring|career)/i.test(html.slice(0, 200_000));
}

/**
 * Pulls same-site links whose URL or anchor text mentions careers.
 *
 * Same-site is enforced, not merely intended. An off-site link is very often a
 * partner's, a parent's, or an agency's board, and following one lets another
 * employer's postings be attributed to this company — the exact failure the
 * pipeline exists to prevent. A dedicated careers subdomain
 * (careers.example.com) is still the same site, so comparison is on the
 * registrable domain rather than the exact host.
 */
export function careerLinksFrom(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const baseDomain = registrableDomain(base.hostname);
  const found: string[] = [];
  const seen = new Set<string>();

  const anchors = html.slice(0, 400_000).match(/<a\b[^>]{0,1000}>[\s\S]{0,200}?<\/a>/gi) ?? [];
  for (const anchor of anchors) {
    const href = /href\s*=\s*["']([^"']{1,500})["']/i.exec(anchor)?.[1];
    if (!href) continue;
    const text = anchor.replace(/<[^>]{0,1000}>/g, " ");
    if (!CAREER_WORDS.test(href) && !CAREER_WORDS.test(text)) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(resolved.protocol)) continue;
    if (registrableDomain(resolved.hostname) !== baseDomain) continue;

    resolved.hash = "";
    const key = resolved.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
    if (found.length >= 8) break;
  }

  return found;
}

/** Reads a sitemap (or sitemap index) and returns career-ish URLs. */
export function careerUrlsFromSitemap(xml: string): { pages: string[]; indexes: string[] } {
  const locations = [...xml.matchAll(/<loc>\s*([^<\s]{1,500})\s*<\/loc>/gi)].map((m) => m[1]);
  const pages: string[] = [];
  const indexes: string[] = [];

  for (const location of locations) {
    if (/sitemap[^/]*\.xml/i.test(location)) {
      if (CAREER_WORDS.test(location) || indexes.length < 5) indexes.push(location);
      continue;
    }
    if (CAREER_WORDS.test(location)) pages.push(location);
    if (pages.length >= 10) break;
  }

  return { pages, indexes };
}

/**
 * Runs the discovery ladder for one domain, returning the first page that
 * reads like a careers page, or the best non-matching page fetched.
 */
export async function discoverCareersPage(
  domain: string,
  deps: CareersDiscoveryDeps
): Promise<CareersPage | null> {
  const budget = deps.maxFetches ?? 8;
  let fetches = 0;
  let fallback: CareersPage | null = null;

  const consider = (
    url: string,
    html: string,
    method: CareersDiscoveryMethod
  ): CareersPage | null => {
    const page: CareersPage = {
      url,
      html,
      method,
      looksLikeCareers: looksLikeCareersPage(html, url),
    };
    if (page.looksLikeCareers) return page;
    fallback ??= page;
    return null;
  };

  // 1. Sitemap — the site telling us where its careers pages are.
  if (fetches < budget) {
    fetches++;
    const sitemap = await fetchAllowed(`https://${domain}/sitemap.xml`, deps);
    if (sitemap) {
      const { pages, indexes } = careerUrlsFromSitemap(sitemap.body);

      // Follow at most one index, and only when the top level had nothing.
      if (pages.length === 0 && indexes.length > 0 && fetches < budget) {
        fetches++;
        const nested = await fetchAllowed(indexes[0], deps);
        if (nested) pages.push(...careerUrlsFromSitemap(nested.body).pages);
      }

      for (const url of pages.slice(0, 2)) {
        if (fetches >= budget) break;
        fetches++;
        const page = await fetchAllowed(url, deps);
        if (!page) continue;
        const hit = consider(page.finalUrl, page.body, "sitemap");
        if (hit) return hit;
      }
    }
  }

  // 2. Homepage links — one hop, no crawling.
  if (fetches < budget) {
    fetches++;
    const home = await fetchAllowed(`https://${domain}/`, deps);
    if (home) {
      for (const url of careerLinksFrom(home.body, home.finalUrl).slice(0, 3)) {
        if (fetches >= budget) break;
        fetches++;
        const page = await fetchAllowed(url, deps);
        if (!page) continue;
        const hit = consider(page.finalUrl, page.body, "homepage");
        if (hit) return hit;
      }
    }
  }

  // 3. Conventional paths.
  for (const path of COMMON_PATHS) {
    if (fetches >= budget) break;
    fetches++;
    const page = await fetchAllowed(`https://${domain}${path}`, deps);
    if (!page) continue;
    const hit = consider(page.finalUrl, page.body, "common_path");
    if (hit) return hit;
  }

  return fallback;
}
