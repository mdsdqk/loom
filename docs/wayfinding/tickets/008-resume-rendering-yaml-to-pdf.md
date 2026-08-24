---
id: "008"
title: "Resume Rendering: YAML → HTML → PDF"
type: "grilling"
status: "resolved"
assignee: null
blocked_by: ["002"]
blocking: []
---

## Question

Design the resume rendering pipeline. Resumes are stored as YAML (with markdown formatting: \*\*bold\*\*, \~italic\~), and need to be rendered to HTML and PDF for submission.

All example candidate data in this ticket is fictional.

**Workflow**:
```
resume_final.yml (YAML with markdown formatting)
    ↓
Template engine (render YAML → HTML)
    ↓
resume.html
    ↓
HTML → PDF library
    ↓
resume.pdf
```

**Requirements**:
- Use a template system (Handlebars, Nunjucks, or other)
- YAML data includes: name, contact, roles, bullets, skills, etc.
- Markdown-style formatting in YAML (\*\*bold\*\*, \~italic\~) should render as styled HTML
- PDF output should be professional and consistent (matching master resume template)
- Eventually support multiple templates (1-pager, 2-pager), but MVP starts with one

**Open questions**:

1. **YAML structure**: Exact format for resume.yml. Example:
   ```yaml
   name: "Alex Example"
   contact:
     location: "Example City"
     email: "<email>"
   experience:
     - role: "Senior Engineer"
       company: "ExampleCorp"
       dates:
         start: "2020-01"
         end: "2023-06"
         precision: month
       bullets:
         - "**Architected** an internal developer platform"
         - "~Led~ delivery across several product teams"
   skills:
     - "TypeScript"
     - "Node.js"
   ```
   Or different structure?

2. **Template engine choice**:
   - **Handlebars** (lightweight, good template syntax, npm package `handlebars`)?
   - **Nunjucks** (Mozilla's, more powerful)?
   - **EJS** (embedded, simpler)?
   - **Other**?
   - Recommendation?

3. **Markdown parsing in YAML**: How to convert `\*\*bold\*\*` to `<strong>bold</strong>` in HTML?
   - Parse markdown markers during template render?
   - Pre-process YAML to convert markers?
   - Use a markdown library (marked, markdown-it)?

4. **HTML→PDF library**:
   - **Puppeteer** (headless browser, high-quality output, slower)?
   - **wkhtmltopdf** (lighter weight, faster, less polished output)?
   - **PDFKit** (generate PDF from scratch in Node)?
   - **Other**?
   - Recommendation?

5. **Template file location**: Where should the HTML template live?
   - `/candidate/templates/resume.html`?
   - `/tools/templates/resume.html`?
   - Built-in / configurable?

6. **Styling**: How to style the HTML (CSS)?
   - Inline CSS in template?
   - External CSS file?
   - Tailwind classes (if using Puppeteer)?

7. **Future templates**: How to support multiple resume formats (1-page, 2-page, etc.) without duplicating template logic?
   - Template variants?
   - CSS-based layout switching?

## Resolution

**CLOSED** - Resume rendering pipeline for MVP v1:

**Pipeline**: YAML → HTML (Handlebars template) → PDF (Puppeteer)

**Libraries**:
- **Template engine**: Handlebars (`handlebars` npm package)
- **HTML→PDF**: Puppeteer (`puppeteer` npm package)

**YAML structure** (finalized in ticket 002):
```yaml
name: "Alex Example"
contact:
  location: "Example City"
  email: "<email>"
experience:
  - role: "Senior Engineer"
    company: "ExampleCorp"
    dates:
      start: "2020-01"
      end: "2023-06"
      precision: month
    bullets:
      - text: "**Architected** an internal developer platform"
        emphasis: "high"
        tags: ["platform", "developer-experience"]
        evidence_ids: ["examplecorp-developer-platform-built"]
skills:
  - category: "Languages"
    items: ["TypeScript", "Python"]
```

**Markdown formatting** in YAML:
- `**text**` → `<strong>text</strong>` (bold)
- `~text~` → `<em>text</em>` (Loom's custom italic marker, never
  strikethrough)

**Template location**: `tools/templates/resume.hbs` (Handlebars template)

**Process**:
1. Load resume.yml
2. Render via Handlebars template → resume.html
3. Puppeteer: resume.html → resume.pdf

The renderer consumes the structured bullet objects from ticket 002 rather
than a second string-only resume shape. It renders presentation fields but
does not expose `evidence_ids` in the visible document. It formats structured
year/month dates into human-readable ranges.

**Future (v2+)**: Support multiple templates (1-page, 2-page, different layouts)

**Note on `blocked_by`**: this ticket only needs the artifact shape settled
in ticket 002 (the structured bullet/evidence_ids schema), not ticket 004's
tailoring-interaction details — so it stays resolved independent of 004
being reopened. Removed 004 from `blocked_by` accordingly.
