import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePdf } from "../src/pdf-parse.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parsePdf", () => {
  it("reconstructs lines and paragraphs from a text-based page", async () => {
    const result = await parsePdf(join(fixtures, "sample.pdf"));
    expect(result.source).toBe("sample.pdf");
    expect(result.pageCount).toBe(2);

    const [page1] = result.pages;
    expect(page1.lines).toEqual([
      "Jane Doe",
      "Software Engineer",
      "Experience",
      "Example Corp - Engineer",
      "Built things and shipped code",
    ]);

    // "Jane Doe" / "Software Engineer" sit close together, then a bigger gap
    // precedes the "Experience" section - that gap should start a new paragraph.
    expect(page1.paragraphs[0]).toEqual(["Jane Doe", "Software Engineer"]);
    expect(page1.paragraphs[1][0]).toBe("Experience");
  });

  it("flags a page with no extractable text", async () => {
    const result = await parsePdf(join(fixtures, "sample.pdf"));
    const [, page2] = result.pages;
    expect(page2.lines).toEqual([]);
    expect(page2.warnings).toContain("No extractable text (possibly a scanned image)");
  });
});
