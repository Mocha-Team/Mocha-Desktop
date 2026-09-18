import { useState } from "react";
import { ModalShell } from "./ModalShell";
import { api, copyText, type FileItem } from "../lib";

const EXPIRATION_OPTIONS = [
  { label: "1 hour", value: "1" },
  { label: "6 hours", value: "6" },
  { label: "24 hours", value: "24" },
  { label: "7 days", value: "168" },
  { label: "30 days", value: "720" },
  { label: "Permanent", value: "never" },
];

export function ShareModal({ file, appUrl, onClose, onCreated }: {
  file: FileItem;
  appUrl: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [expires, setExpires] = useState("24");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const sh = await api.createShare(file.id, expires === "never" ? null : Number(expires), maxDownloads ? Number(maxDownloads) : null, password);
      onCreated();
      setShareUrl(`${appUrl}/share/${sh.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Share failed");
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    const ok = await copyText(shareUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  function reset() {
    setShareUrl(null);
    setCopied(false);
    setPassword("");
    setMaxDownloads("");
    setExpires("24");
    setError(null);
  }

  return (
    <ModalShell label={`Share ${file.original_name}`} shellClassName="w-full max-w-sm" onClose={onClose}>
      {(close) => (
        <div className="bezel-core space-y-3 p-4">
          <div className="rise-in truncate font-serif text-lg italic">{shareUrl ? "Share link created" : "Share file"}</div>
          {!shareUrl ? (
            <>
              <p className="rise-in truncate font-mono text-[11px] text-mocha-muted" style={{ animationDelay: "60ms" }}>{file.original_name}</p>
              <div className="rise-in" style={{ animationDelay: "110ms" }}>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Expiration</label>
                <select value={expires} onChange={(e) => setExpires(e.target.value)} className="field w-full rounded-2xl px-4 py-2.5 text-sm">
                  {EXPIRATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="rise-in" style={{ animationDelay: "160ms" }}>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Max downloads</label>
                <input type="number" min="1" value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} placeholder="Unlimited" className="field w-full rounded-2xl px-4 py-3 text-sm" />
              </div>
              <div className="rise-in" style={{ animationDelay: "210ms" }}>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="No password" className="field w-full rounded-2xl px-4 py-3 text-sm" />
              </div>
              {error && <div className="notice-in rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-2.5 font-mono text-xs text-red-200">{error}</div>}
              <div className="rise-in flex gap-2" style={{ animationDelay: "260ms" }}>
                <button onClick={() => void create()} disabled={creating} className="glass-button btn-gold flex-1 rounded-full py-2 text-sm font-semibold disabled:opacity-60">{creating ? "Creating" : "Create link"}</button>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div className="rise-in break-all rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs" style={{ animationDelay: "60ms" }}>{shareUrl}</div>
              <div className="rise-in flex gap-2" style={{ animationDelay: "120ms" }}>
                <button onClick={() => void copyLink()} className="glass-button btn-gold flex-1 rounded-full py-2 text-sm font-semibold">{copied ? "Copied" : "Copy link"}</button>
                <button onClick={reset} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">New link</button>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">Done</button>
              </div>
            </>
          )}
        </div>
      )}
    </ModalShell>
  );
}
