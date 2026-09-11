import { asArray, asRecord, asString, looksRemote, splitLocations, toPlainText } from "./types.js";
import type { ProviderAdapter, ProviderPage } from "./types.js";

const PAGE_SIZE = 100;

/**
 * Amazon's own careers portal.
 *
 * Amazon runs no third-party ATS, so the generic fingerprints never match it —
 * yet it is one of the largest employers in a typical network (Amazon and AWS
 * together account for the biggest single block of connections in the export
 * this was built against). A small bespoke adapter is worth more here than
 * another generic one.
 *
 * The endpoint is the same public JSON search the careers site itself calls.
 */
export const amazon: ProviderAdapter = {
  id: "amazon",

  fingerprints: [/(?:www\.)?amazon\.jobs(?:\/[a-z-]+)?/i],

  accountFrom() {
    // Amazon has exactly one board; there is no per-employer account.
    return { id: "amazon" };
  },

  endpoint(_account, page) {
    const params = new URLSearchParams({
      normalized_country_code: "",
      radius: "24km",
      facets: "",
      offset: String(page * PAGE_SIZE),
      result_limit: String(PAGE_SIZE),
      sort: "recent",
      "latitude[]": "",
      "longitude[]": "",
      base_query: "",
    });
    return { url: `https://www.amazon.jobs/en/search.json?${params.toString()}`, method: "GET" };
  },

  normalize(payload): ProviderPage {
    const root = asRecord(payload);
    const entries = asArray(root.jobs);

    const jobs = entries.map((entry) => {
      const job = asRecord(entry);
      const location = asString(job.normalized_location) ?? asString(job.location);
      const path = asString(job.job_path);

      return {
        providerJobId: asString(job.id_icims) ?? asString(job.id),
        title: asString(job.title) ?? "(untitled)",
        locations: splitLocations(location),
        remote: looksRemote(location, asString(job.title)),
        department: asString(job.business_category) ?? asString(job.job_category),
        employmentType: asString(job.job_schedule_type),
        description: toPlainText(asString(job.description)),
        publishedAt: asString(job.posted_date),
        updatedAt: asString(job.updated_time),
        jobUrl: path ? `https://www.amazon.jobs${path}` : undefined,
      };
    });

    const total = typeof root.hits === "number" ? root.hits : undefined;
    const hasMore = entries.length === PAGE_SIZE;

    return { jobs, hasMore, total };
  },
};
