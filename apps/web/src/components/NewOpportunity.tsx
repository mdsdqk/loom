import { useEffect, useRef, useState } from "react";
import type { MasterResume } from "../api";

/**
 * Creating an opportunity produces exactly what the CLI produces:
 * `opportunities/<slug>/meta.yml` plus `artifacts/{jd.md,resume.yml}`. Company
 * and role are read out of the JD where it labels them, and asked for when it
 * does not.
 */
export function NewOpportunity({
  open,
  resumes,
  busy,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  resumes: MasterResume[];
  busy: boolean;
  error?: string;
  onClose: () => void;
  onCreate: (input: {
    jd: string;
    masterResumePath: string;
    company?: string;
    role?: string;
    jobId?: string;
  }) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [jd, setJd] = useState("");
  const [masterResumePath, setMasterResumePath] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jobId, setJobId] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    /* Clear on close so the next "New opportunity" starts empty rather than
       pre-filled with whatever was just created. */
    if (!open) {
      setJd("");
      setCompany("");
      setRole("");
      setJobId("");
    }
  }, [open]);

  useEffect(() => {
    if (resumes.length > 0 && !masterResumePath) setMasterResumePath(resumes[0].path);
  }, [resumes, masterResumePath]);

  const field =
    "w-full bg-ground border border-rule px-2.5 py-2 text-[13px] text-ink " +
    "focus:border-ink-3 focus:outline-none placeholder:text-mark";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(760px,92vw)] border border-rule-strong bg-ground-2 p-0 text-ink backdrop:bg-black/70"
    >
      <form
        method="dialog"
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            jd,
            masterResumePath,
            company: company.trim() || undefined,
            role: role.trim() || undefined,
            jobId: jobId.trim() || undefined,
          });
        }}
      >
        <header className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h2 className="text-[15px] font-medium tracking-[-0.01em]">New opportunity</h2>
          <button
            type="button"
            onClick={onClose}
            className="caps cursor-pointer border border-rule px-2.5 py-1.5 text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          <label className="block">
            <span className="caps mb-1.5 block text-ink-4">Job description</span>
            <textarea
              className={`${field} min-h-[180px] resize-y font-mono text-[12.5px] leading-relaxed`}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder={"Paste the JD as markdown.\n\nCompany: …\nTitle: …"}
              required
            />
            <span className="mt-1.5 block text-[12px] text-ink-4">
              Company and title are read from labeled lines or the first heading. Fill these in
              when the posting doesn&apos;t carry them.
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="caps mb-1.5 block text-ink-4">Company</span>
              <input
                className={field}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="optional"
              />
            </label>
            <label className="block">
              <span className="caps mb-1.5 block text-ink-4">Role</span>
              <input
                className={field}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="optional"
              />
            </label>
            <label className="block">
              <span className="caps mb-1.5 block text-ink-4">Job ID</span>
              <input
                className={field}
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                placeholder="optional"
              />
            </label>
          </div>

          <label className="block">
            <span className="caps mb-1.5 block text-ink-4">Master resume</span>
            <select
              className={field}
              value={masterResumePath}
              onChange={(e) => setMasterResumePath(e.target.value)}
              required
            >
              {resumes.length === 0 && <option value="">No master resume found</option>}
              {resumes.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="text-[12.5px] text-oxide">{error}</p>}
        </div>

        <footer className="flex items-center gap-3 border-t border-rule px-5 py-3">
          <button
            type="submit"
            disabled={busy || !jd.trim() || !masterResumePath}
            className="caps cursor-pointer border border-rule-strong px-3 py-2 text-ink transition-colors hover:border-ink-3 hover:bg-ground-3 disabled:cursor-not-allowed disabled:text-ink-4"
          >
            {busy ? "Creating…" : "Create"}
          </button>
          <span className="text-[12px] text-ink-4">
            Writes opportunities/&lt;slug&gt;/ with meta.yml and artifacts.
          </span>
        </footer>
      </form>
    </dialog>
  );
}
