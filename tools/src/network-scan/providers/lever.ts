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
 * Lever job boards.
 *
 * Lever has no board-metadata endpoint, so a guessed account can only be
 * verified from the postings themselves — every posting carries the board token
 * in its `hostedUrl`, which at least confirms the board exists and is populated.
 * That is weaker evidence than Greenhouse's, so guessed Lever accounts are only
 * accepted when the company surface pointed at them.
 */
export const lever: ProviderAdapter = {
  id: "lever",

  fingerprints: [
    /jobs\.lever\.co\/([a-z0-9_-]+)/i,
    /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/i,
    /jobs\.eu\.lever\.co\/([a-z0-9_-]+)/i,
  ],

  accountFrom(match) {
    const id = match[1]?.toLowerCase();
    if (!id || ["v0", "postings"].includes(id)) return null;
    return { id };
  },

  endpoint(account) {
    return {
      url: `https://api.lever.co/v0/postings/${encodeURIComponent(account.id)}?mode=json`,
      method: "GET",
    };
  },

  normalize(payload): ProviderPage {
    const jobs = asArray(payload).map((entry) => {
      const job = asRecord(entry);
      const categories = asRecord(job.categories);
      const location = asString(categories.location);
      const workplace = asString(categories.workplaceType);

      return {
        providerJobId: asString(job.id),
        title: asString(job.text) ?? "(untitled)",
        locations: splitLocations(location),
        remote: looksRemote(workplace, location),
        department: asString(categories.team) ?? asString(categories.department),
        employmentType: asString(categories.commitment),
        description: toPlainText(asString(job.descriptionPlain) ?? asString(job.description)),
        publishedAt: typeof job.createdAt === "number"
          ? new Date(job.createdAt).toISOString()
          : undefined,
        jobUrl: asString(job.hostedUrl),
        applyUrl: asString(job.applyUrl) ?? asString(job.hostedUrl),
      };
    });

    return { jobs, hasMore: false, total: jobs.length };
  },
};
