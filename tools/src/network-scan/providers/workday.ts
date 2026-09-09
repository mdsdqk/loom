import { asArray, asRecord, asString, looksRemote, splitLocations } from "./types.js";
import type { ProviderAdapter, ProviderPage } from "./types.js";

const PAGE_SIZE = 20;

/** A Workday requisition id: a short letter prefix and digits, never spaces. */
const REQUISITION_ID = /^[A-Z]{1,5}[-_]?\d{3,}$/i;

/**
 * Workday career sites.
 *
 * Addressing a Workday board needs three values — tenant, data-centre number
 * (`wd1`, `wd5`, …) and site name — and none of them can be guessed: probing
 * with an invented site name returns HTTP 422 while a correctly fingerprinted
 * one returns thousands of postings. So there is no `guessAccounts` here by
 * design; a Workday board is only ever reachable when the company's own careers
 * page pointed at it.
 *
 * It is also the highest-volume provider in a typical enterprise-heavy network,
 * and it pages 20 at a time, which is where rate limiting actually bites.
 */
export const workday: ProviderAdapter = {
  id: "workday",

  fingerprints: [
    /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/,
    /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/wday\/cxs\/[a-z0-9-]+\/([A-Za-z0-9_-]+)/,
  ],

  accountFrom(match) {
    const [, tenant, dc, site] = match;
    if (!tenant || !dc || !site) return null;
    // `wday` and `cxs` are API path segments, never a site name.
    if (["wday", "cxs", "en-US"].includes(site)) return null;
    return { id: `${tenant}/${dc}/${site}`, extra: { tenant, dc, site } };
  },

  endpoint(account, page) {
    const { tenant, dc, site } = account.extra ?? {};
    return {
      url: `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        appliedFacets: {},
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        searchText: "",
      }),
    };
  },

  normalize(payload, account): ProviderPage {
    const root = asRecord(payload);
    const postings = asArray(root.jobPostings);
    const { tenant, dc, site } = account.extra ?? {};
    const base = `https://${tenant}.${dc}.myworkdayjobs.com/${site}`;

    const jobs = postings.map((entry) => {
      const job = asRecord(entry);
      const path = asString(job.externalPath);

      // Tenants differ in where they put things. Some return `locationsText`;
      // others (Accenture, for one) return only `bulletFields`, which holds the
      // requisition id and the location together with no labels. Requisition
      // ids are a compact code with no spaces, so the two are separable.
      const bullets = asArray(job.bulletFields)
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value));
      const requisitionId = bullets.find((value) => REQUISITION_ID.test(value));
      const locationsText = asString(job.locationsText);
      const locations = locationsText
        ? splitLocations(locationsText)
        : bullets.filter((value) => value !== requisitionId);

      return {
        providerJobId: requisitionId ?? bullets[0],
        title: asString(job.title) ?? "(untitled)",
        locations,
        remote: looksRemote(locationsText, ...locations, asString(job.title)),
        // Workday reports posting age as prose ("Posted 30+ Days Ago"), which
        // is not a date, so it is deliberately not mapped to publishedAt.
        jobUrl: path ? `${base}${path}` : undefined,
      };
    });

    const total = typeof root.total === "number" ? root.total : undefined;
    const hasMore = postings.length === PAGE_SIZE;

    return { jobs, hasMore, total };
  },
};
