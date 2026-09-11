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
 * Greenhouse job boards.
 *
 * Greenhouse exposes board metadata separately from postings, and that metadata
 * names the employer — which is what makes a guessed board token verifiable
 * rather than a coin flip.
 */
/** Greenhouse's own placeholder office entries, which name no real place. */
const PLACEHOLDER_OFFICE = /^(i18n|remote office|no office|n\/a)$/i;

export const greenhouse: ProviderAdapter = {
  id: "greenhouse",

  fingerprints: [
    /(?:boards|job-boards)\.greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i,
    /(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/i,
    /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i,
    /greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9_-]+)/i,
  ],

  accountFrom(match) {
    const id = match[1]?.toLowerCase();
    // These path segments belong to Greenhouse's own site, not to an employer.
    if (!id || ["embed", "v1", "boards", "job-boards"].includes(id)) return null;
    return { id };
  },

  guessAccounts(companyName) {
    const tokens = companyName
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
    if (tokens.length === 0) return [];
    return [...new Set([tokens.join(""), tokens[0]])].map((id) => ({ id }));
  },

  async verify(account, companyName, fetchJson) {
    const board = asRecord(
      await fetchJson({
        url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(account.id)}`,
        method: "GET",
      })
    );
    const reportedName = asString(board.name);
    if (!reportedName) return { ok: false, reason: "no board metadata" };

    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, "");

    const reported = normalize(reportedName);
    const expected = normalize(companyName);
    const ok = reported.includes(expected) || expected.includes(reported);

    return {
      ok,
      reportedName,
      reason: ok ? undefined : `board belongs to "${reportedName}"`,
    };
  },

  endpoint(account) {
    return {
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(account.id)}/jobs?content=true`,
      method: "GET",
    };
  },

  normalize(payload): ProviderPage {
    const jobs = asArray(asRecord(payload).jobs).map((entry) => {
      const job = asRecord(entry);
      const location = asString(asRecord(job.location).name);

      // `location` is the canonical field. `offices` is only a fallback: boards
      // routinely repurpose it for business units ("Payments", "RazorpayX") or
      // fill it with Greenhouse's own "I18N" placeholder, and treating those as
      // places puts department names in the location column.
      const offices = asArray(job.offices)
        .map((office) => asString(asRecord(office).name))
        .filter((name): name is string => Boolean(name) && !PLACEHOLDER_OFFICE.test(name!));
      const locations = location ? splitLocations(location) : offices;
      const departments = asArray(job.departments)
        .map((d) => asString(asRecord(d).name))
        .filter(Boolean);

      return {
        providerJobId: asString(job.id),
        title: asString(job.title) ?? "(untitled)",
        locations,
        // Offices are unreliable as places but still hint at remote work.
        remote: looksRemote(location, ...locations, ...offices, asString(job.title)),
        department: departments[0],
        description: toPlainText(asString(job.content)),
        publishedAt: asString(job.first_published) ?? asString(job.updated_at),
        updatedAt: asString(job.updated_at),
        jobUrl: asString(job.absolute_url),
        applyUrl: asString(job.absolute_url),
      };
    });

    // Greenhouse returns the whole board in one response.
    return { jobs, hasMore: false, total: jobs.length };
  },
};
