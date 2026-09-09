import {
  asArray,
  asRecord,
  asString,
  looksRemote,
  splitLocations,
  toPlainText,
} from "./types.js";
import type { ProviderAdapter, ProviderPage } from "./types.js";

/** Workable job boards, served through the public careers widget API. */
export const workable: ProviderAdapter = {
  id: "workable",

  fingerprints: [
    /apply\.workable\.com\/([a-z0-9-]+)/i,
    /([a-z0-9-]+)\.workable\.com/i,
  ],

  accountFrom(match) {
    const id = match[1]?.toLowerCase();
    if (!id || ["apply", "www", "help", "careers"].includes(id)) return null;
    return { id };
  },

  async verify(account, companyName, fetchJson) {
    const payload = asRecord(
      await fetchJson({
        url: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account.id)}?details=true`,
        method: "GET",
      })
    );
    const reportedName = asString(payload.name) ?? asString(asRecord(payload.account).name);
    if (!reportedName) return { ok: false, reason: "no account metadata" };

    const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ok = squash(reportedName).includes(squash(companyName)) ||
      squash(companyName).includes(squash(reportedName));

    return { ok, reportedName, reason: ok ? undefined : `board belongs to "${reportedName}"` };
  },

  endpoint(account) {
    return {
      url: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account.id)}?details=true`,
      method: "GET",
    };
  },

  normalize(payload): ProviderPage {
    const jobs = asArray(asRecord(payload).jobs).map((entry) => {
      const job = asRecord(entry);
      const parts = [job.city, job.region, job.country]
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value));
      const location = parts.join(", ");

      return {
        providerJobId: asString(job.shortcode) ?? asString(job.id),
        title: asString(job.title) ?? "(untitled)",
        locations: location ? [location] : splitLocations(asString(job.location)),
        remote: job.telecommuting === true || looksRemote(location),
        department: asString(job.department),
        employmentType: asString(job.employment_type),
        description: toPlainText(asString(job.description)),
        publishedAt: asString(job.published_on) ?? asString(job.created_at),
        jobUrl: asString(job.url) ?? asString(job.application_url),
        applyUrl: asString(job.application_url),
      };
    });

    return { jobs, hasMore: false, total: jobs.length };
  },
};
