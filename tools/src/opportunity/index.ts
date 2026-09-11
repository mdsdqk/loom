/**
 * Opportunity store and schema.
 *
 * `createOpportunity` deliberately stays in `resume/opportunity.ts`: it is the
 * resume-artifact tool's entry point and already owns slugging, JD parsing and
 * directory creation. This module owns what happens to an opportunity after it
 * exists.
 */

export {
  STATUSES,
  StatusSchema,
  OUTCOMES,
  OutcomeSchema,
  SOURCES,
  SourceSchema,
  LOOPABLE_STATUSES,
  TERMINAL_STATUSES,
  StatusEventSchema,
  ReferralSchema,
  EventStateSchema,
  EVENT_STATES,
  OpportunityMetaSchema,
  isLoopable,
  isRecorded,
  isScheduled,
  isPending,
  isAhead,
  sortHistory,
  renumberRounds,
  normalizeHistory,
  statusIndex,
  isChronological,
  roundsAt,
  nextRound,
  validateMeta,
  type Status,
  type Outcome,
  type Source,
  type StatusEvent,
  type Referral,
  type EventState,
  type OpportunityMeta,
  type MetaValidationIssue,
  type MetaValidationResult,
  type ArtifactPresence,
  type Opportunity,
} from "./schema.js";

export {
  CONFIG_FILE_ENV,
  DEFAULT_CONFIG_FILE,
  DEFAULT_STALL_THRESHOLD_DAYS,
  DEFAULT_NEVER_STALL,
  DEFAULT_CONFIG,
  LoomConfigSchema,
  stallThresholdFor,
  type LoomConfig,
} from "./config.js";

export { loadConfig, resolveConfigPath } from "./config-file.js";

export {
  OPPORTUNITIES_DIR_ENV,
  DEFAULT_OPPORTUNITIES_DIR,
  resolveOpportunitiesRoot,
  assertSafeSlug,
  opportunityPaths,
  EventConflictError,
  readOpportunity,
  listOpportunities,
  writeMeta,
  updateMeta,
  appendStatus,
  updateEvent,
  removeEvent,
  currentEvent,
  currentStatus,
  currentRound,
  rounds,
  recordedEvents,
  lastRecorded,
  currentIsAhead,
  scheduledEvents,
  pendingEvents,
  openEvents,
  nextScheduled,
  nextAction,
  awaitingCandidate,
  idleDays,
  isStalled,
  type OpportunityPaths,
  type AppendStatusInput,
  type MetaPatch,
  type UpdateEventInput,
  type EventExpectation,
} from "./store.js";
