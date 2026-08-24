 # AI-Assisted Job Search Platform

## Product Synthesis & Product Requirements Document

> **Scope note (2026-08-24):** This document describes Loom's long-term product
> thesis and is not the authoritative MVP specification. MVP v1 is the
> single-user, local workflow defined in `docs/wayfinding/map-v1.md`: Profile
> Build, separate per-track Master Resume Build, tailoring for supplied job
> descriptions, review, and PDF export. Job discovery, matching, application
> tracking, learning, and the end-user web experience remain later work.
>
> Current domain terminology and truth rules live in `/CONTEXT.md`.
> In particular, the Candidate Profile is canonical; a Master Resume is an
> accepted track-specific presentation, not the canonical representation of
> the candidate.

## 1. Executive Summary

The product is an AI-assisted platform for job searching and career growth that maintains a persistent, rich understanding of a candidate and uses that understanding to help them discover, evaluate, pursue, and manage career opportunities.

It is not primarily a resume generator, job board, or autonomous agent.

The central idea is that a candidate's career is much richer than any individual resume. A resume is a representation of that career optimized for a particular opportunity. The platform therefore maintains a deeper candidate profile containing experiences, projects, achievements, skills, preferences, goals, evidence, and learned patterns, and uses that information dynamically whenever the candidate interacts with a job opportunity.

The platform combines conventional software with AI reasoning:

> **Deterministic software handles predictable work; AI handles ambiguity, reasoning, interpretation, and generation.**

The AI is therefore embedded within structured workflows rather than being given unrestricted control over the entire application.

Over time, every interaction should make the system more useful to the individual candidate. Job decisions, edits to generated resumes, explicit feedback, preferences, and other signals become part of the candidate's persistent context.

The long-term vision is a platform that can accompany a candidate throughout the entire job-search lifecycle — from understanding their career and discovering opportunities to preparing applications (resume/covers/question answers), tracking progress, preparing for interviews, and eventually assisting with execution.

---

# 2. Product Vision

Create a system that acts as an intelligent career companion for an individual candidate.

The system should understand:

- what the candidate has actually done
    
- what they are good at
    
- what evidence supports those capabilities
    
- what kinds of roles they want
    
- what they do not want
    
- how they prefer to present themselves
    
- which opportunities are genuinely relevant
    
- how each opportunity differs
    
- how the candidate has responded to similar opportunities in the past
    

The product should then use this context to reduce the mechanical work of job searching while improving the quality and relevance of the candidate's decisions and applications.

The ultimate experience should feel less like:

> "Here is an AI that generates documents."

and more like:

> "This system knows my career, knows what I'm looking for, understands this opportunity, and helps me apply in a better way and have a probable shot at receiving an interview call"

---

# 3. Product Thesis

Current job-search workflows treat the candidate primarily as a document.

The candidate has:

- a resume
    
- perhaps a LinkedIn profile
    
- some job-board profiles
    
- a spreadsheet of applications
    
- scattered notes
    
- memories of previous projects
    
- personal preferences
    

Each application is then treated largely as an independent transaction.

AI tools improve individual pieces of this workflow, but many rely heavily on open-ended agentic reasoning and repeated context processing. This can result in unnecessary inference cost, inconsistent behavior, weak validation, and limited learning from the candidate's actual preferences.

The product takes a different approach.

### Core thesis

> **A persistent and structured understanding of the candidate, combined with deterministic workflows and selectively applied AI reasoning, can produce better and more personalized job-search outcomes while being significantly more efficient, predictable, and controllable than an unconstrained agentic system.**

The product should therefore optimize for both:

**Candidate quality**

and

**System efficiency.**

---

# 4. Product Principles

## 4.1 The candidate is more than their resume

The resume should never be the canonical representation of the candidate.

It is one generated representation of a deeper career profile.

---

## 4.2 Truth precedes presentation

The system may transform, summarize, prioritize, and reframe candidate information.

It must not fabricate it.

Claims, metrics, technologies, responsibilities, achievements, and experiences should ultimately be grounded in information supplied or confirmed by the candidate.

MVP v1 implements this through atomic Evidence Claims, compact Source
References, explicit claim lifecycle, and confirmation levels defined in
`/CONTEXT.md`.

---

## 4.3 AI should be used where it adds intelligence

AI should not be used merely because it can be.

Parsing, validation, deduplication, filtering, versioning, state management, rendering, and other predictable tasks should be handled reliably by conventional software.

AI should be concentrated on:

- interpretation
    
- reasoning
    
- ambiguity
    
- synthesis
    
- personalization
    
- generation
    
- adaptive questioning
    
- discovery of patterns
    

---

## 4.4 The workflow is controlled, not autonomous

The system may be dynamic and agentic, but it should not depend on an unrestricted agent deciding what the entire application should do.

The product defines the workflow.

AI operates inside that workflow and can influence decisions where appropriate.

This creates a balance between:

- deterministic execution
    
- adaptive reasoning
    
- human judgment
    

---

## 4.5 Candidate preferences have authority

The system should make recommendations, not override the candidate.

A candidate may reject something that the system considers objectively optimal.

That rejection is valuable information.

Explicit candidate preferences should therefore carry more authority than model recommendations or inferred behavioral patterns.

---

## 4.6 Every interaction can improve personalization

The system should learn from:

- what the candidate accepts
    
- what they reject
    
- what they edit
    
- what they add
    
- what they remove
    
- what they explicitly say they prefer
    
- how they repeatedly make decisions
    

Learning should be incremental and transparent rather than silently changing fundamental candidate preferences.

---

## 4.7 Don't confuse correlation with causation

Application outcomes are useful signals but cannot reliably establish why an application succeeded or failed.

Interview outcomes, recruiter responses, and offers should therefore be treated as useful historical information and analytics rather than definitive proof that a particular resume strategy caused an outcome.

---

# 5. Target User

The primary user is a knowledge worker actively searching for a new role.

The strongest initial fit is a candidate who:

- has meaningful professional experience
    
- is applying to multiple roles
    
- targets more than one closely related role type
    
- needs tailored applications
    
- has accumulated significant career experience that cannot be represented completely in one resume
    
- cares about the quality of applications
    
- wants to reduce repetitive job-search work
    
- is willing to review and provide feedback to an AI system
    

The product should eventually support a much broader range of candidates.

---

# 6. The Candidate Model

The foundational product concept is a persistent **candidate profile**.

The profile is not merely a resume parser output.

It is a structured representation of the candidate's career and aspirations.

It may contain:

### Identity

- name
    
- location
    
- contact information
    
- professional profiles
    
- portfolio links
    

### Education

- institutions
    
- degrees
    
- certifications
    
- relevant coursework
    
- accomplishments
    

### Employment

For every role:

- organization
    
- title
    
- dates
    
- responsibilities
    
- projects
    
- technologies
    
- achievements
    
- scope
    
- leadership
    
- impact
    
- challenges
    
- decisions
    
- outcomes
    

### Projects

Projects may exist independently of formal employment.

They can include:

- personal projects
    
- open-source projects
    
- side projects
    
- entrepreneurial work
    
- academic projects
    

### Skills

- technical skills
    
- domain knowledge
    
- tools
    
- methodologies
    
- leadership capabilities
    
- functional expertise
    

### Evidence

Evidence is particularly important.

Instead of merely storing:

> "Strong technical leader"

the system should ideally retain the underlying evidence:

> Led architecture across multiple teams, conducted cross-team reviews, mentored engineers, and established reusable engineering standards.

The evidence can later support different representations.

### Career stories

Examples include:

- difficult technical problems
    
- major launches
    
- failures
    
- leadership situations
    
- conflict resolution
    
- architectural decisions
    
- performance improvements
    
- business impact
    
- difficult projects
    
- accomplishments the candidate is particularly proud of
    

### Goals

- target roles
    
- target industries
    
- target companies
    
- compensation expectations
    
- geographic preferences
    
- career trajectory
    
- preferred company stage
    
- desired responsibilities
    

### Constraints

- roles to avoid
    
- technologies to avoid
    
- locations to avoid
    
- compensation floors
    
- employment constraints
    
- other explicit requirements
    

---

# 7. Candidate Onboarding

The system should not require the candidate to know how to structure their career information.

A traditional form is insufficient for capturing the richness of professional experience.

The preferred experience is conversational and permissive.

The candidate should be encouraged to provide:

> Everything they have done, built, learned, led, failed at, improved, shipped, managed, or experienced professionally.

The system should explicitly encourage unstructured information.

The candidate does not need to know whether something belongs under:

- experience
    
- achievement
    
- project
    
- skill
    
- leadership
    

The system can determine that later.

The objective of onboarding is to maximize useful candidate information rather than optimize initial presentation.

---

# 8. Adaptive Profile Build

The AI should be able to identify gaps in the candidate's information and ask targeted follow-up questions.

For example:

> You mentioned leading a migration. How many applications were involved?

Or:

> You said the project improved performance. Do you remember the approximate before/after metrics?

Or:

> What part of this project did you personally own?

The objective is not to conduct a generic personality interview. This
conversation is called Profile Build; "interview" is reserved for later
job-interview preparation.

It is to improve the quality of the candidate's career evidence.

The system should prioritize information that is likely to be useful for future applications.

---

# 9. Career Evidence and Provenance

Important candidate information should retain provenance where practical.

For example:

```yaml
id: examplecorp-migration-guides
statement: "Created migration guides adopted by several teams"
status: active
confirmation: implicit
source_refs:
  - sample-resume#platform-modernization
  - transcript#event-42
```

This allows generated content to be traced back to normalized immutable
candidate sources or exact transcript events without copying full excerpts
into routine generation context.

The system should distinguish between:

- candidate-provided information
    
- candidate-confirmed information
    
- AI-inferred information
    
- AI-generated presentation
    

This distinction is fundamental to trust.

Related achievements may be grouped for readability, but independently usable
facts retain separate lifecycle, confirmation, and Source References.

---

# 10. Role Tracks and Career Goals

Candidates frequently target several related roles.

For example:

- Senior Application Engineer
    
- Staff Application Engineer
    
- Senior Platform Engineer
    
- Engineering Lead
    

The system should allow multiple target tracks. A Target Track pairs role
family and level, so `application-engineering-senior` and
`application-engineering-staff` have separate readiness assessments and
Master Resumes even though both belong to the same role family.

Each track represents a different interpretation of the same career.

A candidate may emphasize:

```text
Application engineering track:
architecture
internal platforms
developer experience
reliability
technical leadership
```

while the same candidate may emphasize:

```text
Platform engineering track:
service design
platform architecture
APIs
cloud infrastructure
end-to-end ownership
```

The underlying career evidence remains shared.

The positioning changes.

---

# 11. Resume as a Dynamic Representation

The system should not maintain one immutable "master resume" as the final truth.
MVP v1 may keep accepted per-track Master Resume files, but the Candidate
Profile remains canonical. Those resumes are presentation artifacts, not the
underlying career truth.

Instead:

```text
Candidate Profile
        ↓
Target Role / Positioning
        ↓
Job
        ↓
Tailored Resume
```

A resume is therefore a contextual representation.

The same experience may be:

- emphasized for one role
    
- shortened for another
    
- omitted for another
    
- described differently depending on the opportunity
    

The underlying candidate facts remain unchanged.

---

# 12. Job Understanding

Every job opportunity should be represented as structured information rather than merely a block of text.

Relevant information includes:

- title
    
- company
    
- location
    
- employment type
    
- compensation
    
- seniority
    
- responsibilities
    
- requirements
    
- preferred qualifications
    
- technologies
    
- domain
    
- application method
    
- source
    
- posting date
    
- company information
    
- other relevant signals
    

The system should distinguish clearly between information explicitly present in the job posting and information inferred by AI.

---

# 13. Job Validity

A job should not automatically be considered valid merely because a scraper found it.

Validation should establish whether:

- the posting still exists
    
- the job URL works
    
- the posting contains sufficient information
    
- the company is identifiable
    
- the role is actually an employment opportunity
    
- the application path is valid where available
    

Posting dates have strict semantics.

If the posting explicitly provides a date, record it.

If it does not, the date should remain unknown.

The system should not invent a date from indexing information, URL patterns, search-engine metadata, or other indirect signals.

---

# 14. Job Discovery

The eventual platform should be able to discover opportunities across multiple sources.

The system should progressively reduce the candidate universe:

```text
All discovered jobs
        ↓
Valid jobs
        ↓
Relevant jobs
        ↓
Eligible jobs
        ↓
Strong matches
        ↓
Candidate-approved opportunities
```

Most of this filtering should be inexpensive and deterministic.

Expensive AI analysis should be reserved for opportunities where it can meaningfully change the decision.

---

# 15. Job Matching

Matching should not be represented as a single mysterious score.

The system should consider multiple dimensions, such as:

- role fit
    
- skill fit
    
- seniority fit
    
- experience fit
    
- domain fit
    
- compensation fit
    
- location fit
    
- candidate preference fit
    
- career trajectory fit
    
- evidence strength
    

The system should also distinguish:

**"Can this candidate do this job?"**

from:

**"Does this candidate actually want this job?"**

A highly qualified job that the candidate does not want should not automatically be recommended.

---

# 16. Candidate Decision-Making

The system should support candidate decisions rather than blindly automate them.

For a recommended job, the candidate should be able to understand:

- why it was recommended
    
- what matches
    
- what does not match
    
- what potential concerns exist
    
- what assumptions were made
    
- what the system recommends
    

The candidate can then:

- apply
    
- save
    
- skip
    
- reject
    
- request deeper analysis
    

If the candidate rejects a recommendation, the system should preserve that decision.

When useful, it should ask why.

If no reason is given, it may infer a probable reason, but the inference must remain distinguishable from explicit feedback.

---

# 17. Candidate Preferences

Preferences exist at different levels.

### Hard constraints

Requirements that should generally prevent a recommendation.

### Explicit preferences

Things the candidate strongly prefers or dislikes.

### Learned preferences

Patterns inferred from repeated behavior.

### Model recommendations

Suggestions produced by the system.

These must not be treated equally.

The authority hierarchy should generally be:

```text
Candidate-confirmed facts
        ↓
Explicit constraints
        ↓
Explicit preferences
        ↓
Learned preferences
        ↓
Model recommendations
```

---

# 18. Application Strategy

Before generating application materials, the system should determine how the candidate should be positioned for the particular opportunity.

The strategy may determine:

- which experiences should be emphasized
    
- which should be reduced
    
- which skills should be prominent
    
- what themes should lead the resume
    
- which gaps should be acknowledged or handled
    
- what language best represents the candidate
    
- what evidence supports the positioning
    
- what should not be claimed
    

This strategy provides coherence across the application's materials.

---

# 19. Resume Tailoring

The tailored resume should be generated from:

```text
Candidate Profile
+
Target Role
+
Job Description
+
Application Strategy
+
Candidate Preferences
```

The system should optimize for:

- relevance
    
- factual accuracy
    
- clarity
    
- candidate authenticity
    
- appropriate emphasis
    
- job-specific terminology
    
- concise presentation
    
- consistency with the candidate's preferred style
    

It should not simply maximize keyword overlap.

---

# 20. Resume Review and Diff

The candidate should be able to see what changed.

The system should communicate:

- additions
    
- removals
    
- rewrites
    
- changes in emphasis
    
- meaningful positioning changes
    

Where useful, changes should be accompanied by reasoning.

For example:

> This experience was promoted because the job emphasizes platform architecture.

The candidate should be able to:

- accept
    
- reject
    
- edit
    
- comment
    

on individual changes.

---

# 21. Learning From Resume Edits

Every generated resume creates an opportunity to learn.

The system should compare:

```text
AI-generated version
        ↓
candidate-edited version
```

and identify recurring patterns.

Potential signals include:

- terminology preferences
    
- preferred specificity
    
- preferred metrics
    
- preferred tone
    
- preferred action verbs
    
- recurring additions
    
- recurring deletions
    
- recurring changes in emphasis
    

The system should distinguish between:

**"The candidate changed this once."**

and:

**"The candidate repeatedly prefers this."**

When the system becomes sufficiently confident about a preference, it can use that preference automatically.

When confidence is low or the preference could materially affect future applications, the system may ask for confirmation.

---

# 22. Human Judgment Remains Authoritative

The system should not assume that objective optimization is always preferable.

A candidate may intentionally emphasize something because:

- it represents them better
    
- they want to move toward a particular domain
    
- it reflects a career goal
    
- they know how recruiters in their market respond
    
- it is personally important
    
- it represents a capability that is difficult to infer objectively
    

The product should therefore optimize for:

> **The candidate's desired representation of themselves, constrained by truth.**

not:

> **What the model believes is objectively the best resume.**

---

# 23. Application Materials

The platform should eventually support multiple job-specific materials.

These may include:

- resume
    
- cover letter
    
- application-question responses
    
- recruiter messages
    
- introductory emails
    
- portfolio recommendations
    
- other supporting materials
    

All materials for a particular opportunity should share a common positioning strategy so that the application feels coherent.

---

# 24. Cover Letters

Cover letters are inherently job-specific.

They should be generated from:

- job description
    
- company context
    
- candidate profile
    
- application strategy
    
- final resume
    

The system should avoid simply repeating the resume.

The cover letter should provide narrative context around the strongest reasons the candidate is relevant to the opportunity.

---

# 25. Company Understanding

Company information is useful but should remain distinct from candidate information and individual job information.

Company intelligence may include:

- products
    
- industry
    
- company stage
    
- technology
    
- leadership
    
- engineering organization
    
- recent developments
    
- compensation information
    
- publicly available employee information
    
- relevant company context
    

Company information can improve job analysis and application strategy.

Eventually, this information may form a shared knowledge layer rather than being recomputed independently for every candidate or every application.

---

# 26. Application Management

The platform should eventually provide a coherent view of the candidate's applications.

The candidate should be able to understand:

- which jobs were discovered
    
- which were recommended
    
- which were rejected
    
- which were reviewed
    
- which materials were generated
    
- which applications were submitted
    
- current status
    
- follow-up requirements
    
- interviews
    
- recruiter communication
    
- outcomes
    

The system should preserve the history of each application rather than reducing it to its current state.

---

# 27. Application History as Context

Past applications should inform future assistance.

For example:

> You previously skipped several Java-heavy frontend roles.

or:

> You consistently remove generic leadership language from generated resumes.

or:

> You previously preferred emphasizing your platform architecture experience for Staff-level roles.

Historical information should influence recommendations without becoming an invisible hard constraint.

---

# 28. Job Discovery and Scraper Intelligence

The eventual platform should support reusable job-source strategies.

For known sources, deterministic scrapers should perform repeated extraction.

For previously unseen or changed sources, AI may assist in discovering or repairing an extraction strategy.

The goal is:

> AI creates or repairs a reusable extraction mechanism; the mechanism performs the repeated work.

The system should avoid repeatedly consuming AI inference for the same predictable scraping task.

Generated strategies should be:

- persistent
    
- versioned
    
- testable
    
- validated
    
- replaceable
    
- observable
    

---

# 29. Intelligence Allocation

The platform should progressively allocate intelligence according to the value and ambiguity of a task.

For example:

```text
Raw page
   ↓
deterministic parsing
   ↓
validation
   ↓
hard filters
   ↓
cheap matching
   ↓
lightweight reasoning
   ↓
deep analysis
   ↓
generation
```

This allows large volumes of jobs to be processed economically.

The product should not assume that every job deserves the same depth of analysis.

---

# 30. Cost as a Product Requirement

AI inference cost is not merely an infrastructure concern.

It directly affects whether the product is useful.

The platform should be designed so that:

- large-scale job discovery is inexpensive
    
- repeated work is cached
    
- deterministic processing happens before AI
    
- expensive models are used selectively
    
- AI tasks have bounded budgets
    
- unnecessary context is avoided
    
- model selection is based on task requirements rather than prestige
    

The goal is not simply:

> "Use the cheapest model."

The goal is:

> **Use the least expensive intelligence that produces an acceptable result for the task.**

---

# 31. Caching and Reuse

The platform should recognize that many pieces of information are reusable.

Potential reusable knowledge includes:

- job requirement extraction
    
- company information
    
- skill normalization
    
- role interpretation
    
- source-specific scraping strategies
    
- candidate preference interpretation
    
- previous analyses
    

The system should investigate both exact caching and semantic reuse.

However, reuse must never cause stale or unrelated information to be silently applied to a new job.

---

# 32. Trust and Transparency

AI assistance should be inspectable.

The candidate should be able to understand:

- what the system changed
    
- why it changed it
    
- what evidence it used
    
- what assumptions it made
    
- where it is uncertain
    
- what came from the candidate
    
- what was inferred
    

The product should not create a false impression of certainty.

---

# 33. Privacy and Data Ownership

Career information is highly personal.

The product should be designed around strong candidate ownership.

The candidate should be able to:

- inspect their stored information
    
- export it
    
- delete it
    
- control what information is used for generation
    
- understand what information is sent to external AI providers
    

A local-first architecture is particularly attractive for users who want maximum control over their career data.

Cloud functionality can eventually be introduced where it provides meaningful value.

---

# 34. User Experience

The product should feel like a useful professional application rather than an AI playground.

The candidate should not need to understand:

- agents
    
- prompts
    
- vector databases
    
- workflows
    
- retrieval
    
- models
    
- tools
    
- orchestration
    

Those are implementation concepts.

The user should understand:

- their profile
    
- their resumes
    
- their jobs
    
- their applications
    
- their feedback
    
- what the system recommends
    

The system should expose complexity only when doing so helps the user make a better decision.

---

# 35. Core User Experience Loop

The fundamental loop is:

```text
Candidate
    ↓
Career information
    ↓
Job opportunity
    ↓
Understand fit
    ↓
Decide whether to pursue
    ↓
Tailor application
    ↓
Candidate reviews
    ↓
Candidate edits / approves
    ↓
Application
    ↓
Feedback
    ↓
Improved candidate understanding
    ↓
Next opportunity
```

Every cycle should make the next cycle more personalized.

---

# 36. Long-Term Product Surface

The platform can eventually extend beyond applications into broader career assistance.

Potential capabilities include:

### Job discovery

Find opportunities aligned with the candidate's goals.

### Application assistance

Prepare tailored application materials.

### Application management

Track applications and follow-ups.

### Interview preparation

Generate preparation based on the actual role, company, candidate history, and previous interviews.

### Career planning

Help the candidate understand which experiences and skills would move them toward a desired career trajectory.

### Compensation and negotiation

Provide contextual market information and negotiation assistance.

### Professional positioning

Help maintain and adapt professional profiles and portfolios.

### Career growth

Help the candidate identify gaps, opportunities, and development priorities even when they are not actively job searching.

The common foundation remains the same:

> A persistent understanding of the candidate combined with contextual intelligence.

---

# 37. What the Product Is Not

The product should not become:

### A generic chatbot

The AI must operate against structured candidate and job context.

### A resume template generator

The core value is contextual understanding, not formatting.

### A job board

Job discovery is an input to the candidate's workflow, not necessarily the product's primary destination.

### A blind auto-apply bot

Automation should increase leverage without removing candidate control unnecessarily.

### An unconstrained autonomous agent

The system should have explicit workflows, boundaries, validation, and state.

### A black-box recommendation engine

Candidates should understand why important recommendations are being made.

### A causal career prediction system

Historical application outcomes are useful signals, but they do not establish causal relationships between specific application strategies and outcomes.

---

# 38. Product Success

Success should be measured primarily by whether the product meaningfully improves the candidate's job-search experience.

Relevant measures include:

### Efficiency

- time saved per application
    
- time spent reviewing generated material
    
- reduction in repetitive work
    
- number of opportunities processed per unit of inference cost
    

### Quality

- candidate acceptance rate of generated material
    
- amount of editing required
    
- factual accuracy
    
- relevance of recommendations
    
- candidate satisfaction
    

### Personalization

- improvement in alignment with candidate preferences
    
- reduction in repeated unwanted suggestions
    
- increasing consistency with candidate editing style
    

### Job-search utility

- useful opportunities discovered
    
- applications completed
    
- candidate-reported usefulness
    
- recruiter responses
    
- interviews
    
- offers
    

Outcome metrics should be treated as directional signals rather than proof of causation.

---

# 39. Product Differentiation

The strongest differentiation is not:

> "We use AI."

Almost every modern job-search product can make that claim.

The differentiation is the combination of:

### Persistent candidate understanding

The system knows the candidate beyond their current resume.

### Contextual generation

Every application is tailored to a specific opportunity.

### Candidate-specific learning

The system learns from what the candidate actually accepts, rejects, and edits.

### Deterministic execution

Predictable work does not unnecessarily consume AI inference.

### Bounded intelligence

AI reasoning is used where it adds value rather than controlling the entire system.

### Transparency

Generated content and recommendations can be traced to candidate evidence and reasoning.

### Longitudinal context

The system becomes more useful over time rather than treating every application as a new conversation.

---

# 40. North-Star Product Hypothesis

The fundamental hypothesis is:

> **If a job-search system maintains a persistent and evidence-backed model of the candidate, understands each opportunity in context, and learns from the candidate's decisions and edits, it can produce more relevant and authentic applications with less repetitive effort than conventional job-search workflows or generic AI resume tools.**

The corresponding technical/product hypothesis is:

> **Most job-search operations do not require expensive open-ended reasoning. A deterministic workflow can handle the majority of processing, reserving AI for ambiguous and high-value decisions.**

Together, these hypotheses define the product.

---

# 41. The Long-Term Flywheel

The product should improve through a continuous loop:

```text
Better candidate information
        ↓
Better understanding
        ↓
Better job matching
        ↓
Better application strategy
        ↓
Better tailored materials
        ↓
Better candidate feedback
        ↓
Better preference understanding
        ↓
Better candidate information
        ↓
...
```

The accumulated candidate context becomes increasingly valuable.

The system does not merely generate more content.

It becomes increasingly aligned with the individual person it is helping.

---

# 42. Product North Star

Ultimately, the product should answer one question exceptionally well:

> **"Given who I am, what I have done, what I want next, and the opportunities available to me, what should I do about this job?"**

Everything else — job discovery, matching, resumes, cover letters, research, application tracking, feedback, and eventually automation — exists to answer that question better, faster, and with less repetitive effort.

The product is therefore best understood not as an AI resume generator or an autonomous job-search agent, but as an **AI-assisted platform for managing and advancing an individual's job search and career.**