import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOpportunity, updateEvent } from "../../src/opportunity/store.js";
import {
  currentIsAhead,
  currentRound,
  currentStatus,
  idleDays,
  lastRecorded,
  nextScheduled,
  recordedEvents,
  rounds,
  scheduledEvents,
} from "../../src/opportunity/derive.js";
import { DEFAULT_CONFIG, isStalled } from "../../src/opportunity/index.js";

/**
 * The stub fixture stands in for a real mid-loop application, so these assert
 * the properties that matter when a round is booked but has not happened.
 */

const fixture = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "scheduled-round.meta.yml"
);

const SLUG = "northwind-systems-agentic-system-architect";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-fixture-"));
  await mkdir(join(root, SLUG, "artifacts"), { recursive: true });
  await copyFile(fixture, join(root, SLUG, "meta.yml"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("an application with a round booked", () => {
  it("reads without complaint", async () => {
    const opp = await readOpportunity(SLUG, root);
    expect(opp.issues).toEqual([]);
    expect(opp.meta.history).toHaveLength(6);
  });

  it("reports the furthest stage reached, booked rounds included", async () => {
    const opp = await readOpportunity(SLUG, root);
    expect(currentStatus(opp.meta)).toBe("interviewing");
    /* The furthest interviewing entry is the booked round 3. */
    expect(currentRound(opp.meta)).toBe(3);
    expect(lastRecorded(opp.meta)?.round).toBe(1);
    expect(currentIsAhead(opp.meta)).toBe(true);
    expect(recordedEvents(opp.meta)).toHaveLength(4);
    expect(scheduledEvents(opp.meta)).toHaveLength(2);
  });

  it("surfaces the next commitment with its freeform eta", async () => {
    const opp = await readOpportunity(SLUG, root);
    const next = nextScheduled(opp.meta);
    expect(next?.label).toBe("functional assessment - coding round");
    expect(next?.eta).toBe("within 72 hrs");
    expect(next?.round).toBe(2);
  });

  it("counts booked rounds in the round sequence", async () => {
    const opp = await readOpportunity(SLUG, root);
    expect(rounds(opp.meta, "interviewing").map((e) => e.round)).toEqual([1, 2, 3]);
  });

  it("counts idle time from the newest entry, a booking included", async () => {
    const opp = await readOpportunity(SLUG, root);
    /* The newest entry is the booked panel on 10 Sep, not the round done on 4 Sep. */
    expect(idleDays(opp.meta, new Date("2026-09-20T00:00:00Z"))).toBe(9);
    expect(isStalled(opp.meta, DEFAULT_CONFIG, new Date("2026-09-20T00:00:00Z"))).toBe(false);
    /* Long enough after the booking and nothing has moved, so it has gone quiet. */
    expect(isStalled(opp.meta, DEFAULT_CONFIG, new Date("2026-10-01T00:00:00Z"))).toBe(true);
  });

  it("advances once the booked round is marked done", async () => {
    const opp = await updateEvent(
      SLUG,
      4,
      { state: "recorded", at: "2026-09-11T18:00:00Z", note: "submitted the take-home" },
      root
    );

    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(lastRecorded(opp.meta)?.round).toBe(2);
    expect(opp.meta.history[4].eta).toBeUndefined();
    expect(opp.meta.history[4].revised_at).toBeDefined();
    expect(scheduledEvents(opp.meta)).toHaveLength(1);
  });
});
