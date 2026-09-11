import { asArray, asRecord, asString, looksRemote, splitLocations } from "./types.js";
import type { ProviderAdapter, ProviderPage } from "./types.js";

const PAGE_SIZE = 100;

/**
 * SmartRecruiters public postings.
 *
 * Every posting names its own company, so a guessed board is verifiable from
 * the postings response alone — no separate metadata call needed.
 */
export const smartrecruiters: ProviderAdapter = {
  id: "smartrecruiters",

  fingerprints: [
    /careers\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/,
    /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]+)/,
    /jobs\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/,
  ],

  accountFrom(match) {
    const id = match[1];
    if (!id || ["v1", "companies"].includes(id)) return null;
    return { id };
  },

  async verify(account, companyName, fetchJson) {
    const payload = asRecord(
      await fetchJson({
        url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(account.id)}/postings?limit=1`,
        method: "GET",
      })
    );
    const first = asRecord(asArray(payload.content)[0]);
    const reportedName = asString(asRecord(first.company).name);
    if (!reportedName) return { ok: false, reason: "no postings to identify the board" };

    const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const ok = squash(reportedName).includes(squash(companyName)) ||
      squash(companyName).includes(squash(reportedName));

    return { ok, reportedName, reason: ok ? undefined : `board belongs to "${reportedName}"` };
  },

  endpoint(account, page) {
    const offset = page * PAGE_SIZE;
    return {
      url: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(account.id)}/postings?limit=${PAGE_SIZE}&offset=${offset}`,
      method: "GET",
    };
  },

  normalize(payload, account): ProviderPage {
    const root = asRecord(payload);
    const content = asArray(root.content);

    const jobs = content.map((entry) => {
      const job = asRecord(entry);
      const location = asRecord(job.location);
      const parts = [location.city, location.region, location.country]
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value));
      const remote = location.remote === true;
      const id = asString(job.id);

      return {
        providerJobId: id,
        title: asString(job.name) ?? "(untitled)",
        locations: parts.length > 0 ? [parts.join(", ")] : splitLocations(asString(location.city)),
        remote: remote || looksRemote(...parts),
        department: asString(asRecord(job.department).label),
        employmentType: asString(asRecord(job.typeOfEmployment).label),
        publishedAt: asString(job.releasedDate),
        jobUrl: id
          ? `https://jobs.smartrecruiters.com/${encodeURIComponent(account.id)}/${encodeURIComponent(id)}`
          : undefined,
      };
    });

    const total = typeof root.totalFound === "number" ? root.totalFound : undefined;
    const offset = typeof root.offset === "number" ? root.offset : 0;
    const hasMore = content.length === PAGE_SIZE && (total === undefined || offset + content.length < total);

    return { jobs, hasMore, total };
  },
};
