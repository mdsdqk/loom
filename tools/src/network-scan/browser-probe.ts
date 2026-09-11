import { chromium } from "playwright";
import type { Browser } from "playwright";
import { USER_AGENT } from "./http/client.js";

/**
 * Browser-assisted discovery, used only when static fetching learns nothing.
 *
 * The browser is a **discovery instrument, never a fetching path**. Many large
 * employers serve a JavaScript shell whose careers page contains no trace of
 * the underlying system until it runs; rendering the page once reveals both the
 * final markup and the endpoints it calls. Whatever is learned is written to
 * the registry, and the browser is never launched for that company again.
 *
 * It does not attempt to defeat bot protection, solve challenges, or
 * impersonate a real user — it identifies itself with the same user agent as
 * the plain HTTP client, and gives up quickly.
 */

export interface BrowserProbeResult {
  /** The DOM after scripts ran. */
  html: string;
  /** Same-page network requests, for spotting a job API or an embedded board. */
  requestUrls: string[];
  finalUrl: string;
}

export interface BrowserProbeOptions {
  timeoutMs?: number;
  maxRequests?: number;
}

/** URL shapes worth recording — an ATS host, or something that looks like a job API. */
const INTERESTING = /(job|posting|opening|position|requisition|career|vacanc|recruit|greenhouse|lever|ashby|workday|smartrecruiters|icims|taleo|successfactors|eightfold|phenom|darwinbox|keka)/i;

/**
 * A single browser instance shared across probes.
 *
 * Launching Chromium per company would dominate the runtime of a scan; the
 * caller is responsible for calling `close()` when finished.
 */
export class BrowserProbe {
  private browser: Browser | null = null;
  private failed = false;

  /** True when a browser could not be started at all (e.g. no downloaded binary). */
  get unavailable(): boolean {
    return this.failed;
  }

  private async ensure(): Promise<Browser | null> {
    if (this.browser) return this.browser;
    if (this.failed) return null;
    try {
      this.browser = await chromium.launch({ headless: true });
      return this.browser;
    } catch {
      // Playwright's browsers may simply not be installed. That is a degraded
      // scan, not a failed one — every other stage still works.
      this.failed = true;
      return null;
    }
  }

  async probe(url: string, options: BrowserProbeOptions = {}): Promise<BrowserProbeResult | null> {
    const browser = await this.ensure();
    if (!browser) return null;

    const timeout = options.timeoutMs ?? 20_000;
    const maxRequests = options.maxRequests ?? 300;

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      javaScriptEnabled: true,
      // Images and fonts tell us nothing and cost the whole budget.
      serviceWorkers: "block",
    });

    const requestUrls: string[] = [];
    let page;

    try {
      page = await context.newPage();

      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (type === "image" || type === "font" || type === "media" || type === "stylesheet") {
          return route.abort();
        }
        return route.continue();
      });

      page.on("request", (request) => {
        if (requestUrls.length >= maxRequests) return;
        const requestUrl = request.url();
        if (INTERESTING.test(requestUrl)) requestUrls.push(requestUrl);
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      // Give client-side rendering a moment to issue its data requests.
      await page.waitForTimeout(2_500);

      return {
        html: (await page.content()).slice(0, 1_000_000),
        requestUrls: [...new Set(requestUrls)],
        finalUrl: page.url(),
      };
    } catch {
      // A page that will not render is simply undiscoverable this way.
      return requestUrls.length > 0
        ? { html: "", requestUrls: [...new Set(requestUrls)], finalUrl: url }
        : null;
    } finally {
      await page?.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
