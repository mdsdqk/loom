import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySeniority,
  findMergeReviews,
  groupByCompany,
  isNonEmployer,
  normalizationKey,
  parseConnections,
} from "../src/network-scan/import/connections.js";
import { loadExport, readExportCsv } from "../src/network-scan/import/export-reader.js";
import { buildSignals, parsePreferences } from "../src/network-scan/import/signals.js";
import { buildNetworkImport } from "../src/network-scan/import/build.js";

const exportDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "linkedin-export"
);

describe("normalizationKey", () => {
  it.each([
    ["Northwind Traders Inc.", "northwind traders"],
    ["Northwind Traders, Inc", "northwind traders"],
    ["northwind traders", "northwind traders"],
    ["Contoso Systems Private Limited", "contoso systems"],
    ["Contoso Systems Pvt Ltd", "contoso systems"],
    ["Tailspin Analytics (TSA)", "tailspin analytics"],
    ["Fabrikam - An Initech Company", "fabrikam"],
    ["Fabrikam - By Initech", "fabrikam"],
    ["Fabrikam - by Initech ", "fabrikam"],
    ["  Spaced   Out  Name  ", "spaced out name"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizationKey(raw)).toBe(expected);
  });

  it("keeps distinct employers distinct rather than merging on similarity", () => {
    expect(normalizationKey("Northwind Traders")).not.toBe(
      normalizationKey("Northwind Robotics")
    );
    expect(normalizationKey("Walmart")).not.toBe(normalizationKey("Walmart Global Tech India"));
  });

  it("never strips a legal-form word that is the whole name", () => {
    expect(normalizationKey("Limited")).toBe("limited");
    expect(normalizationKey("Company")).toBe("company");
  });
});

describe("isNonEmployer", () => {
  it.each(["Freelance", "Self-employed", "Stealth Startup", "N/A", "Unemployed"])(
    "treats %j as a working arrangement, not an employer",
    (raw) => {
      expect(isNonEmployer(raw)).toBe(true);
    }
  );

  it.each(["Northwind Traders Inc.", "Woodgrove University", "Stealth Robotics Labs"])(
    "treats %j as a real employer",
    (raw) => {
      expect(isNonEmployer(raw)).toBe(false);
    }
  );
});

describe("classifySeniority", () => {
  it.each([
    ["VP of Engineering", "leadership"],
    ["Associate Director", "leadership"],
    ["Co-Founder", "leadership"],
    ["Engineering Manager", "lead"],
    ["Senior Manager, Platform", "lead"],
    ["Principal Architect", "lead"],
    ["Staff Engineer", "lead"],
    ["Senior Software Engineer", "senior"],
    ["SDE 2", "senior"],
    ["Software Engineer Intern", "junior"],
    ["Graduate Trainee", "junior"],
    ["Software Engineer", "mid"],
    ["Data Analyst", "mid"],
    [undefined, "unknown"],
    ["", "unknown"],
  ])("classifies %j as %s", (position, expected) => {
    expect(classifySeniority(position)).toBe(expected);
  });
});

describe("parseConnections and groupByCompany", () => {
  it("drops blank and non-employer rows, and merges legal-form variants", async () => {
    const rows = await readExportCsv(join(exportDir, "Connections.csv"), "First Name");
    const parsed = parseConnections(rows!);

    expect(parsed.totalRows).toBe(14);
    expect(parsed.blankCompany).toBe(1);
    expect(parsed.nonEmployer).toBe(2);
    expect(parsed.connections).toHaveLength(11);

    const groups = groupByCompany(parsed.connections);
    const byId = new Map(groups.map((group) => [group.id, group]));

    expect(byId.get("northwind-traders")!.connections).toHaveLength(3);
    expect(byId.get("contoso-systems")!.connections).toHaveLength(2);
    expect(byId.get("fabrikam")!.connections).toHaveLength(2);
    expect(byId.get("tailspin-analytics")!.connections).toHaveLength(2);
    expect(byId.has("northwind-robotics")).toBe(true);
  });

  it("picks a canonical name that actually appears in the export", async () => {
    const rows = await readExportCsv(join(exportDir, "Connections.csv"), "First Name");
    const groups = groupByCompany(parseConnections(rows!).connections);
    const fabrikam = groups.find((group) => group.id === "fabrikam")!;

    expect(fabrikam.aliases).toEqual(["Fabrikam - An Initech Company", "Fabrikam - By Initech"]);
    expect(fabrikam.aliases).toContain(fabrikam.canonicalName);
  });

  it("orders companies deterministically across runs", async () => {
    const rows = await readExportCsv(join(exportDir, "Connections.csv"), "First Name");
    const first = groupByCompany(parseConnections(rows!).connections).map((g) => g.id);
    const second = groupByCompany(parseConnections(rows!).connections).map((g) => g.id);

    expect(first).toEqual(second);
  });
});

describe("findMergeReviews", () => {
  it("reports prefix-related names for review instead of merging them", async () => {
    const rows = await readExportCsv(join(exportDir, "Connections.csv"), "First Name");
    const groups = groupByCompany(parseConnections(rows!).connections);
    const reviews = findMergeReviews(groups);

    expect(reviews).toHaveLength(0);

    const withPrefixPair = groupByCompany([
      ...parseConnections(rows!).connections,
      {
        name: "Test Person",
        company_raw: "Northwind Traders Robotics",
        seniority: "mid" as const,
      },
    ]);
    const pairs = findMergeReviews(withPrefixPair).map((r) => [r.a, r.b]);

    expect(pairs).toContainEqual(["Northwind Traders Inc.", "Northwind Traders Robotics"]);
  });
});

describe("readExportCsv", () => {
  it("skips LinkedIn's free-text preamble to find the real header row", async () => {
    const rows = await readExportCsv(join(exportDir, "Connections.csv"), "First Name");

    expect(rows).not.toBeNull();
    expect(rows![0]).toMatchObject({ "First Name": "Ada", Company: "Northwind Traders Inc." });
  });

  it("returns null for a file that is absent or has no matching header", async () => {
    expect(await readExportCsv(join(exportDir, "Nope.csv"), "First Name")).toBeNull();
    expect(await readExportCsv(join(exportDir, "Education.csv"), "First Name")).toBeNull();
  });
});

describe("parsePreferences", () => {
  it("splits LinkedIn's pipe-separated preference cells", async () => {
    const rows = await readExportCsv(
      join(exportDir, "Jobs", "Job Seeker Preferences.csv"),
      "Job Titles"
    );
    const preferences = parsePreferences(rows!);

    expect(preferences.titles).toEqual([
      "Full Stack Engineer",
      "Frontend Developer",
      "Software Engineer",
    ]);
    expect(preferences.locations).toEqual(["Bengaluru", "Berlin"]);
    expect(preferences.job_types).toEqual(["Full-time", "Contract"]);
    expect(preferences.open_to_recruiters).toBe(true);
    expect(preferences.urgency).toBe("ACTIVELY_SEEKING");
  });

  it("returns empty preferences when the file is missing", () => {
    expect(parsePreferences(undefined)).toEqual({
      titles: [],
      locations: [],
      job_types: [],
      industries: [],
    });
  });
});

describe("buildSignals", () => {
  it("attaches saved-job, follow, ex-employer and alumni signal by normalized name", async () => {
    const { rows } = await loadExport(exportDir);
    const groups = groupByCompany(parseConnections(rows.connections!).connections);
    const signals = buildSignals(groups, {
      savedJobs: rows.savedJobs,
      companyFollows: rows.companyFollows,
      positions: rows.positions,
      education: rows.education,
    });

    // Two saved jobs, written under two different legal-form variants.
    expect(signals.byCompanyKey.get("contoso systems")).toMatchObject({
      saved_job_count: 2,
      followed: true,
      ex_employer: false,
    });
    expect(signals.byCompanyKey.get("fabrikam")).toMatchObject({ ex_employer: true });
    expect(signals.byCompanyKey.get("woodgrove university")).toMatchObject({ alumni: true });
    expect(signals.byCompanyKey.get("northwind traders")!.seniority).toMatchObject({
      senior: 1,
      lead: 1,
      junior: 1,
    });

    // Litware is saved and followed but has no connection — outside the scan's scope.
    expect(signals.savedJobsOutsideNetwork).toBe(1);
  });
});

describe("buildNetworkImport", () => {
  it("produces a schema-valid, deterministic import from an export directory", async () => {
    const frozen = () => "2026-09-08T00:00:00.000Z";
    const first = await buildNetworkImport(exportDir, frozen);
    const second = await buildNetworkImport(exportDir, frozen);

    expect(first).toEqual(second);
    expect(first.counts).toMatchObject({
      connection_rows: 14,
      connections_with_company: 11,
      dropped_blank_company: 1,
      dropped_non_employer: 2,
      saved_jobs: 3,
    });
    expect(first.missing_files).toEqual([]);
    // The candidate's own skills feed the matcher, so the import must carry them.
    expect(first.skills.listed).toContain("TypeScript");
    expect(first.skills.held_titles).toContain("Senior Software Engineer");
    expect(first.companies[0].id).toBe("northwind-traders");
    expect(first.preferences.titles).toContain("Full Stack Engineer");
  });

  it("fails loudly when the export has no readable Connections.csv", async () => {
    await expect(buildNetworkImport(join(exportDir, "Jobs"))).rejects.toThrow(
      /No readable Connections.csv/
    );
  });
});
