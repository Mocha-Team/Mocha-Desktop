import { formatBytes, formatSpeed, type TransferProgress } from "../lib";

export function TransferRow({ t, onCancel }: { t: TransferProgress; onCancel: (jobId: string) => void }) {
  const finished = t.status === "done" || t.status === "error" || t.status === "cancelled";
  return (
    <div className="card-hover rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <span className="truncate text-sm font-medium">{t.fileName || t.jobId.slice(0, 8)}</span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-mocha-muted">
          {t.status} {t.total ? `${Math.round(t.percent)}%` : ""} {t.speedBps ? "· " + formatSpeed(t.speedBps) : ""}
          {!finished && (
            <button onClick={() => onCancel(t.jobId)} className="rounded-full px-2 py-0.5 text-red-300 hover:text-red-200">Cancel</button>
          )}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/5 progress-sheen">
        <div className="h-full rounded-full bg-mocha-gold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${Math.min(100, t.percent || 0)}%` }} />
      </div>
      {t.error && <div className="notice-in mt-2 font-mono text-[11px] text-red-300">{t.error}</div>}
      {!t.total && t.status !== "done" && <div className="mt-1.5 font-mono text-[11px] text-mocha-muted">{formatBytes(t.loaded)}</div>}
    </div>
  );
}

export function TransferPanel({ transfers, onCancel }: { transfers: TransferProgress[]; onCancel: (jobId: string) => void }) {
  return (
    <div className="quiet-scroll mt-3 min-h-0 flex-1 space-y-2 pr-0.5">
      {transfers.length === 0 ? (
        <div className="empty-in font-serif text-sm italic text-mocha-muted">No active transfers.</div>
      ) : (
        transfers.map((t, i) => <div key={t.jobId} style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }} className="file-row-in"><TransferRow t={t} onCancel={onCancel} /></div>)
      )}
    </div>
  );
}
