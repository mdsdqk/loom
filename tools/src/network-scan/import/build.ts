import { basename } from "node:path";
import type { Company, NetworkImport } from "../schema.js";
import { NetworkImportSchema } from "../schema.js";
import { findMergeReviews, groupByCompany, parseConnections } from "./connections.js";
import { loadExport } from "./export-reader.js";
import { buildCareer, buildSignals, buildSkills, parsePreferences } from "./signals.js";

/**
 * Stage 1 of the network scan: read a LinkedIn data export directory and
 * produce the company list every later stage works from.
 *
 * Entirely offline and deterministic — no HTTP, no inference. Running it twice
 * on the same export produces byte-identical output apart from `imported_at`.
 */
export async function buildNetworkImport(
  exportDir: string,
  now: () => string = () => new Date().toISOString()
): Promise<NetworkImport> {
  const { rows, missing } = await loadExport(exportDir);

  if (!rows.connections) {
    throw new Error(
      `No readable Connections.csv in ${exportDir} — expected a CSV with a "First Name" column`
    );
  }

  const parsed = parseConnections(rows.connections);
  const groups = groupByCompany(parsed.connections);
  const signals = buildSignals(groups, {
    savedJobs: rows.savedJobs,
    companyFollows: rows.companyFollows,
    positions: rows.positions,
    education: rows.education,
  });

  const companies: Company[] = groups.map((group) => ({
    id: group.id,
    canonical_name: group.canonicalName,
    aliases: group.aliases,
    signals: signals.byCompanyKey.get(group.key)!,
    connections: group.connections,
  }));

  return NetworkImportSchema.parse({
    source: basename(exportDir),
    imported_at: now(),
    counts: {
      connection_rows: parsed.totalRows,
      connections_with_company: parsed.connections.length,
      companies: companies.length,
      dropped_non_employer: parsed.nonEmployer,
      dropped_blank_company: parsed.blankCompany,
      saved_jobs: signals.savedJobTotal,
      followed_orgs: signals.followedTotal,
    },
    preferences: parsePreferences(rows.jobPreferences),
    skills: buildSkills({ skills: rows.skills, positions: rows.positions }),
    career: buildCareer(rows.positions),
    companies,
    review: findMergeReviews(groups),
    missing_files: missing,
  } satisfies NetworkImport);
}

/** One-line-per-metric summary for the CLI, so a run is legible without opening the YAML. */
export function summarize(result: NetworkImport): string {
  const withSaved = result.companies.filter((c) => c.signals.saved_job_count > 0);
  const followed = result.companies.filter((c) => c.signals.followed);
  const exEmployer = result.companies.filter((c) => c.signals.ex_employer);
  const alumni = result.companies.filter((c) => c.signals.alumni);

  const lines = [
    `Connections:            ${result.counts.connection_rows}`,
    `  with a company:       ${result.counts.connections_with_company}`,
    `  blank company:        ${result.counts.dropped_blank_company}`,
    `  non-employer:         ${result.counts.dropped_non_employer}`,
    `Companies:              ${result.counts.companies}`,
    `  you saved a job at:   ${withSaved.length}`,
    `  you follow:           ${followed.length}`,
    `  you worked at:        ${exEmployer.length}`,
    `  you studied at:       ${alumni.length}`,
    `Names to review:        ${result.review.length}`,
  ];

  if (result.missing_files.length > 0) {
    lines.push(`Missing export files:   ${result.missing_files.join(", ")}`);
  }

  return lines.join("\n");
}
