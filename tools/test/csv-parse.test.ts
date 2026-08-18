import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTabular } from "../src/csv-parse.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("parseTabular", () => {
  it("parses a csv into a single synthetic sheet", () => {
    const result = parseTabular(join(fixtures, "positions.csv"));
    expect(result.source).toBe("positions.csv");
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].rowCount).toBe(2);
    expect(result.sheets[0].rows[0]).toMatchObject({
      "Company Name": "Example Corp",
      Title: "Software Engineer",
    });
  });

  it("parses every sheet of an xlsx workbook", () => {
    const result = parseTabular(join(fixtures, "profile.xlsx"));
    const names = result.sheets.map((sheet) => sheet.name);
    expect(names).toEqual(["Skills", "Education"]);
    expect(result.sheets[0].rows).toContainEqual({ Name: "TypeScript" });
    expect(result.sheets[1].rowCount).toBe(1);
  });
});
