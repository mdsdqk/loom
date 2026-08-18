import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
// pdfjs-dist ships its own types under a path TypeScript's NodeNext resolution
// doesn't always find via the package's `exports` map, so the text-content
// shapes we actually use are declared locally instead of imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export interface ParsedPdfPage {
  page: number;
  lines: string[];
  paragraphs: string[][];
  warnings?: string[];
}

export interface ParsedPdf {
  source: string;
  pageCount: number;
  pages: ParsedPdfPage[];
}

interface PositionedItem {
  x: number;
  y: number;
  width: number;
  str: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Group text items into visual lines by clustering close y-coordinates, then reading each cluster left-to-right. */
function reconstructLines(items: PositionedItem[]): { y: number; text: string }[] {
  if (items.length === 0) return [];

  const yTolerance = 3;

  const sortedByY = [...items].sort((a, b) => b.y - a.y);
  const clusters: PositionedItem[][] = [];
  for (const item of sortedByY) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= yTolerance) {
      last.push(item);
    } else {
      clusters.push([item]);
    }
  }

  return clusters.map((cluster) => {
    const sorted = [...cluster].sort((a, b) => a.x - b.x);
    let text = "";
    let expectedX: number | null = null;
    for (const item of sorted) {
      if (expectedX !== null && item.x - expectedX > 1) {
        text += " ";
      }
      text += item.str;
      expectedX = item.x + item.width;
    }
    return { y: cluster[0].y, text: text.trim() };
  }).filter((line) => line.text.length > 0);
}

/** Group consecutive lines into paragraphs by detecting vertical gaps larger than the typical line pitch. */
function groupParagraphs(lines: { y: number; text: string }[]): string[][] {
  if (lines.length === 0) return [];

  const gaps = lines.slice(1).map((line, i) => lines[i].y - line.y).filter((gap) => gap > 0);
  const typicalPitch = median(gaps) || 1;

  const paragraphs: string[][] = [[lines[0].text]];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > typicalPitch * 1.5) {
      paragraphs.push([lines[i].text]);
    } else {
      paragraphs[paragraphs.length - 1].push(lines[i].text);
    }
  }
  return paragraphs;
}

const require = createRequire(import.meta.url);
const standardFontDataUrl =
  join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

export async function parsePdf(filePath: string): Promise<ParsedPdf> {
  const data = await readFile(filePath);
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl,
  }).promise;

  const pages: ParsedPdfPage[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items = (textContent.items as RawTextItem[])
      .filter((item) => item.str.trim().length > 0)
      .map((item): PositionedItem => ({
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        str: item.str,
      }));

    const lines = reconstructLines(items);
    const paragraphs = groupParagraphs(lines);

    pages.push({
      page: pageNum,
      lines: lines.map((line) => line.text),
      paragraphs,
      ...(items.length === 0 ? { warnings: ["No extractable text (possibly a scanned image)"] } : {}),
    });
  }

  await doc.destroy();

  return {
    source: basename(filePath),
    pageCount: doc.numPages,
    pages,
  };
}
