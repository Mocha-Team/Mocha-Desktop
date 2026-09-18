import type { UpdateCheck } from "../lib";

interface Props {
  info: UpdateCheck;
  progress: number | null;
  error: string | null;
  busy: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ info, progress, error, busy, onUpdate, onDismiss }: Props) {
  const manualUrl = info.asset ? info.asset.url : "https://github.com/Mocha-Team/Mocha-Desktop/releases/latest";
  return (
    <div className="toast-in mt-4 shrink-0 rounded-2xl border border-white/10 bg-black/70 px-4 py-2.5 text-[13px] backdrop-blur-3xl" style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.06)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mocha-secondary shadow-[0_0_8px_rgba(184,174,161,0.45)]" />
          <span>Mocha {info.version} is available</span>
        </span>
        <span className="flex gap-2">
          <button onClick={onUpdate} disabled={busy} className="glass-button btn-bone rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-60">{busy ? "Updating" : "Update"}</button>
          <button onClick={onDismiss} className="glass-button btn-ghost rounded-full px-4 py-1.5 text-xs">Later</button>
        </span>
      </div>
      {info.notes && <div className="mt-1 text-mocha-secondary">{info.notes}</div>}
      {progress !== null && <div className="mt-1 font-mono text-[11px] text-mocha-muted">{progress}%</div>}
      {error && (
        <div className="mt-1 text-[#f0c8c0]">
          <span>{error}</span>
          <a href={manualUrl} target="_blank" rel="noreferrer" className="ml-2 underline decoration-white/30 underline-offset-2">Download manually</a>
        </div>
      )}
    </div>
  );
}
