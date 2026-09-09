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
      // `scrapeableCompensationSalarySummary` is a display *string*
      // ("$211.4K - $290.6K"); the numbers live in the salary component of a
      // compensation tier. Reading the summary as an object silently produced
      // no compensation at all for every Ashby job.
      const salary = asArray(asRecord(job.compensation).compensationTiers)
        .flatMap((tier) => asArray(asRecord(tier).components))
        .map(asRecord)
        .find(
          (component) =>
            component.compensationType === "Salary" &&
            (typeof component.minValue === "number" || typeof component.maxValue === "number")
        );

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
        compensation: salary
          ? {
              min: typeof salary.minValue === "number" ? salary.minValue : undefined,
              max: typeof salary.maxValue === "number" ? salary.maxValue : undefined,
              currency: asString(salary.currencyCode),
              interval: asString(salary.interval),
            }
          : undefined,
      };
    });

    return { jobs, hasMore: false, total: jobs.length };
  },
};
