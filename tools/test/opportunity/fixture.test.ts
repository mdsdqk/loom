import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOpportunity, updateEvent } from "../../src/opportunity/store.js";
import {
  currentRound,
  currentStatus,
  idleDays,
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

  it("reports the last thing that happened, not the next thing booked", async () => {
    const opp = await readOpportunity(SLUG, root);
    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(currentRound(opp.meta)).toBe(1);
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

  it("keeps the idle clock running while a round is merely booked", async () => {
    const opp = await readOpportunity(SLUG, root);
    const days = idleDays(opp.meta, new Date("2026-09-20T00:00:00Z"));
    expect(days).toBe(15);
    expect(isStalled(opp.meta, DEFAULT_CONFIG, new Date("2026-09-20T00:00:00Z"))).toBe(true);
  });

  it("advances once the booked round is marked done", async () => {
    const opp = await updateEvent(
      SLUG,
      4,
      { state: "recorded", at: "2026-09-11T18:00:00Z", note: "submitted the take-home" },
      root
    );

    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(currentRound(opp.meta)).toBe(2);
    expect(opp.meta.history[4].eta).toBeUndefined();
    expect(opp.meta.history[4].revised_at).toBeDefined();
    expect(scheduledEvents(opp.meta)).toHaveLength(1);
    expect(idleDays(opp.meta, new Date("2026-09-13T18:00:00Z"))).toBe(2);
  });
});
