---
id: "005"
title: "Job Scraping: Platform Priority, Access Method & Implementation"
type: "research"
status: "deferred"
assignee: null
blocked_by: ["001", "002"]
blocking: ["006"]
---

## Question

Lock down the job scraping implementation strategy for a post-MVP release. It
is explicitly outside MVP v1. The tentative priority order remains Indeed,
YC Jobs, company portals, WellFound, then gated sources such as LinkedIn.

**Requirements** (from grilling):
- Hybrid approach: APIs where available, scraping where needed
- Manual triggering for MVP (user clicks "Search", waits for results)
- Scraping output feeds into Jobs table (need to understand expected schema from ticket 002)
- Pragmatic about platform restrictions (companies want to hire, people want opportunities)

**Open questions**:
1. **Platform-by-platform approach**:
   - **Indeed**: Does Indeed have a public API? If not, scraping approach (Puppeteer? Cheerio? Limitations?)? What fields do we extract (title, company, description, url, location, compensation)?
   - **YC Jobs** (YC-funded companies): Is there an API? Scraping? Same fields as Indeed?
   - **Company portals**: How do we discover them? Is this user-provided (e.g., "add this company's careers page") or automated crawling? Scope for MVP?
   - **WellFound** (AngelList): API available? Scraping?
   - **LinkedIn**: API access (restricted to BYOK user credentials?)? Browser automation fallback? Cost + feasibility for MVP?
2. **Implementation approach**: 
   - Do we build platform-specific scrapers (one module per platform), or a generic fetcher + parsers?
   - Where do scrapers run? (Node.js API route, triggered manually from UI)
   - Error handling & retry logic for MVP?
3. **Output structure**: What does the scraper return? (JSON? Raw HTML? Parsed into Jobs table format directly?)
4. **Deduplication**: If user scrapes twice, do we detect duplicates or store every scrape? Implications for DB?
5. **MVP scope**: Start with one platform (Indeed?) to prove the pipeline, then add others? Or multi-platform scraping from day-1?

**Context**: retain this ticket as future research. Do not let it expand the
Profile Build, Master Resume, tailoring, and export scope of MVP v1.

## Resolution

*(To be filled on ticket close)*
