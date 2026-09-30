/**
 * Package entry point.
 *
 * Consumers (the web portal, the CLIs, a future MCP server) import from here or
 * from a subpath rather than reaching into `dist/`.
 */

export * from "./opportunity/index.js";
export {
  ResumeSchema,
  validateResume,
  type Resume,
  type ResumeValidationIssue,
  type ResumeValidationResult,
} from "./resume/schema.js";
export {
  createOpportunity,
  buildSlug,
  slugify,
  extractCompanyAndTitle,
  extractJobId,
  extractPostingDate,
  normalizeDate,
  type CreateOpportunityOptions,
  type CreateOpportunityResult,
} from "./resume/opportunity.js";
