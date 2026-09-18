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
    <div className="reveal-fade is-visible mt-4 shrink-0 rounded-2xl border border-mocha-gold/20 bg-mocha-gold/10 px-4 py-2.5 text-[13px] text-mocha-goldbright">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Mocha {info.version} is available</span>
        <span className="flex gap-2">
          <button onClick={onUpdate} disabled={busy} className="glass-button btn-gold rounded-full px-4 py-1.5 text-xs font-semibold disabled:opacity-60">{busy ? "Updating" : "Update"}</button>
          <button onClick={onDismiss} className="glass-button btn-ghost rounded-full px-4 py-1.5 text-xs">Later</button>
        </span>
      </div>
      {info.notes && <div className="mt-1 text-mocha-secondary">{info.notes}</div>}
      {progress !== null && <div className="mt-1 font-mono text-[11px] text-mocha-muted">{progress}%</div>}
      {error && (
        <div className="mt-1">
          <span>{error}</span>
          <a href={manualUrl} target="_blank" rel="noreferrer" className="ml-2 underline">Download manually</a>
        </div>
      )}
    </div>
  );
}
