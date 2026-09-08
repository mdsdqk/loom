import { readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { chromium } from "playwright";
import type { Resume, ResumeMetadata } from "./schema.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const templatePath = join(moduleDir, "templates", "resume.html");
const stylePath = join(moduleDir, "styles", "resume.css");

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes `text` then converts `**bold**` markers into `<strong>` — the reference resume's only inline emphasis convention. Callers mark the result `| safe` since it's already escaped. */
function mdBold(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Builds the header contact line, linkifying email/linkedin/github (mailto:/https:// as appropriate) while leaving location/phone as plain text. */
function contactLine(metadata: ResumeMetadata): string {
  const parts: string[] = [];
  if (metadata.location) parts.push(escapeHtml(metadata.location));
  if (metadata.phone) parts.push(escapeHtml(metadata.phone));
  if (metadata.site) {
    const href = metadata.site.startsWith("http")
      ? metadata.site
      : `https://${metadata.site}`;
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(metadata.site_display ?? metadata.site)}</a>`);
  }
  if (metadata.email) {
    parts.push(`<a href="mailto:${escapeHtml(metadata.email)}">${escapeHtml(metadata.email_display ?? metadata.email)}</a>`);
  }
  if (metadata.linkedin) {
    const href = metadata.linkedin.startsWith("http") ? metadata.linkedin : `https://${metadata.linkedin}`;
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(metadata.linkedin_display ?? metadata.linkedin)}</a>`);
  }
  if (metadata.github) {
    const href = metadata.github.startsWith("http") ? metadata.github : `https://${metadata.github}`;
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(metadata.github_display ?? metadata.github)}</a>`);
  }
  return parts.join(" · ");
}

/** Renders a validated Resume IR into a standalone HTML document (inlined CSS, no external assets). */
export async function renderResumeHtml(resume: Resume): Promise<string> {
  const [templateSource, css] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(stylePath, "utf8"),
  ]);

  const env = new nunjucks.Environment(null, { autoescape: true });
  env.addGlobal("mdBold", mdBold);
  env.addGlobal("contactLine", contactLine);

  const body = env.renderString(templateSource, resume);
  return body.replace("</head>", `<style>${css}</style></head>`);
}

/**
 * Renders a validated Resume to a PDF at `outPath` via headless Chromium.
 * Writes to a temp file first and renames into place only on success, so a
 * failed render never destroys a previously valid PDF at `outPath`.
 */
export async function renderResumePdf(resume: Resume, outPath: string): Promise<void> {
  const html = await renderResumeHtml(resume);
  const tmpPath = `${outPath}.tmp-${process.pid}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: tmpPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }

  try {
    await rename(tmpPath, outPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}
