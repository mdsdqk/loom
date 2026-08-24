---
id: "006"
title: "Matching & Triage: Two-Stage Ranking Algorithm"
type: "grilling"
status: "deferred"
assignee: null
blocked_by: ["002", "005"]
blocking: []
---

## Question

Design the matching and triage algorithm for the post-MVP job-discovery
stage. It is explicitly outside MVP v1. The future flow remains two-stage:
1. **Cheap triage**: Quick rank of all scraped jobs (fast, low-cost model)
2. **Full match** (post-MVP): User-initiated bulk or single matching (deeper analysis)

**Future scope**: begin with cheap triage. Full matching follows later.

**Requirements** (from grilling):
- Run cheap triage automatically after scraping (rank jobs before user sees them)
- Signals: title match, role description, company fit, compensation, location, etc. (weighted)
- Output: ranked list of jobs (top N shown first) sorted by match score
- Cost-optimized (cheap model like Haiku? Or deterministic scoring without API calls?)

**Open questions**:
1. **Triage scoring approach**:
   - **LLM-based scoring**: Send (Candidate profile + Job description) to Haiku, get a score (1-10)?
   - **Deterministic scoring**: Parse job description for signals (keywords, compensation, seniority level) and compute score without API calls?
   - **Hybrid**: Deterministic first (fast), LLM if borderline?
2. **Scoring signals** (from grilling, Q15 — "weighted signals"):
   - Title match (Senior, Staff, IC level — does job title match target roles?)
   - Role description (role family, scope, and specialization overlap)
   - Company characteristics (stage, domain, and candidate preferences)
   - Compensation (does it meet the candidate's configured range?)
   - Location (does it match allowed locations and remote-work preferences?)
   - Other signals?
3. **Weighting**: What's the priority order? (E.g., title 40%, description 30%, compensation 15%, company 10%, location 5%?)
4. **Cost & performance**:
   - If LLM-based: How many tokens per triage? Cost per 100 jobs scraped?
   - Target latency? (User clicks "Scrape" → results ranked in <30s, <60s, <5min?)
5. **Output format**: 
   - Ranked list with score per job?
   - Threshold (only show jobs above 60% match)?
   - Can user filter/re-rank?
6. **Full matching** (post-MVP): When user clicks a job in triage results, do they initiate a "full match" that does deeper analysis (e.g., candidate skills vs. job requirements, culture fit, interview style)? Or is triage enough for MVP?

**Context**: retain this ticket for the job-discovery release. Do not implement
triage as part of MVP v1.

## Resolution

*(To be filled on ticket close)*
