import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { z } from "zod";
import {
  StatusSchema,
  OutcomeSchema,
  EventStateSchema,
  SourceSchema,
  ReferralSchema,
  appendStatus,
  createOpportunity,
  listOpportunities,
  loadConfig,
  readOpportunity,
  removeEvent,
  resolveOpportunitiesRoot,
  updateEvent,
  updateMeta,
  writeMeta,
  EventConflictError,
} from "@loom/tools";

/**
 * Local API for the opportunity portal.
 *
 * Transport only: every read and write goes through `@loom/tools`, so the CLIs,
 * this server and a future MCP server share one implementation and one set of
 * invariants. Nothing here knows how a status is stored.
 */

const PORT = Number(process.env.LOOM_API_PORT ?? 8787);

/**
 * Both roots are resolvable so one checkout can serve any candidate. The
 * defaults are relative to this app, not to `tools/`, whose own default
 * assumes the CLI's working directory.
 */
const OPPORTUNITIES_ROOT = resolveOpportunitiesRoot(
  process.env.LOOM_OPPORTUNITIES_DIR ?? "../../opportunities"
);
const CANDIDATE_ROOT = resolve(process.env.LOOM_CANDIDATE_DIR ?? "../../candidate");
const CONFIG_PATH = process.env.LOOM_CONFIG_FILE ?? resolve("../../loom.config.yml");

const app = new Hono();

const fail = (message: string) => ({ error: message }) as const;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A bad slug is the caller's fault, not a missing opportunity. */
const isBadRequest = (error: unknown) =>
  error instanceof Error && /slug/i.test(error.message);

app.get("/api/config", async (c) => c.json(await loadConfig(CONFIG_PATH)));

app.get("/api/opportunities", async (c) => {
  const [{ opportunities, failures }, config] = await Promise.all([
    listOpportunities(OPPORTUNITIES_ROOT),
    loadConfig(CONFIG_PATH),
  ]);
  return c.json({ opportunities, failures, config });
});

app.get("/api/opportunities/:slug", async (c) => {
  try {
    return c.json(await readOpportunity(c.req.param("slug"), OPPORTUNITIES_ROOT));
  } catch (error) {
    if (isBadRequest(error)) return c.json(fail(message(error)), 400);
    /* Only an absent file is a 404. Unreadable or malformed is not the same
       thing as missing, and reporting it as missing hides the real problem. */
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.json(fail(message(error)), 404);
    return c.json(fail(message(error)), 422);
  }
});

/** `null` clears a field; omitted leaves it alone. */
const MetaPatchBody = z.object({
  company: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  source: SourceSchema.nullable().optional(),
  referral: ReferralSchema.nullable().optional(),
  url: z.string().trim().min(1).nullable().optional(),
  job_id: z.string().trim().min(1).nullable().optional(),
  posted_date: z.string().trim().min(1).nullable().optional(),
});

app.patch("/api/opportunities/:slug", async (c) => {
  const parsed = MetaPatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail(parsed.error.issues.map((i) => i.message).join("; ")), 400);
  }
  try {
    return c.json(await updateMeta(c.req.param("slug"), parsed.data, OPPORTUNITIES_ROOT));
  } catch (error) {
    return c.json(fail(message(error)), 400);
  }
});

const AppendStatusBody = z.object({
  status: StatusSchema,
  note: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  outcome: OutcomeSchema.optional(),
  /** Backdate the entry; omitted means now. */
  at: z.string().min(1).optional(),
  state: EventStateSchema.optional(),
  /** Freeform on purpose — real ETAs are ranges and conditions, not timestamps. */
  eta: z.string().trim().min(1).optional(),
});

/**
 * What the client believed it was addressing. History is addressed by position,
 * and a concurrent write re-sorts the list, so without this a stale index edits
 * whatever entry happens to sit there now.
 */
const ExpectBody = z.object({
  expect_at: z.string().min(1).optional(),
  expect_status: StatusSchema.optional(),
});

/** `null` clears a field; omitted leaves it alone. */
const UpdateEventBody = ExpectBody.extend({
  status: StatusSchema.optional(),
  at: z.string().min(1).optional(),
  state: EventStateSchema.optional(),
  label: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().min(1).nullable().optional(),
  eta: z.string().trim().min(1).nullable().optional(),
  outcome: OutcomeSchema.nullable().optional(),
  round: z.number().int().positive().nullable().optional(),
});

app.post("/api/opportunities/:slug/status", async (c) => {
  const parsed = AppendStatusBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail(parsed.error.issues.map((i) => i.message).join("; ")), 400);
  }
  try {
    const updated = await appendStatus(c.req.param("slug"), parsed.data, OPPORTUNITIES_ROOT);
    return c.json(updated);
  } catch (error) {
    return c.json(fail(message(error)), 400);
  }
});

app.patch("/api/opportunities/:slug/history/:index", async (c) => {
  const index = Number(c.req.param("index"));
  const parsed = UpdateEventBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail(parsed.error.issues.map((i) => i.message).join("; ")), 400);
  }
  const { expect_at, expect_status, ...patch } = parsed.data;
  try {
    const updated = await updateEvent(
      c.req.param("slug"),
      index,
      patch,
      OPPORTUNITIES_ROOT,
      { at: expect_at, status: expect_status }
    );
    return c.json(updated);
  } catch (error) {
    if (error instanceof EventConflictError) return c.json(fail(message(error)), 409);
    return c.json(fail(message(error)), 400);
  }
});

app.delete("/api/opportunities/:slug/history/:index", async (c) => {
  const index = Number(c.req.param("index"));
  const parsed = ExpectBody.safeParse(await c.req.json().catch(() => ({})));
  const expect = parsed.success
    ? { at: parsed.data.expect_at, status: parsed.data.expect_status }
    : undefined;
  try {
    return c.json(await removeEvent(c.req.param("slug"), index, OPPORTUNITIES_ROOT, expect));
  } catch (error) {
    if (error instanceof EventConflictError) return c.json(fail(message(error)), 409);
    return c.json(fail(message(error)), 400);
  }
});

/**
 * Master resumes the candidate can tailor from. Read from the candidate root
 * rather than listed anywhere in code, so this works for whoever owns the
 * checkout.
 */
app.get("/api/master-resumes", async (c) => {
  try {
    const entries = await readdir(CANDIDATE_ROOT, { withFileTypes: true });
    const resumes = entries
      .filter((e) => e.isFile() && /^resume.*\.yml$/i.test(e.name))
      .map((e) => ({ name: e.name, path: join(CANDIDATE_ROOT, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ resumes });
  } catch {
    return c.json({ resumes: [] });
  }
});

const CreateBody = z.object({
  jd: z.string().trim().min(1, "a job description is required"),
  masterResumePath: z.string().trim().min(1, "pick a master resume"),
  company: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  jobId: z.string().trim().min(1).optional(),
  postedDate: z.string().trim().min(1).optional(),
});

/**
 * Creates the same directory layout the CLI produces —
 * `opportunities/<slug>/{meta.yml,artifacts/{jd.md,resume.yml}}` — by calling
 * the CLI's own `createOpportunity`. The pasted JD is staged to a temp file
 * because that function takes paths, and the temp file is always cleaned up.
 */
app.post("/api/opportunities", async (c) => {
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail(parsed.error.issues.map((i) => i.message).join("; ")), 400);
  }
  const body = parsed.data;

  /*
   * The client only ever offers names this server listed, but the endpoint is
   * reachable directly. Without this check any readable file on disk could be
   * named here and would be copied into the new opportunity.
   */
  const masterResumePath = resolve(body.masterResumePath);
  const withinCandidate = relative(CANDIDATE_ROOT, masterResumePath);
  if (withinCandidate.startsWith("..") || isAbsolute(withinCandidate)) {
    return c.json(fail("masterResumePath must be inside the candidate directory"), 400);
  }

  const staging = await mkdtemp(join(tmpdir(), "loom-jd-"));
  const jdPath = join(staging, "jd.md");
  try {
    await writeFile(jdPath, body.jd, "utf8");
    const created = await createOpportunity({
      masterResumePath,
      jdPath,
      opportunitiesRoot: OPPORTUNITIES_ROOT,
      company: body.company,
      role: body.role,
      jobId: body.jobId,
      postedDate: body.postedDate,
    });

    // `createOpportunity` writes no history, so the first read synthesizes one
    // from the directory mtime. Replace it with a single real event carrying the
    // actual creation time — appending here instead would leave two.
    const fresh = await readOpportunity(created.slug, OPPORTUNITIES_ROOT);
    const meta = {
      ...fresh.meta,
      source: "manual" as const,
      history: [
        { at: new Date().toISOString(), status: "scouted" as const, state: "recorded" as const },
      ],
    };
    await writeMeta(created.slug, meta, OPPORTUNITIES_ROOT);

    return c.json({ ...fresh, meta, created }, 201);
  } catch (error) {
    const text = message(error);
    return c.json(fail(text), text.includes("already exists") ? 409 : 400);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});

/* An unmatched API path is a 404 in JSON. Without this the SPA catch-all below
   answers it with index.html and a 200, which reads as success to any client. */
app.all("/api/*", (c) => c.json(fail("No such endpoint"), 404));

/* The built client, when running as one process rather than under Vite. */
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("/*", serveStatic({ path: "./dist/client/index.html" }));

const server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  process.stdout.write(
    `loom api on http://127.0.0.1:${info.port}\n  opportunities: ${OPPORTUNITIES_ROOT}\n  candidate:     ${CANDIDATE_ROOT}\n`
  );
});

/**
 * Without this, a taken port kills the process with no usable message and the
 * UI just shows proxy errors against a server that never started.
 */
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write(
      `loom api: port ${PORT} is already in use.\n` +
        `  Another Loom API is probably still running. Stop it, or pick another port\n` +
        `  with LOOM_API_PORT=<port> — the Vite proxy reads the same variable.\n`
    );
  } else {
    process.stderr.write(`loom api failed to start: ${error.message}\n`);
  }
  process.exit(1);
});

export { app };
