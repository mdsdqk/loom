import { summarizeAttempts } from "./domains.js";
import { buildReferrerIndex } from "./referrals.js";
import type {
  Company,
  DomainsArtifact,
  HiringSourcesArtifact,
  JobsArtifact,
  NetworkImport,
} from "./schema.js";

/**
 * The scan report.
 *
 * Two views, because they answer different questions. The **funnel** says where
 * companies were lost and why — without it, "we found jobs at 300 of 649
 * companies" is a shrug rather than a measurement, and there is no way to tell
 * which improvement is worth making next. The **leverage** view ranks what
 * survived by how much referral access the candidate actually has, which is the
 * thing the whole pipeline exists to surface.
 */

export interface ReportInput {
  network: NetworkImport;
  domains?: DomainsArtifact;
  sources?: HiringSourcesArtifact;
  jobs?: JobsArtifact;
}

function bar(count: number, total: number, width = 24): string {
  if (total === 0) return "";
  const filled = Math.round((count / total) * width);
  return `${"█".repeat(filled)}${"·".repeat(width - filled)}`;
}

function pct(count: number, total: number): string {
  return total === 0 ? "  0%" : `${String(Math.round((count / total) * 100)).padStart(3)}%`;
}

function table(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => (row[i] ?? "").length)));
  return rows.map((row) =>
    row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ")
  );
}

/** Referral leverage, from signals the candidate's own export already carries. */
export function leverageScore(company: Company): number {
  const s = company.signals;
  const seniorityWeight =
    (s.seniority.leadership ?? 0) * 3 +
    (s.seniority.lead ?? 0) * 2 +
    (s.seniority.senior ?? 0) * 1.5 +
    (s.seniority.mid ?? 0) +
    (s.seniority.junior ?? 0) * 0.5;

  return (
    seniorityWeight +
    s.saved_job_count * 5 +
    (s.followed ? 3 : 0) +
    (s.ex_employer ? 8 : 0) +
    (s.alumni ? 4 : 0)
  );
}

export function buildReport(input: ReportInput): string {
  const { network, domains, sources, jobs } = input;
  const lines: string[] = [];
  const companies = network.companies;
  const total = companies.length;

  lines.push("# Network Scan", "");
  lines.push(`Export: \`${network.source}\`  ·  generated ${new Date().toISOString()}`, "");

  // ---- Funnel -------------------------------------------------------------
  lines.push("## Funnel", "");
  const verified = domains?.domains.filter((d) => d.status === "verified").length ?? 0;
  const withCareers = sources?.counts.careers_page_found ?? 0;
  const withProvider = sources?.counts.provider_detected ?? 0;
  const withJobs = jobs ? new Set(jobs.jobs.map((job) => job.company_id)).size : 0;

  lines.push("```text");
  for (const [label, count] of [
    ["companies in network", total],
    ["domain verified", verified],
    ["careers page found", withCareers],
    ["ATS identified", withProvider],
    ["companies with jobs", withJobs],
  ] as [string, number][]) {
    lines.push(`${label.padEnd(22)} ${String(count).padStart(5)}  ${pct(count, total)}  ${bar(count, total)}`);
  }
  lines.push("```", "");

  lines.push(
    `People: **${network.counts.connection_rows}**  ·  ` +
      `companies: **${total}**  ·  ` +
      `jobs found: **${jobs?.counts.jobs ?? 0}**`,
    ""
  );

  // ---- Where companies were lost -----------------------------------------
  if (domains) {
    const unresolved = domains.domains.filter((d) => d.status === "unresolved");
    if (unresolved.length > 0) {
      lines.push("### Why domains did not resolve", "");
      const reasons = new Map<string, number>();
      for (const entry of unresolved) {
        const reason = summarizeAttempts(entry.attempts);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      lines.push(
        ...table([
          ["reason", "count"],
          ...[...reasons.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([reason, n]) => [reason, String(n)]),
        ]).map((row) => `    ${row}`),
        ""
      );
    }
  }

  if (sources) {
    lines.push("### Hiring sources", "");
    const rows: string[][] = [["provider", "companies"]];
    for (const [provider, n] of Object.entries(sources.counts.by_provider).sort(
      (a, b) => b[1] - a[1]
    )) {
      rows.push([provider, String(n)]);
    }
    rows.push(["known, no adapter yet", String(sources.counts.unsupported_provider)]);
    rows.push(["no provider found", String(sources.counts.no_provider)]);
    rows.push(["no careers page", String(sources.counts.no_careers_page)]);
    lines.push(...table(rows).map((row) => `    ${row}`), "");
  }

  // ---- Leverage -----------------------------------------------------------
  lines.push("## Where your network has the most pull", "");
  const jobsByCompany = new Map<string, number>();
  const matchesByCompany = new Map<string, number>();
  for (const job of jobs?.jobs ?? []) {
    jobsByCompany.set(job.company_id, (jobsByCompany.get(job.company_id) ?? 0) + 1);
    if (job.matches_preferences) {
      matchesByCompany.set(job.company_id, (matchesByCompany.get(job.company_id) ?? 0) + 1);
    }
  }

  const ranked = [...companies]
    .filter((company) => (jobsByCompany.get(company.id) ?? 0) > 0)
    .sort((a, b) => leverageScore(b) - leverageScore(a))
    .slice(0, 30);

  if (ranked.length === 0) {
    lines.push("_No jobs retrieved yet._", "");
  } else {
    const rows: string[][] = [["company", "conns", "senior+", "jobs", "match", "signals"]];
    for (const company of ranked) {
      const s = company.signals;
      const seniorPlus =
        (s.seniority.leadership ?? 0) + (s.seniority.lead ?? 0) + (s.seniority.senior ?? 0);
      const flags = [
        s.saved_job_count > 0 ? "saved" : "",
        s.followed ? "follows" : "",
        s.ex_employer ? "ex-employer" : "",
        s.alumni ? "alumni" : "",
      ].filter(Boolean);

      rows.push([
        company.canonical_name.slice(0, 34),
        String(s.connection_count),
        String(seniorPlus),
        String(jobsByCompany.get(company.id) ?? 0),
        String(matchesByCompany.get(company.id) ?? 0),
        flags.join(", "),
      ]);
    }
    lines.push("```text", ...table(rows), "```", "");
  }

  // ---- Jobs matching the candidate's own stated preferences ---------------
  // Each one is paired with who to ask: a posting without a person to approach
  // is not a referral lead, just a job listing.
  const matching = (jobs?.jobs ?? []).filter((job) => job.matches_preferences);
  if (matching.length > 0) {
    lines.push(
      `## Jobs matching your stated preferences (${matching.length})`,
      "",
      "_Your LinkedIn job-seeker preferences, matched literally — not a ranking._",
      "_\"Ask\" is the best-placed connection at that company, with why._",
      ""
    );

    const byLeverage = new Map(companies.map((c) => [c.id, leverageScore(c)]));
    const referrers = buildReferrerIndex(companies);

    // Cap per company as well as overall: one enormous employer would
    // otherwise fill the whole list and hide every other lead.
    const perCompany = new Map<string, number>();
    const shown = [...matching]
      .sort((a, b) => (byLeverage.get(b.company_id) ?? 0) - (byLeverage.get(a.company_id) ?? 0))
      .filter((job) => {
        const seen = perCompany.get(job.company_id) ?? 0;
        if (seen >= 10) return false;
        perCompany.set(job.company_id, seen + 1);
        return true;
      })
      .slice(0, 80);

    let lastCompany = "";
    for (const job of shown) {
      if (job.company_id !== lastCompany) {
        lastCompany = job.company_id;
        const contacts = referrers.get(job.company_id) ?? [];
        lines.push("", `### ${job.company_name}`, "");
        if (contacts.length === 0) {
          lines.push("_No connection recorded at this company._", "");
        } else {
          for (const contact of contacts) {
            const who = contact.linkedinUrl
              ? `[${contact.name}](${contact.linkedinUrl})`
              : contact.name;
            const role = contact.position ? ` — ${contact.position}` : "";
            const why = contact.reasons.length > 0 ? `  
  _${contact.reasons.join("; ")}_` : "";
            lines.push(`- **Ask:** ${who}${role}${why}`);
          }
          lines.push("");
        }
      }

      const where = job.locations.slice(0, 2).join(", ") || (job.remote ? "Remote" : "—");
      const link = job.job_url ? `[${job.title}](${job.job_url})` : job.title;
      lines.push(`  - ${link} · ${where}`);
    }
    lines.push("");
  }

  // ---- Failures -----------------------------------------------------------
  if (jobs && jobs.failures.length > 0) {
    lines.push(`## Fetch failures (${jobs.failures.length})`, "");
    const byError = new Map<string, number>();
    for (const failure of jobs.failures) {
      const key = failure.error.split(":")[0];
      byError.set(key, (byError.get(key) ?? 0) + 1);
    }
    lines.push(
      ...table([
        ["error", "count"],
        ...[...byError.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => [e, String(n)]),
      ]).map((row) => `    ${row}`),
      ""
    );
  }

  if (network.review.length > 0) {
    lines.push(
      `## Company names to check (${network.review.length})`,
      "",
      "_Similar names kept separate rather than merged — only you can tell whether these are one employer._",
      ""
    );
    for (const review of network.review.slice(0, 20)) {
      lines.push(`- ${review.a} · ${review.b}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
