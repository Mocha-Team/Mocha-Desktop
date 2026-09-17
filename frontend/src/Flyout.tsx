import { CoffeeMark } from "./Loader";
import { folderName, formatBytes, formatSpeed, isMac, type SyncFolder, type TransferProgress } from "./lib";

function folderLabel(f: SyncFolder) {
  if (f.paused || f.status === "paused") return "Paused";
  if (f.status === "error") return "Error";
  if (f.status === "scanning") return "Scanning";
  if (f.status === "syncing") return f.pending > 0 ? `${f.pending} left` : "Syncing";
  return "Up to date";
}

export function Flyout({ folders, transfers, onOpen, onClose }: {
  folders: SyncFolder[];
  transfers: TransferProgress[];
  onOpen: () => void;
  onClose: () => void;
}) {
  const syncing = folders.filter((f) => f.status === "syncing" || f.status === "scanning");
  const errored = folders.filter((f) => f.status === "error");
  const pending = folders.reduce((n, f) => n + (f.pending || 0), 0);
  const status = errored.length > 0 ? "Attention needed" : syncing.length > 0 ? `Syncing ${pending} file${pending === 1 ? "" : "s"}` : "Up to date";
  const shownTransfers = transfers.slice(0, 4);

  return (
    <div className="flex h-full w-full flex-col bg-[var(--background)] px-4 pb-4 pt-3">
      <div className="titlebar-drag flex shrink-0 select-none items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CoffeeMark className="h-4 w-4 text-[var(--accent-gold)]" />
          <span className="font-serif text-base italic text-mocha-goldbright">mocha</span>
          <span className={`ml-1 rounded-full px-2 py-0.5 font-mono text-[10px] ${errored.length > 0 ? "bg-red-400/10 text-red-200" : syncing.length > 0 ? "bg-mocha-gold/10 text-mocha-goldbright" : "bg-white/5 text-mocha-muted"}`}>
            {status}
          </span>
        </div>
        <button onClick={onClose} aria-label="Close" style={isMac() ? { display: "none" } : undefined} className="titlebar-no-drag win-btn win-btn-close flex h-7 w-9 items-center justify-center rounded-md text-[var(--text-muted)]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="quiet-scroll mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Sync</div>
          {folders.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 font-serif text-sm italic text-mocha-muted">No folders watched.</div>
          )}
          {folders.slice(0, 3).map((f) => (
            <div key={f.path} className="mb-1.5 flex items-center gap-2 rounded-2xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{folderName(f.path)}</div>
                <div className="truncate font-mono text-[10px] text-mocha-muted">{f.path}</div>
              </div>
              <span className={`shrink-0 font-mono text-[10px] ${f.status === "error" ? "text-red-300" : f.status === "idle" ? "text-mocha-muted" : "text-mocha-gold"}`}>
                {folderLabel(f)}
              </span>
            </div>
          ))}
          {folders.length > 3 && (
            <div className="font-mono text-[10px] text-mocha-dim">+ {folders.length - 3} more</div>
          )}
        </div>

        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Activity</div>
          {shownTransfers.length === 0 && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 font-serif text-sm italic text-mocha-muted">All caught up.</div>
          )}
          {shownTransfers.map((t) => (
            <div key={t.jobId} className="mb-1.5 rounded-2xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px]">{t.fileName || t.jobId.slice(0, 8)}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-mocha-gold">{Math.round(t.percent || 0)}%</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-mocha-gold transition-all duration-300" style={{ width: `${Math.min(100, t.percent || 0)}%` }} />
              </div>
              <div className="mt-1 font-mono text-[10px] text-mocha-muted">
                {t.status}{t.total ? ` · ${formatBytes(t.loaded)} / ${formatBytes(t.total)}` : ""}{t.speedBps ? ` · ${formatSpeed(t.speedBps)}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onOpen} className="glass-button btn-gold mt-3 flex w-full shrink-0 items-center justify-center rounded-full py-2 text-sm font-semibold active:scale-[0.98]">
        Open app
      </button>
    </div>
  );
}
