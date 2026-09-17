import { WindowMinimise, WindowToggleMaximise } from "../wailsjs/runtime/runtime";
import { api, isMac } from "./lib";
import { CoffeeMark } from "./Loader";

function MinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Titlebar() {
  // ponytail: native AppKit bar owns drag + zoom on mac, no web chrome needed
  if (isMac()) return null;
  return (
    <div className="titlebar-drag fixed inset-x-0 top-0 z-40 flex h-9 select-none items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface)] px-2.5">
      <div className="flex items-center gap-1.5 text-[var(--accent-gold)]">
        <CoffeeMark className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-primary)]">Mocha Desktop</span>
      </div>
      <div className="titlebar-no-drag flex items-center gap-0.5">
        <button onClick={() => WindowMinimise()} aria-label="Minimize" className="win-btn flex h-7 w-9 items-center justify-center rounded-md text-[var(--text-muted)]">
          <MinIcon />
        </button>
        <button onClick={() => WindowToggleMaximise()} aria-label="Maximize" className="win-btn flex h-7 w-9 items-center justify-center rounded-md text-[var(--text-muted)]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        </button>
        <button onClick={() => void api.closeWindow()} aria-label="Close" className="win-btn win-btn-close flex h-7 w-9 items-center justify-center rounded-md text-[var(--text-muted)]">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
