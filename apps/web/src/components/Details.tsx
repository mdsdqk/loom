import { useState } from "react";
import { SOURCES, type Opportunity, type Referral, type Source } from "@loom/tools/opportunity/pure";
import type { MetaPatch } from "../api";

/**
 * The opportunity's own fields, as opposed to its history.
 *
 * Source was previously fixed at creation and only ever read. A posting found
 * through the network scan that turns out to have a referrer behind it has to be
 * correctable, and a referral is only useful if it records who.
 */

const FIELD =
  "w-full bg-ground border border-rule px-2 py-1.5 text-[13px] text-ink " +
  "focus:border-ink-3 focus:outline-none placeholder:text-mark";

const BTN =
  "caps cursor-pointer border border-rule-strong px-3 py-2 text-ink transition-colors " +
  "hover:border-ink-3 hover:bg-ground-3 disabled:cursor-not-allowed disabled:text-ink-4";

const MINI =
  "caps cursor-pointer border border-rule px-2 py-1 text-ink-3 transition-colors " +
  "hover:border-ink-3 hover:text-ink";

export function Details({
  opportunity,
  busy,
  error,
  onSave,
}: {
  opportunity: Opportunity;
  busy: boolean;
  error?: string;
  onSave: (patch: MetaPatch) => void;
}) {
  const [editing, setEditing] = useState(false);
  const meta = opportunity.meta;

  if (!editing) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule pb-4">
        <Fact label="Source" value={meta.source ?? "manual"} />
        {meta.source === "referral" && (
          <Fact
            label="Referred by"
            value={meta.referral?.name ?? "not recorded"}
            dim={!meta.referral}
            title={[meta.referral?.position, meta.referral?.note].filter(Boolean).join(" · ")}
          />
        )}
        {meta.job_id && <Fact label="Job ID" value={meta.job_id} />}
        {meta.posted_date && <Fact label="Posted" value={meta.posted_date} />}
        {meta.url && (
          <a
            href={meta.url}
            target="_blank"
            rel="noreferrer"
            className="caps text-ink-3 underline underline-offset-2 hover:text-ink"
          >
            Posting
          </a>
        )}
        <span className="flex-1" />
        <button type="button" className={MINI} onClick={() => setEditing(true)}>
          Edit details
        </button>
      </div>
    );
  }

  return (
    <DetailsForm
      opportunity={opportunity}
      busy={busy}
      error={error}
      onCancel={() => setEditing(false)}
      onSave={(patch) => {
        onSave(patch);
        setEditing(false);
      }}
    />
  );
}

function Fact({
  label,
  value,
  dim,
  title,
}: {
  label: string;
  value: string;
  dim?: boolean;
  title?: string;
}) {
  return (
    <span className="flex items-baseline gap-2" title={title || undefined}>
      <span className="caps text-ink-4">{label}</span>
      <span className={`text-[13px] ${dim ? "text-mark" : "text-ink-2"}`}>{value}</span>
    </span>
  );
}

function DetailsForm({
  opportunity,
  busy,
  error,
  onSave,
  onCancel,
}: {
  opportunity: Opportunity;
  busy: boolean;
  error?: string;
  onSave: (patch: MetaPatch) => void;
  onCancel: () => void;
}) {
  const meta = opportunity.meta;
  const [company, setCompany] = useState(meta.company);
  const [role, setRole] = useState(meta.role);
  const [source, setSource] = useState<Source>(meta.source ?? "manual");
  const [url, setUrl] = useState(meta.url ?? "");
  const [jobId, setJobId] = useState(meta.job_id ?? "");
  const [posted, setPosted] = useState(meta.posted_date ?? "");
  const [refName, setRefName] = useState(meta.referral?.name ?? "");
  const [refPosition, setRefPosition] = useState(meta.referral?.position ?? "");
  const [refLink, setRefLink] = useState(meta.referral?.linkedin_url ?? "");
  const [refNote, setRefNote] = useState(meta.referral?.note ?? "");

  const referred = source === "referral";

  const save = () => {
    const referral: Referral | null = referred && refName.trim()
      ? {
          name: refName.trim(),
          ...(refPosition.trim() ? { position: refPosition.trim() } : {}),
          ...(refLink.trim() ? { linkedin_url: refLink.trim() } : {}),
          ...(refNote.trim() ? { note: refNote.trim() } : {}),
        }
      : null;

    onSave({
      company: company.trim(),
      role: role.trim(),
      source,
      referral,
      url: url.trim() || null,
      job_id: jobId.trim() || null,
      posted_date: posted.trim() || null,
    });
  };

  return (
    <div className="mb-5 border-b border-rule pb-5">
      <h3 className="caps mb-3 border-b border-rule pb-2 text-ink-3">Details</h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label="Company">
          <input className={FIELD} value={company} onChange={(e) => setCompany(e.target.value)} />
        </Labelled>
        <Labelled label="Role">
          <input className={FIELD} value={role} onChange={(e) => setRole(e.target.value)} />
        </Labelled>
        <Labelled label="Source">
          <select
            className={FIELD}
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Job ID">
          <input
            className={FIELD}
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="optional"
          />
        </Labelled>
        <Labelled label="Posted">
          <input
            className={FIELD}
            value={posted}
            onChange={(e) => setPosted(e.target.value)}
            placeholder="2026-08-14"
          />
        </Labelled>
        <Labelled label="Posting URL">
          <input
            className={FIELD}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="optional"
          />
        </Labelled>
      </div>

      {referred && (
        <div className="mt-4 border-l border-oxide/40 pl-4">
          <span className="caps mb-2 block text-oxide">Referred by</span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Labelled label="Name">
              <input className={FIELD} value={refName} onChange={(e) => setRefName(e.target.value)} />
            </Labelled>
            <Labelled label="Position">
              <input
                className={FIELD}
                value={refPosition}
                onChange={(e) => setRefPosition(e.target.value)}
                placeholder="optional"
              />
            </Labelled>
            <Labelled label="Profile">
              <input
                className={FIELD}
                value={refLink}
                onChange={(e) => setRefLink(e.target.value)}
                placeholder="optional"
              />
            </Labelled>
            <Labelled label="Note">
              <input
                className={FIELD}
                value={refNote}
                onChange={(e) => setRefNote(e.target.value)}
                placeholder="how the ask went"
              />
            </Labelled>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-[12.5px] text-oxide">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className={BTN}
          disabled={busy || !company.trim() || !role.trim()}
          onClick={save}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={MINI} onClick={onCancel}>
          Cancel
        </button>
        <span className="text-[12px] text-ink-4">
          The directory name does not change; only what is inside meta.yml.
        </span>
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caps mb-1 block text-ink-4">{label}</span>
      {children}
    </label>
  );
}
