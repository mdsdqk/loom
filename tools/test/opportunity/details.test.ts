import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendStatus, readOpportunity, updateMeta } from "../../src/opportunity/store.js";

/** Editing the opportunity's own fields: source, referral, and the rest. */

let root: string;
const SLUG = "northwind-agentic-architect";

const seed = (body = "history: []") =>
  mkdir(join(root, SLUG), { recursive: true }).then(() =>
    writeFile(
      join(root, SLUG, "meta.yml"),
      ["company: Northwind Systems", "role: Agentic System Architect", body].join("\n"),
      "utf8"
    )
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-details-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("editing details", () => {
  it("changes the source", async () => {
    await seed();
    const opp = await updateMeta(SLUG, { source: "network-scan" }, root);
    expect(opp.meta.source).toBe("network-scan");
    expect(await readFile(join(root, SLUG, "meta.yml"), "utf8")).toMatch(/source: network-scan/);
  });

  it("records who referred, with the optional parts", async () => {
    await seed();
    const opp = await updateMeta(
      SLUG,
      {
        source: "referral",
        referral: {
          name: "Jane Okafor",
          position: "Staff Engineer",
          linkedin_url: "https://example.com/in/jane",
          note: "asked 3 Sep, said she would file it",
        },
      },
      root
    );

    expect(opp.meta.referral?.name).toBe("Jane Okafor");
    expect(opp.meta.referral?.position).toBe("Staff Engineer");
    const reread = await readOpportunity(SLUG, root);
    expect(reread.meta.referral?.note).toBe("asked 3 Sep, said she would file it");
  });

  it("keeps a referrer with only a name", async () => {
    await seed();
    const opp = await updateMeta(SLUG, { source: "referral", referral: { name: "Sam" } }, root);
    expect(opp.meta.referral).toEqual({ name: "Sam" });
  });

  it("drops the referrer when the source stops being a referral", async () => {
    await seed();
    await updateMeta(SLUG, { source: "referral", referral: { name: "Jane Okafor" } }, root);
    const opp = await updateMeta(SLUG, { source: "manual" }, root);

    expect(opp.meta.referral).toBeUndefined();
    expect(await readFile(join(root, SLUG, "meta.yml"), "utf8")).not.toMatch(/referral/);
  });

  it("clears a field when the patch passes null", async () => {
    await seed();
    await updateMeta(SLUG, { url: "https://example.com/job", job_id: "NW-1" }, root);
    const opp = await updateMeta(SLUG, { url: null, job_id: null }, root);
    expect(opp.meta.url).toBeUndefined();
    expect(opp.meta.job_id).toBeUndefined();
  });

  it("refuses to blank the company or the role", async () => {
    await seed();
    await expect(updateMeta(SLUG, { company: "   " }, root)).rejects.toThrow(/company/);
    await expect(updateMeta(SLUG, { role: "" }, root)).rejects.toThrow(/role/);
  });

  it("leaves history and the derived status alone", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied", at: "2026-08-01T00:00:00Z" }, root);
    await appendStatus(SLUG, { status: "screening", at: "2026-08-10T00:00:00Z" }, root);

    const opp = await updateMeta(SLUG, { source: "referral", referral: { name: "Sam" } }, root);
    expect(opp.meta.history.map((e) => e.status)).toEqual(["applied", "screening"]);
    expect(opp.meta.status).toBe("screening");
  });

  it("preserves unknown top-level keys", async () => {
    await seed("salary_band: L6\nhistory: []");
    const opp = await updateMeta(SLUG, { source: "referral", referral: { name: "Sam" } }, root);
    expect((opp.meta as Record<string, unknown>).salary_band).toBe("L6");
  });

  it("refuses a traversing slug", async () => {
    await expect(updateMeta("../escape", { source: "manual" }, root)).rejects.toThrow(/slug/i);
  });
});
