import { describe, expect, it } from "vitest";
import {
  buildReferrerIndex,
  parseConnectedOn,
  rankReferrers,
  recencyFactor,
  scoreReferrer,
} from "../src/network-scan/referrals.js";
import type { Company, Connection, SeniorityBand } from "../src/network-scan/schema.js";

const NOW = new Date("2026-09-09T00:00:00.000Z");

function connection(over: Partial<Connection> & { name: string }): Connection {
  return {
    company_raw: "Example Co",
    seniority: "mid" as SeniorityBand,
    connected_on: "01 Jan 2026",
    ...over,
  };
}

function company(connections: Connection[], signals: Partial<Company["signals"]> = {}): Company {
  return {
    id: "exampleco",
    canonical_name: "Example Co",
    aliases: [],
    connections,
    signals: {
      connection_count: connections.length,
      seniority: { leadership: 0, lead: 0, senior: 0, mid: 0, junior: 0, unknown: 0 },
      saved_job_count: 0,
      followed: false,
      ex_employer: false,
      alumni: false,
      ...signals,
    },
  };
}

describe("parseConnectedOn", () => {
  it("reads LinkedIn's date format", () => {
    expect(parseConnectedOn("17 Aug 2026")?.getUTCFullYear()).toBe(2026);
  });

  it("returns null rather than an invalid date", () => {
    expect(parseConnectedOn(undefined)).toBeNull();
    expect(parseConnectedOn("not a date")).toBeNull();
  });
});

describe("recencyFactor", () => {
  it("favours a recent connection but never discards an old one", () => {
    const recent = recencyFactor(new Date("2026-06-01"), NOW);
    const old = recencyFactor(new Date("2016-01-01"), NOW);

    expect(recent).toBe(1);
    expect(old).toBeGreaterThan(0.5);
    expect(old).toBeLessThan(recent);
  });

  it("assumes something middling when the date is unknown", () => {
    expect(recencyFactor(null, NOW)).toBeGreaterThan(0.5);
    expect(recencyFactor(null, NOW)).toBeLessThan(1);
  });
});

describe("scoreReferrer", () => {
  it("ranks a senior connection above a junior one at the same company", () => {
    const target = company([]);
    const lead = scoreReferrer(connection({ name: "A", seniority: "lead" }), target, NOW);
    const junior = scoreReferrer(connection({ name: "B", seniority: "junior" }), target, NOW);

    expect(lead.score).toBeGreaterThan(junior.score);
  });

  it("does not exclude junior connections, who can still file a referral", () => {
    const junior = scoreReferrer(
      connection({ name: "B", seniority: "junior" }),
      company([]),
      NOW
    );
    expect(junior.score).toBeGreaterThan(0);
  });

  it("treats a former colleague as the strongest case and says why", () => {
    const plain = scoreReferrer(connection({ name: "A" }), company([]), NOW);
    const colleague = scoreReferrer(
      connection({ name: "A" }),
      company([], { ex_employer: true }),
      NOW
    );

    expect(colleague.score).toBeGreaterThan(plain.score);
    expect(colleague.reasons.join(" ")).toMatch(/worked at this company/i);
  });

  it("explains its reasoning rather than emitting a bare number", () => {
    const result = scoreReferrer(
      connection({ name: "A", seniority: "leadership", connected_on: "01 Jun 2026" }),
      company([]),
      NOW
    );

    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toMatch(/senior enough|within the last year/i);
  });
});

describe("rankReferrers", () => {
  const people = [
    connection({ name: "Zoe Junior", seniority: "junior" }),
    connection({ name: "Ada Leader", seniority: "leadership" }),
    connection({ name: "Bo Senior", seniority: "senior" }),
    connection({ name: "Cy Mid", seniority: "mid" }),
  ];

  it("puts the best-placed person first", () => {
    const ranked = rankReferrers(company(people), NOW, 3);
    expect(ranked[0].name).toBe("Ada Leader");
    expect(ranked).toHaveLength(3);
  });

  it("is stable regardless of the order connections appear in the export", () => {
    const forwards = rankReferrers(company(people), NOW).map((r) => r.name);
    const backwards = rankReferrers(company([...people].reverse()), NOW).map((r) => r.name);

    expect(forwards).toEqual(backwards);
  });

  it("returns nothing for a company with no recorded connections", () => {
    expect(rankReferrers(company([]), NOW)).toEqual([]);
  });

  it("breaks ties by name so repeated runs agree", () => {
    const tied = [
      connection({ name: "Bea", seniority: "senior" }),
      connection({ name: "Abe", seniority: "senior" }),
    ];
    expect(rankReferrers(company(tied), NOW)[0].name).toBe("Abe");
  });
});

describe("buildReferrerIndex", () => {
  it("keys the suggestions by company id", () => {
    const index = buildReferrerIndex(
      [company([connection({ name: "Ada Leader", seniority: "leadership" })])],
      NOW
    );

    expect(index.get("exampleco")?.[0].name).toBe("Ada Leader");
  });
});
