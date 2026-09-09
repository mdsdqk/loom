import {
  asArray,
  asRecord,
  asString,
  looksRemote,
  splitLocations,
  toPlainText,
} from "./types.js";
import type { ProviderAdapter, ProviderPage } from "./types.js";

/**
 * Recruitee job boards.
 *
 * This adapter is the reason the whole pipeline verifies rather than guesses.
 * Probing Recruitee with name-derived tokens produced four confident matches
 * that were all wrong: `collins.recruitee.com` serves KFC Netherlands, and the
 * `google`, `accenture` and `ey` boards are abandoned trial accounts containing
 * Recruitee's own "Senior Marketer (Sample)" demo posting. Both failure shapes
 * are guarded here — the board must name the company, and a board that is
 * nothing but demo postings is rejected outright.
 */

/** Postings Recruitee seeds into a new trial account. */
const DEMO_TITLE = /\(sample\)/i;

export const recruitee: ProviderAdapter = {
  id: "recruitee",

  fingerprints: [
    /([a-z0-9-]+)\.recruitee\.com/i,
    /jobs\.recruitee\.com\/([a-z0-9-]+)/i,
  ],

  accountFrom(match) {
    const id = match[1]?.toLowerCase();
    if (!id || ["www", "jobs", "api"].includes(id)) return null;
    return { id };
  },

  async verify(account, companyName, fetchJson) {
    const payload = asRecord(
      await fetchJson({
        url: `https://${encodeURIComponent(account.id)}.recruitee.com/api/offers/`,
        method: "GET",
      })
    );
    const offers = asArray(payload.offers);
    if (offers.length === 0) return { ok: false, reason: "board has no postings" };

    const real = offers.filter((entry) => !DEMO_TITLE.test(asString(asRecord(entry).title) ?? ""));
    if (real.length === 0) {
      return { ok: false, reason: "board contains only Recruitee sample postings" };
    }

    const reportedName = asString(asRecord(real[0]).company_name);
    if (!reportedName) return { ok: false, reason: "postings do not name a company" };

    const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ok = squash(reportedName).includes(squash(companyName)) ||
      squash(companyName).includes(squash(reportedName));

    return { ok, reportedName, reason: ok ? undefined : `board belongs to "${reportedName}"` };
  },

  endpoint(account) {
    return {
      url: `https://${encodeURIComponent(account.id)}.recruitee.com/api/offers/`,
      method: "GET",
    };
  },

  normalize(payload): ProviderPage {
    const jobs = asArray(asRecord(payload).offers)
      .filter((entry) => !DEMO_TITLE.test(asString(asRecord(entry).title) ?? ""))
      .map((entry) => {
        const job = asRecord(entry);
        const location = asString(job.location) ?? asString(job.city);

        return {
          providerJobId: asString(job.id),
          title: asString(job.title) ?? "(untitled)",
          locations: splitLocations(location),
          remote: job.remote === true || looksRemote(location),
          department: asString(job.department),
          employmentType: asString(job.employment_type),
          description: toPlainText(asString(job.description)),
          publishedAt: asString(job.published_at) ?? asString(job.created_at),
          jobUrl: asString(job.careers_url) ?? asString(job.careers_apply_url),
          applyUrl: asString(job.careers_apply_url),
        };
      });

    return { jobs, hasMore: false, total: jobs.length };
  },
};
