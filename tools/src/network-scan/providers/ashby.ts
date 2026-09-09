import {
  asArray,
  asRecord,
  asString,
  looksRemote,
  splitLocations,
  toPlainText,
} from "./types.js";
import type { ProviderAdapter, ProviderPage } from "./types.js";

/** Ashby job boards, served from a single public posting endpoint per board. */
export const ashby: ProviderAdapter = {
  id: "ashby",

  fingerprints: [
    /jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/,
    /api\.ashbyhq\.com\/posting-api\/job-board\/([a-zA-Z0-9_-]+)/,
    /embed\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/,
  ],

  accountFrom(match) {
    const id = match[1];
    if (!id || ["posting-api", "job-board"].includes(id)) return null;
    return { id };
  },

  endpoint(account) {
    return {
      url: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(account.id)}?includeCompensation=true`,
      method: "GET",
    };
  },

  normalize(payload): ProviderPage {
    const jobs = asArray(asRecord(payload).jobs).map((entry) => {
      const job = asRecord(entry);
      const location = asString(job.location);
      const secondary = asArray(job.secondaryLocations)
        .map((entryValue) => asString(asRecord(entryValue).location))
        .filter((value): value is string => Boolean(value));
      const compensation = asRecord(job.compensation);
      const range = asRecord(asRecord(compensation.scrapeableCompensationSalarySummary));

      return {
        providerJobId: asString(job.id),
        title: asString(job.title) ?? "(untitled)",
        locations: [...splitLocations(location), ...secondary],
        remote: job.isRemote === true || looksRemote(location),
        department: asString(job.department) ?? asString(job.team),
        employmentType: asString(job.employmentType),
        description: toPlainText(asString(job.descriptionHtml) ?? asString(job.descriptionPlain)),
        publishedAt: asString(job.publishedAt),
        updatedAt: asString(job.updatedAt),
        jobUrl: asString(job.jobUrl),
        applyUrl: asString(job.applyUrl) ?? asString(job.jobUrl),
        compensation: range.minValue || range.maxValue
          ? {
              min: typeof range.minValue === "number" ? range.minValue : undefined,
              max: typeof range.maxValue === "number" ? range.maxValue : undefined,
              currency: asString(range.currencyCode),
              interval: asString(range.interval),
            }
          : undefined,
      };
    });

    return { jobs, hasMore: false, total: jobs.length };
  },
};
