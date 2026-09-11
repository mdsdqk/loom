import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  LoomConfigSchema,
  stallThresholdFor,
} from "../../src/opportunity/config.js";
import { loadConfig } from "../../src/opportunity/config-file.js";
import {
  appendStatus,
  listOpportunities,
  readOpportunity,
  writeMeta,
} from "../../src/opportunity/store.js";
import {
  currentRound,
  currentStatus,
  idleDays,
  isStalled,
  rounds,
} from "../../src/opportunity/derive.js";
import { nextRound, roundsAt, validateMeta } from "../../src/opportunity/schema.js";

let root: string;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function makeOpportunity(slug: string, meta: string, artifacts: string[] = []) {
  const dir = join(root, slug);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await writeFile(join(dir, "meta.yml"), meta, "utf8");
  for (const name of artifacts) {
    await writeFile(join(dir, "artifacts", name), "x", "utf8");
  }
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-opps-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reading", () => {
  it("reads company, role and history", async () => {
    await makeOpportunity(
      "northwind-senior-frontend",
      [
        "company: Northwind Systems",
        "role: Senior Frontend Engineer",
        "status: applied",
        "history:",
        "  - at: 2026-08-15T09:12:00Z",
        "    status: scouted",
        "  - at: 2026-08-18T07:05:00Z",
        "    status: applied",
        "    note: submitted via Greenhouse",
      ].join("\n"),
      ["jd.md", "resume.yml", "resume-northwind.pdf"]
    );

    const opp = await readOpportunity("northwind-senior-frontend", root);
    expect(opp.meta.company).toBe("Northwind Systems");
    expect(currentStatus(opp.meta)).toBe("applied");
    expect(opp.meta.history).toHaveLength(2);
    expect(opp.meta.history[1].note).toBe("submitted via Greenhouse");
    expect(opp.artifacts).toEqual({ jd: true, resume: true, pdf: true });
    expect(opp.issues).toEqual([]);
  });

  it("reads a bare posting date, which YAML parses as a Date", async () => {
    await makeOpportunity(
      "dated",
      ["company: Acme", "role: Engineer", "posted_date: 2026-08-14", "job_id: R-2291", "history: []"].join("\n")
    );

    const opp = await readOpportunity("dated", root);
    expect(opp.meta.posted_date).toBe("2026-08-14");
    expect(opp.meta.job_id).toBe("R-2291");
  });

  it("round-trips a posting date through a write without changing it", async () => {
    await makeOpportunity(
      "dated",
      ["company: Acme", "role: Engineer", "posted_date: 2026-08-14"].join("\n")
    );
    const opp = await readOpportunity("dated", root);
    await writeMeta("dated", opp.meta, root);
    const again = await readOpportunity("dated", root);
    expect(again.meta.posted_date).toBe("2026-08-14");
  });

  it("treats a meta.yml with no history as a single scouted event", async () => {
    await makeOpportunity("legacy-role", "company: Legacy Corp\nrole: Engineer\n");

    const opp = await readOpportunity("legacy-role", root);
    expect(opp.meta.history).toHaveLength(1);
    expect(opp.meta.history[0].status).toBe("scouted");
    expect(currentStatus(opp.meta)).toBe("scouted");
  });

  it("does not write the synthesized history back to disk", async () => {
    await makeOpportunity("legacy-role", "company: Legacy Corp\nrole: Engineer\n");
    await readOpportunity("legacy-role", root);

    const onDisk = await readFile(join(root, "legacy-role", "meta.yml"), "utf8");
    expect(onDisk).not.toContain("history");
  });

  it("preserves unknown top-level keys through a write", async () => {
    await makeOpportunity(
      "keeps-extras",
      "company: Acme\nrole: Engineer\nsalary_band: L5\nhistory: []\n"
    );

    const opp = await readOpportunity("keeps-extras", root);
    await writeMeta("keeps-extras", opp.meta, root);

    const reread = load(await readFile(join(root, "keeps-extras", "meta.yml"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(reread.salary_band).toBe("L5");
  });

  it("reports a status cache that disagrees with history rather than throwing", async () => {
    await makeOpportunity(
      "drifted",
      [
        "company: Acme",
        "role: Engineer",
        "status: offer",
        "history:",
        "  - at: 2026-08-15T09:12:00Z",
        "    status: applied",
      ].join("\n")
    );

    const opp = await readOpportunity("drifted", root);
    expect(opp.issues.join()).toContain("disagrees");
    expect(currentStatus(opp.meta)).toBe("applied");
  });

  it("skips directories with no meta.yml and survives one unreadable file", async () => {
    await makeOpportunity("good", "company: Acme\nrole: Engineer\nhistory: []\n");
    await makeOpportunity("broken", "company: 42\nrole: []\n");
    await mkdir(join(root, "not-an-opportunity"), { recursive: true });

    const { opportunities, failures } = await listOpportunities(root);
    expect(opportunities.map((o) => o.slug)).toEqual(["good"]);
    expect(failures.map((f) => f.slug)).toEqual(["broken"]);
  });

  it("returns nothing for a root that does not exist", async () => {
    const { opportunities } = await listOpportunities(join(root, "missing"));
    expect(opportunities).toEqual([]);
  });
});

describe("appending status", () => {
  it("appends without rewriting earlier entries and refreshes the cache", async () => {
    await makeOpportunity(
      "acme-engineer",
      "company: Acme\nrole: Engineer\nstatus: scouted\nhistory:\n  - at: 2026-08-01T09:00:00Z\n    status: scouted\n"
    );

    await appendStatus("acme-engineer", { status: "drafting" }, root);
    const opp = await appendStatus("acme-engineer", { status: "applied", note: "via Lever" }, root);

    expect(opp.meta.history.map((e) => e.status)).toEqual(["scouted", "drafting", "applied"]);
    expect(opp.meta.history[0].at).toBe("2026-08-01T09:00:00.000Z");
    expect(opp.meta.status).toBe("applied");

    const onDisk = load(
      await readFile(join(root, "acme-engineer", "meta.yml"), "utf8")
    ) as Record<string, unknown>;
    expect(onDisk.status).toBe("applied");
  });

  it("rejects an outcome on a status that is not closed", async () => {
    await makeOpportunity("acme-engineer", "company: Acme\nrole: Engineer\nhistory: []\n");
    await expect(
      appendStatus("acme-engineer", { status: "applied", outcome: "rejected" }, root)
    ).rejects.toThrow(/only meaningful on a closed event/);
  });

  it("accepts a backdated event", async () => {
    await makeOpportunity("acme-engineer", "company: Acme\nrole: Engineer\nhistory: []\n");
    const opp = await appendStatus(
      "acme-engineer",
      { status: "applied", at: "2026-07-04T10:00:00Z" },
      root
    );
    expect(opp.meta.history.at(-1)?.at).toBe("2026-07-04T10:00:00.000Z");
  });
});

describe("interview rounds", () => {
  it("numbers each pass through a loopable status", async () => {
    await makeOpportunity("acme-engineer", "company: Acme\nrole: Engineer\nhistory: []\n");

    await appendStatus("acme-engineer", { status: "applied" }, root);
    await appendStatus("acme-engineer", { status: "interviewing", label: "phone screen" }, root);
    await appendStatus("acme-engineer", { status: "interviewing", label: "system design" }, root);
    const opp = await appendStatus(
      "acme-engineer",
      { status: "interviewing", label: "hiring manager" },
      root
    );

    const loop = rounds(opp.meta, "interviewing");
    expect(loop.map((e) => e.round)).toEqual([1, 2, 3]);
    expect(loop.map((e) => e.label)).toEqual(["phone screen", "system design", "hiring manager"]);
    expect(currentRound(opp.meta)).toBe(3);
  });

  it("tracks screening and interviewing as independent loops", async () => {
    await makeOpportunity("acme-engineer", "company: Acme\nrole: Engineer\nhistory: []\n");

    await appendStatus("acme-engineer", { status: "screening" }, root);
    await appendStatus("acme-engineer", { status: "screening", label: "take-home" }, root);
    const opp = await appendStatus("acme-engineer", { status: "interviewing" }, root);

    expect(rounds(opp.meta, "screening").map((e) => e.round)).toEqual([1, 2]);
    expect(rounds(opp.meta, "interviewing").map((e) => e.round)).toEqual([1]);
    expect(currentRound(opp.meta)).toBe(1);
  });

  it("does not number a status that is a single point", async () => {
    await makeOpportunity("acme-engineer", "company: Acme\nrole: Engineer\nhistory: []\n");
    const opp = await appendStatus("acme-engineer", { status: "applied" }, root);

    expect(opp.meta.history.at(-1)?.round).toBeUndefined();
    expect(currentRound(opp.meta)).toBeUndefined();
    expect(nextRound(opp.meta.history, "applied")).toBeUndefined();
  });

  it("continues numbering after leaving and re-entering the loop", async () => {
    await makeOpportunity("acme-engineer", "company: Acme\nrole: Engineer\nhistory: []\n");

    await appendStatus("acme-engineer", { status: "interviewing" }, root);
    await appendStatus("acme-engineer", { status: "offer" }, root);
    const opp = await appendStatus(
      "acme-engineer",
      { status: "interviewing", label: "final panel" },
      root
    );

    expect(rounds(opp.meta, "interviewing").map((e) => e.round)).toEqual([1, 2]);
  });

  it("counts rounds already present in a hand-written file", () => {
    const history = [
      { at: "2026-08-01T09:00:00Z", status: "interviewing" as const, round: 1 },
      { at: "2026-08-08T09:00:00Z", status: "interviewing" as const, round: 2 },
    ];
    expect(roundsAt(history, "interviewing")).toBe(2);
    expect(nextRound(history, "interviewing")).toBe(3);
  });
});

describe("stall threshold", () => {
  const metaAt = (status: string, days: number) =>
    validateMeta({
      company: "Acme",
      role: "Engineer",
      history: [{ at: daysAgo(days), status }],
    }).meta!;

  it("uses the configured default", () => {
    expect(isStalled(metaAt("applied", 20), DEFAULT_CONFIG)).toBe(true);
    expect(isStalled(metaAt("applied", 3), DEFAULT_CONFIG)).toBe(false);
  });

  it("honours a different global threshold", () => {
    const config = LoomConfigSchema.parse({ stall_threshold_days: 30 });
    expect(isStalled(metaAt("applied", 20), config)).toBe(false);
    expect(isStalled(metaAt("applied", 31), config)).toBe(true);
  });

  it("honours a per-status override", () => {
    const config = LoomConfigSchema.parse({
      stall_threshold_days: 14,
      stall_threshold_days_by_status: { interviewing: 7 },
    });
    expect(stallThresholdFor("interviewing", config)).toBe(7);
    expect(stallThresholdFor("applied", config)).toBe(14);
    expect(isStalled(metaAt("interviewing", 9), config)).toBe(true);
    expect(isStalled(metaAt("applied", 9), config)).toBe(false);
  });

  it("never stalls a terminal or favourable status", () => {
    expect(stallThresholdFor("closed", DEFAULT_CONFIG)).toBeNull();
    expect(stallThresholdFor("offer", DEFAULT_CONFIG)).toBeNull();
    expect(isStalled(metaAt("closed", 400), DEFAULT_CONFIG)).toBe(false);
  });

  it("ignores an unknown status key in the override map", () => {
    const config = LoomConfigSchema.parse({
      stall_threshold_days_by_status: { interviwing: 3 },
    });
    expect(stallThresholdFor("interviewing", config)).toBe(14);
  });

  it("measures idle days from the last event", () => {
    expect(idleDays(metaAt("applied", 5))).toBe(5);
  });
});

describe("config file", () => {
  it("falls back to defaults when absent", async () => {
    const config = await loadConfig(join(root, "loom.config.yml"));
    expect(config.stall_threshold_days).toBe(14);
  });

  it("reads a real file", async () => {
    const path = join(root, "loom.config.yml");
    await writeFile(
      path,
      "stall_threshold_days: 21\nstall_threshold_days_by_status:\n  interviewing: 5\n",
      "utf8"
    );
    const config = await loadConfig(path);
    expect(config.stall_threshold_days).toBe(21);
    expect(stallThresholdFor("interviewing", config)).toBe(5);
  });

  it("refuses a malformed threshold rather than silently defaulting", async () => {
    const path = join(root, "loom.config.yml");
    await writeFile(path, "stall_threshold_days: -3\n", "utf8");
    await expect(loadConfig(path)).rejects.toThrow(/Invalid config/);
  });
});
