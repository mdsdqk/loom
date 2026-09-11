import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendStatus,
  readOpportunity,
  removeEvent,
  updateEvent,
} from "../../src/opportunity/store.js";
import {
  currentIsAhead,
  currentRound,
  currentStatus,
  idleDays,
  lastRecorded,
  awaitingCandidate,
  nextAction,
  nextScheduled,
  openEvents,
  pendingEvents,
  rounds,
  scheduledEvents,
} from "../../src/opportunity/derive.js";

/**
 * Backdating, editing and scheduling.
 *
 * The scheduling cases are modelled on a real in-flight application: applied,
 * one screening pass, one interview round done, and a coding round booked with
 * only "within 72 hours" to go on.
 */

let root: string;
const SLUG = "northwind-agentic-architect";

async function seed(history = "history: []") {
  await mkdir(join(root, SLUG, "artifacts"), { recursive: true });
  await writeFile(
    join(root, SLUG, "meta.yml"),
    ["company: Northwind Systems", "role: Agentic System Architect", history].join("\n"),
    "utf8"
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-sched-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("backdating", () => {
  it("sorts a backdated entry into the order things happened", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied", at: "2026-07-10T09:00:00Z" }, root);
    await appendStatus(SLUG, { status: "scouted", at: "2026-07-01T09:00:00Z" }, root);
    const opp = await appendStatus(SLUG, { status: "drafting", at: "2026-07-05T09:00:00Z" }, root);

    expect(opp.meta.history.map((e) => e.status)).toEqual(["scouted", "drafting", "applied"]);
    expect(currentStatus(opp.meta)).toBe("applied");
  });

  it("rejects a date it cannot parse rather than silently using now", async () => {
    await seed();
    await expect(
      appendStatus(SLUG, { status: "applied", at: "last tuesday" }, root)
    ).rejects.toThrow(/Unrecognized date/);
  });
});

describe("editing an entry", () => {
  it("edits in place and stamps the correction", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied", note: "typo herre" }, root);

    const opp = await updateEvent(SLUG, 0, { note: "submitted via Lever" }, root);
    expect(opp.meta.history).toHaveLength(1);
    expect(opp.meta.history[0].note).toBe("submitted via Lever");
    expect(opp.meta.history[0].revised_at).toBeDefined();
  });

  it("leaves an untouched entry without a revision stamp", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied" }, root);
    await appendStatus(SLUG, { status: "screening" }, root);

    const opp = await updateEvent(SLUG, 1, { note: "recruiter call" }, root);
    expect(opp.meta.history[0].revised_at).toBeUndefined();
    expect(opp.meta.history[1].revised_at).toBeDefined();
  });

  it("clears a field when the patch passes null", async () => {
    await seed();
    await appendStatus(SLUG, { status: "interviewing", label: "wrong label" }, root);

    const opp = await updateEvent(SLUG, 0, { label: null }, root);
    expect(opp.meta.history[0].label).toBeUndefined();
  });

  it("re-sorts when an edit changes the date", async () => {
    await seed();
    await appendStatus(SLUG, { status: "scouted", at: "2026-07-01T09:00:00Z" }, root);
    await appendStatus(SLUG, { status: "applied", at: "2026-07-10T09:00:00Z" }, root);

    const opp = await updateEvent(SLUG, 1, { at: "2026-06-20T09:00:00Z" }, root);
    expect(opp.meta.history.map((e) => e.status)).toEqual(["applied", "scouted"]);
    /* Order changed; the furthest stage reached did not. */
    expect(currentStatus(opp.meta)).toBe("applied");
  });

  it("refuses an index that is not there", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied" }, root);
    await expect(updateEvent(SLUG, 7, { note: "x" }, root)).rejects.toThrow(
      /No history entry at index 7/
    );
  });

  it("still refuses an outcome on a status that is not closed", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied" }, root);
    await expect(updateEvent(SLUG, 0, { outcome: "rejected" }, root)).rejects.toThrow(
      /only meaningful on a closed event/
    );
  });

  it("removes a cancelled entry", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied" }, root);
    await appendStatus(SLUG, { status: "screening" }, root);

    const opp = await removeEvent(SLUG, 1, root);
    expect(opp.meta.history.map((e) => e.status)).toEqual(["applied"]);
    expect(currentStatus(opp.meta)).toBe("applied");
  });
});

describe("scheduled entries", () => {
  const applied = async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied", at: "2026-07-01T09:00:00Z" }, root);
  };

  it("advances the status: a booked round is the company moving you", async () => {
    await applied();
    const opp = await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "within 72 hours", label: "coding round" },
      root
    );

    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(opp.meta.status).toBe("interviewing");
    /* The stage moved; the round has not happened. */
    expect(currentIsAhead(opp.meta)).toBe(true);
    expect(lastRecorded(opp.meta)?.status).toBe("applied");
    expect(nextScheduled(opp.meta)?.eta).toBe("within 72 hours");
  });

  it("does not move the stage backwards for a booking at an earlier stage", async () => {
    await applied();
    await appendStatus(SLUG, { status: "interviewing", at: "2026-07-10T09:00:00Z" }, root);
    const opp = await appendStatus(
      SLUG,
      { status: "screening", state: "scheduled", eta: "Friday", label: "follow-up call" },
      root
    );

    expect(currentStatus(opp.meta)).toBe("interviewing");
  });

  it("stays closed whatever is still on the calendar", async () => {
    await applied();
    await appendStatus(SLUG, { status: "interviewing", state: "scheduled", eta: "next week" }, root);
    const opp = await appendStatus(SLUG, { status: "closed", outcome: "rejected" }, root);

    expect(currentStatus(opp.meta)).toBe("closed");
  });

  it("counts booking as movement, so the idle clock restarts", async () => {
    await applied();
    const before = (await readOpportunity(SLUG, root)).meta;
    expect(idleDays(before)).toBeGreaterThan(0);

    await appendStatus(SLUG, { status: "interviewing", state: "scheduled", eta: "TBD" }, root);
    const after = (await readOpportunity(SLUG, root)).meta;
    expect(idleDays(after)).toBe(0);
  });

  it("keeps an unvalidated eta exactly as written", async () => {
    for (const eta of [
      "within 72 hrs",
      "Thu 14:00 IST",
      "TBD, likely late next week",
      "2-3 weeks out",
    ]) {
      await applied();
      const opp = await appendStatus(SLUG, { status: "screening", state: "scheduled", eta }, root);
      expect(nextScheduled(opp.meta)?.eta).toBe(eta);
      await rm(join(root, SLUG), { recursive: true, force: true });
    }
  });

  it("sorts scheduled entries after everything recorded", async () => {
    await applied();
    await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "within 72 hours" },
      root
    );
    const opp = await appendStatus(SLUG, { status: "screening", at: "2026-07-20T09:00:00Z" }, root);

    expect(opp.meta.history.map((e) => e.state)).toEqual(["recorded", "recorded", "scheduled"]);
    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(lastRecorded(opp.meta)?.status).toBe("screening");
  });

  it("numbers a scheduled round as the next round", async () => {
    await applied();
    await appendStatus(SLUG, { status: "interviewing", label: "phone screen" }, root);
    const opp = await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "within 72 hours", label: "coding round" },
      root
    );

    expect(rounds(opp.meta, "interviewing").map((e) => e.round)).toEqual([1, 2]);
    /* The stage is set by the booked round 2. */
    expect(currentRound(opp.meta)).toBe(2);
    expect(lastRecorded(opp.meta)?.round).toBe(1);
  });

  it("becomes a fact when marked done, taking the real date", async () => {
    await applied();
    await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "within 72 hours", label: "coding round" },
      root
    );

    const opp = await updateEvent(
      SLUG,
      1,
      { state: "recorded", at: "2026-07-04T15:30:00Z", note: "submitted the take-home" },
      root
    );

    const event = opp.meta.history[1];
    expect(event.state).toBe("recorded");
    expect(event.eta).toBeUndefined();
    expect(event.at).toBe("2026-07-04T15:30:00.000Z");
    expect(event.label).toBe("coding round");
    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(scheduledEvents(opp.meta)).toHaveLength(0);
  });

  it("rejects an eta on an entry that is not scheduled", async () => {
    await applied();
    await expect(
      appendStatus(SLUG, { status: "screening", eta: "soon" }, root)
    ).rejects.toThrow(/eta is only meaningful on a scheduled or pending event/);
  });

  it("reads a scheduled entry written by hand", async () => {
    await seed(
      [
        "history:",
        "  - at: 2026-07-01T09:00:00Z",
        "    status: applied",
        "  - at: 2026-07-02T09:00:00Z",
        "    status: interviewing",
        "    state: scheduled",
        "    eta: within 72 hrs",
        "    label: functional assessment - coding round",
      ].join("\n")
    );

    const opp = await readOpportunity(SLUG, root);
    expect(currentStatus(opp.meta)).toBe("interviewing");
    expect(lastRecorded(opp.meta)?.status).toBe("applied");
    expect(nextScheduled(opp.meta)?.eta).toBe("within 72 hrs");
    expect(opp.issues).toEqual([]);
  });
});

describe("round numbering follows chronology", () => {
  it("renumbers when a backdated round lands before an existing one", async () => {
    await seed();
    await appendStatus(SLUG, { status: "screening", at: "2026-08-26T09:00:00Z" }, root);
    const opp = await appendStatus(SLUG, { status: "screening", at: "2026-08-20T09:00:00Z" }, root);

    const passes = rounds(opp.meta, "screening");
    expect(passes.map((e) => e.at.slice(0, 10))).toEqual(["2026-08-20", "2026-08-26"]);
    expect(passes.map((e) => e.round)).toEqual([1, 2]);
  });

  it("renumbers after an edit moves a round earlier", async () => {
    await seed();
    await appendStatus(SLUG, { status: "interviewing", at: "2026-08-01T09:00:00Z" }, root);
    await appendStatus(SLUG, { status: "interviewing", at: "2026-08-08T09:00:00Z" }, root);

    const opp = await updateEvent(SLUG, 1, { at: "2026-07-20T09:00:00Z" }, root);
    expect(rounds(opp.meta, "interviewing").map((e) => e.round)).toEqual([1, 2]);
    expect(rounds(opp.meta, "interviewing")[0].at.slice(0, 10)).toBe("2026-07-20");
  });

  it("never numbers a status that does not loop", async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied", round: 4 }, root);
    const opp = await appendStatus(SLUG, { status: "offer" }, root);
    expect(opp.meta.history.every((e) => e.round === undefined)).toBe(true);
  });
});

describe("the cached status tracks what happened, not what is booked", () => {
  it("does not report a mismatch when a scheduled entry sits last", async () => {
    await seed(
      [
        "status: interviewing",
        "history:",
        "  - at: 2026-09-01T09:00:00Z",
        "    status: screening",
        "    state: recorded",
        "  - at: 2026-09-05T09:00:00Z",
        "    status: interviewing",
        "    state: scheduled",
        "    eta: within 72 hrs",
      ].join("\n")
    );

    const opp = await readOpportunity(SLUG, root);
    expect(opp.issues).toEqual([]);
    expect(currentStatus(opp.meta)).toBe("interviewing");
  });

  it("still reports a genuinely stale cache", async () => {
    await seed(
      [
        "status: offer",
        "history:",
        "  - at: 2026-09-01T09:00:00Z",
        "    status: screening",
        "    state: recorded",
      ].join("\n")
    );

    const opp = await readOpportunity(SLUG, root);
    expect(opp.issues.join()).toMatch(/disagrees with the furthest entry "screening"/);
  });

  it("caches the latest entry in time after a backdated write, not the last appended", async () => {
    await seed();
    await appendStatus(SLUG, { status: "screening", at: "2026-09-05T09:00:00Z" }, root);
    await appendStatus(SLUG, { status: "applied", at: "2026-08-01T09:00:00Z" }, root);

    const opp = await readOpportunity(SLUG, root);
    expect(opp.meta.status).toBe("screening");
    expect(opp.issues).toEqual([]);
  });
});

describe("pending is distinct from scheduled", () => {
  const applied2 = async () => {
    await seed();
    await appendStatus(SLUG, { status: "applied", at: "2026-07-01T09:00:00Z" }, root);
  };

  it("advances the status, because an assessment being set is the stage moving", async () => {
    await applied2();
    const opp = await appendStatus(
      SLUG,
      { status: "screening", state: "pending", eta: "within 72 hrs", label: "online assessment" },
      root
    );

    expect(currentStatus(opp.meta)).toBe("screening");
    expect(currentIsAhead(opp.meta)).toBe(true);
    expect(lastRecorded(opp.meta)?.status).toBe("applied");
  });

  it("tells the candidate's move apart from the company's", async () => {
    await applied2();
    await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "Thu 14:00 IST" },
      root
    );
    const opp = await appendStatus(
      SLUG,
      { status: "screening", state: "pending", eta: "within 72 hrs", label: "online assessment" },
      root
    );

    expect(pendingEvents(opp.meta)).toHaveLength(1);
    expect(scheduledEvents(opp.meta)).toHaveLength(1);
    expect(openEvents(opp.meta)).toHaveLength(2);
    expect(awaitingCandidate(opp.meta)).toBe(true);
  });

  it("surfaces the candidate's own work first", async () => {
    await applied2();
    await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "Thu 14:00 IST" },
      root
    );
    const opp = await appendStatus(
      SLUG,
      { status: "screening", state: "pending", eta: "within 72 hrs", label: "online assessment" },
      root
    );

    expect(nextAction(opp.meta)?.state).toBe("pending");
    expect(nextAction(opp.meta)?.label).toBe("online assessment");
  });

  it("reports nothing owed when only a slot is booked", async () => {
    await applied2();
    const opp = await appendStatus(
      SLUG,
      { status: "interviewing", state: "scheduled", eta: "Thu 14:00 IST" },
      root
    );
    expect(awaitingCandidate(opp.meta)).toBe(false);
    expect(nextAction(opp.meta)?.state).toBe("scheduled");
  });

  it("keeps the deadline verbatim and drops it once done", async () => {
    await applied2();
    await appendStatus(
      SLUG,
      { status: "screening", state: "pending", eta: "within 72 hrs", label: "online assessment" },
      root
    );
    const opp = await updateEvent(
      SLUG,
      1,
      { state: "recorded", at: "2026-07-03T20:00:00Z", note: "submitted" },
      root
    );

    expect(opp.meta.history[1].eta).toBeUndefined();
    expect(currentStatus(opp.meta)).toBe("screening");
    expect(awaitingCandidate(opp.meta)).toBe(false);
  });
});
