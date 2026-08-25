import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeLinkedInCsvSource,
  normalizeTextSource,
  paragraphsFromParsedPdf,
  paragraphsFromText,
} from "../src/source-normalization/normalize.js";
import { appendManifestEntry, buildSourceRefIndex, createSourceRefResolver, loadManifest } from "../src/source-normalization/manifest.js";
import type { ParsedPdf } from "../src/pdf-parse.js";
import type { ParsedTabular } from "../src/csv-parse.js";

describe("paragraphsFromText", () => {
  it("splits on blank lines and trims each paragraph", () => {
    const text = "First paragraph.\n\n  Second paragraph,\nstill second.\n\n\nThird.";
    expect(paragraphsFromText(text)).toEqual(["First paragraph.", "Second paragraph,\nstill second.", "Third."]);
  });

  it("drops empty paragraphs", () => {
    expect(paragraphsFromText("Only one.\n\n\n\n")).toEqual(["Only one."]);
  });
});

describe("paragraphsFromParsedPdf", () => {
  it("flattens per-page paragraph line-groups into one string per paragraph", () => {
    const pdf: ParsedPdf = {
      source: "resume.pdf",
      pageCount: 2,
      pages: [
        { page: 1, lines: [], paragraphs: [["Name"], ["Line one", "line two"]] },
        { page: 2, lines: [], paragraphs: [["Page two paragraph"]] },
      ],
    };
    expect(paragraphsFromParsedPdf(pdf)).toEqual(["Name", "Line one line two", "Page two paragraph"]);
  });
});

describe("normalizeTextSource", () => {
  it("assigns stable para-N ids in order", () => {
    const result = normalizeTextSource("run-a", "sample-resume", "resume_markdown", "candidate/imports/resume.md", [
      "Alpha",
      "Beta",
    ]);
    expect(result.records).toEqual([
      { id: "para-1", text: "Alpha" },
      { id: "para-2", text: "Beta" },
    ]);
    expect(result.run_id).toBe("run-a");
    expect(result.source_id).toBe("sample-resume");
    expect(result.source_type).toBe("resume_markdown");
  });
});

describe("normalizeLinkedInCsvSource", () => {
  it("renders each row as citable Key: Value text and assigns row-N ids", () => {
    const tabular: ParsedTabular = {
      source: "Positions.csv",
      sheets: [
        {
          name: "Sheet1",
          rowCount: 2,
          rows: [
            { "Company Name": "Example Corp", Title: "Engineer", "Started On": "" },
            { "Company Name": "Other Corp", Title: "Lead", "Started On": "Jan 2020" },
          ],
        },
      ],
    };
    const result = normalizeLinkedInCsvSource("run-a", "linkedin-positions", "candidate/imports/linkedin/Positions.csv", tabular);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].text).toBe("Company Name: Example Corp\nTitle: Engineer");
    expect(result.records[1].text).toContain("Started On: Jan 2020");
  });

  it("skips rows that render to no citable text", () => {
    const tabular: ParsedTabular = {
      source: "empty.csv",
      sheets: [{ name: "Sheet1", rowCount: 1, rows: [{ Field: "" }] }],
    };
    const result = normalizeLinkedInCsvSource("run-a", "empty", "empty.csv", tabular);
    expect(result.records).toHaveLength(0);
  });
});

describe("manifest + source ref resolution", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loom-source-norm-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a manifest on first append and accumulates entries across calls", async () => {
    const manifestPath = join(dir, "source-manifest.yml");
    await appendManifestEntry(manifestPath, {
      run_id: "run-a",
      source_id: "sample-resume",
      source_type: "resume_markdown",
      original_path: "candidate/imports/resume.md",
      normalized_path: join(dir, "run-a--sample-resume.yml"),
    });
    await appendManifestEntry(manifestPath, {
      run_id: "run-a",
      source_id: "linkedin-positions",
      source_type: "linkedin_csv",
      original_path: "candidate/imports/linkedin/Positions.csv",
      normalized_path: join(dir, "run-a--linkedin-positions.yml"),
    });

    const manifest = await loadManifest(manifestPath);
    expect(manifest.sources).toHaveLength(2);
    expect(manifest.sources.map((entry) => entry.source_id)).toEqual(["sample-resume", "linkedin-positions"]);
  });

  it("returns an empty manifest when the file doesn't exist yet", async () => {
    const manifest = await loadManifest(join(dir, "does-not-exist.yml"));
    expect(manifest).toEqual({ sources: [] });
  });
});

describe("buildSourceRefIndex + createSourceRefResolver", () => {
  it("resolves a source: ref that matches a normalized record", () => {
    const source = normalizeTextSource("run-a", "sample-resume", "resume_markdown", "resume.md", ["Alpha"]);
    const resolver = createSourceRefResolver(buildSourceRefIndex([source]));
    expect(resolver("source:run-a:sample-resume#para-1")).toBe(true);
  });

  it("rejects a source: ref to a record that doesn't exist", () => {
    const source = normalizeTextSource("run-a", "sample-resume", "resume_markdown", "resume.md", ["Alpha"]);
    const resolver = createSourceRefResolver(buildSourceRefIndex([source]));
    expect(resolver("source:run-a:sample-resume#para-99")).toBe(false);
  });

  it("fails closed on a transcript: ref when no transcript index is given -- it does not auto-pass", () => {
    const resolver = createSourceRefResolver(buildSourceRefIndex([]));
    expect(resolver("transcript:run-a#event-1")).toBe(false);
  });

  it("resolves a transcript: ref that's present in the given transcript index", () => {
    const resolver = createSourceRefResolver(buildSourceRefIndex([]), new Set(["transcript:run-a#event-1"]));
    expect(resolver("transcript:run-a#event-1")).toBe(true);
  });

  it("rejects a transcript: ref not present in the given transcript index", () => {
    const resolver = createSourceRefResolver(buildSourceRefIndex([]), new Set(["transcript:run-a#event-1"]));
    expect(resolver("transcript:run-a#event-99")).toBe(false);
  });
});
