import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EventConflictError,
  appendStatus,
  assertSafeSlug,
  listOpportunities,
  readOpportunity,
  removeEvent,
  updateEvent,
} from "../../src/opportunity/store.js";
import { currentStatus, idleDays } from "../../src/opportunity/derive.js";
import { validateMeta } from "../../src/opportunity/schema.js";
import { createOpportunity } from "../../src/resume/opportunity.js";

/** Regressions for the findings of the external review of this branch. */

let root: string;
const SLUG = "northwind-agentic-architect";

const seed = (body: string) =>
  mkdir(join(root, SLUG), { recursive: true }).then(() =>
    writeFile(
      join(root, SLUG, "meta.yml"),
      ["company: Northwind Systems", "role: Agentic System Architect", body].join("\n"),
      "utf8"
    )
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-review-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reads normalize, not just writes", () => {
  it("derives status from time order in a file that was never saved through the store", async () => {
    await seed(
      [
        "status: applied",
        "history:",
        "  - at: 2026-08-18T00:00:00Z",
        "    status: applied",
        "    state: recorded",
        "  - at: 2026-08-01T00:00:00Z",
        "    status: scouted",
        "    state: recorded",
      ].join("\n")
    );

    const opp = await readOpportunity(SLUG, root);
    expect(currentStatus(opp.meta)).toBe("applied");
    expect(opp.meta.history.map((e) => e.status)).toEqual(["scouted", "applied"]);
    expect(opp.issues.join()).toMatch(/chronological/);
  });

  it("renumbers rounds that were set wrong by hand", async () => {
    await seed(
      [
        "history:",
        "  - at: 2026-08-01T00:00:00Z",
        "    status: interviewing",
        "    state: recorded",
        "    round: 5",
        "  - at: 2026-08-08T00:00:00Z",
        "    status: interviewing",
        "    state: recorded",
        "    round: 9",
      ].join("\n")
    );

    const opp = await readOpportunity(SLUG, root);
    expect(opp.meta.history.map((e) => e.round)).toEqual([1, 2]);
  });
});

describe("the status cache cannot outlive its entry", () => {
  it("reports no status when only scheduled entries remain", async () => {
    await seed(
      [
        "status: applied",
        "history:",
        "  - at: 2026-09-01T00:00:00Z",
        "    status: interviewing",
        "    state: scheduled",
        "    eta: soon",
      ].join("\n")
    );

    const opp = await readOpportunity(SLUG, root);
    expect(currentStatus(opp.meta)).toBeUndefined();
    expect(opp.meta.status).toBeUndefined();
  });

  it("flags a cache with nothing recorded behind it", () => {
    const result = validateMeta({
      company: "A",
      role: "R",
      status: "applied",
      history: [{ at: "2026-09-01T00:00:00Z", status: "interviewing", state: "scheduled" }],
    });
    expect(result.issues.map((i) => i.message).join()).toMatch(/no recorded entry behind it/);
  });

  it("drops the key from disk when the last recorded entry is removed", async () => {
    await seed("history: []");
    await appendStatus(SLUG, { status: "applied" }, root);
    await appendStatus(SLUG, { status: "interviewing", state: "scheduled", eta: "soon" }, root);

    const opp = await removeEvent(SLUG, 0, root);
    expect(opp.meta.status).toBeUndefined();
    expect(await readFile(join(root, SLUG, "meta.yml"), "utf8")).not.toMatch(/^status:/m);
  });
});

describe("an unparseable date is refused at the door", () => {
  it("rejects a meta.yml whose `at` is not a date", async () => {
    await seed(["history:", "  - at: TBD", "    status: applied", "    state: recorded"].join("\n"));

    await expect(readOpportunity(SLUG, root)).rejects.toThrow(/parse/i);
    const { failures } = await listOpportunities(root);
    expect(failures).toHaveLength(1);
  });

  it("never produces NaN idle time", async () => {
    await seed(
      ["history:", "  - at: 2026-09-01T00:00:00Z", "    status: applied", "    state: recorded"].join(
        "\n"
      )
    );
    const opp = await readOpportunity(SLUG, root);
    expect(Number.isNaN(idleDays(opp.meta))).toBe(false);
  });
});

describe("history entries keep fields this version does not know", () => {
  it("preserves an unknown key on an entry through a write", async () => {
    await seed(
      [
        "history:",
        "  - at: 2026-09-01T00:00:00Z",
        "    status: applied",
        "    state: recorded",
        "    interviewer: Jane",
      ].join("\n")
    );

    const opp = await appendStatus(SLUG, { status: "screening" }, root);
    expect((opp.meta.history[0] as Record<string, unknown>).interviewer).toBe("Jane");
    expect(await readFile(join(root, SLUG, "meta.yml"), "utf8")).toMatch(/interviewer: Jane/);
  });
});

describe("a stale index cannot edit the wrong entry", () => {
  const twoEntries = async () => {
    await seed("history: []");
    await appendStatus(SLUG, { status: "scouted", at: "2026-08-01T00:00:00Z" }, root);
    await appendStatus(SLUG, { status: "applied", at: "2026-08-10T00:00:00Z" }, root);
  };

  it("refuses a patch whose expectation does not match", async () => {
    await twoEntries();
    await expect(
      updateEvent(SLUG, 1, { note: "x" }, root, { at: "1999-01-01T00:00:00.000Z" })
    ).rejects.toBeInstanceOf(EventConflictError);
  });

  it("refuses a delete whose expectation does not match", async () => {
    await twoEntries();
    await expect(
      removeEvent(SLUG, 0, root, { status: "offer" })
    ).rejects.toBeInstanceOf(EventConflictError);
  });

  it("allows the patch when the expectation matches", async () => {
    await twoEntries();
    const opp = await updateEvent(SLUG, 1, { note: "right one" }, root, {
      at: "2026-08-10T00:00:00.000Z",
      status: "applied",
    });
    expect(opp.meta.history[1].note).toBe("right one");
  });
});

describe("concurrent writes do not lose entries", () => {
  it("keeps every append when several are issued at once", async () => {
    await seed("history: []");
    await Promise.all([
      appendStatus(SLUG, { status: "scouted", at: "2026-08-01T00:00:00Z" }, root),
      appendStatus(SLUG, { status: "drafting", at: "2026-08-02T00:00:00Z" }, root),
      appendStatus(SLUG, { status: "applied", at: "2026-08-03T00:00:00Z" }, root),
      appendStatus(SLUG, { status: "screening", at: "2026-08-04T00:00:00Z" }, root),
    ]);

    const opp = await readOpportunity(SLUG, root);
    expect(opp.meta.history.map((e) => e.status)).toEqual([
      "scouted",
      "drafting",
      "applied",
      "screening",
    ]);
  });
});

describe("a slug cannot address anything outside the opportunities root", () => {
  it("refuses traversal, separators and absolute paths", () => {
    for (const bad of ["..", "../escape", "..\\escape", "a/b", "a\\b", "/etc", "C:\\Windows", ""]) {
      expect(() => assertSafeSlug(bad, root)).toThrow();
    }
  });

  it("accepts an ordinary slug", () => {
    expect(assertSafeSlug("acme-engineer", root)).toBe(resolve(root, "acme-engineer"));
  });

  it("refuses to read through a traversing slug", async () => {
    await expect(readOpportunity("../../etc", root)).rejects.toThrow(/slug/i);
  });
});

describe("a failed create leaves nothing behind", () => {
  it("removes the directory when the master resume does not exist", async () => {
    const jd = join(root, "jd.md");
    await writeFile(jd, "# Engineer at Northwind Systems\n", "utf8");

    await expect(
      createOpportunity({
        masterResumePath: join(root, "does-not-exist.yml"),
        jdPath: jd,
        opportunitiesRoot: root,
      })
    ).rejects.toThrow();

    const { opportunities } = await listOpportunities(root);
    expect(opportunities).toHaveLength(0);

    /* The retry must not look like a duplicate. */
    await writeFile(join(root, "master.yml"), "metadata: {}\n", "utf8");
    const created = await createOpportunity({
      masterResumePath: join(root, "master.yml"),
      jdPath: jd,
      opportunitiesRoot: root,
    });
    expect(created.company).toBe("Northwind Systems");
  });
});
