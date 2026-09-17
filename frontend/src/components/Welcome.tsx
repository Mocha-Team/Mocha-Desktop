import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import { WelcomeGlobe } from "./NetworkGlobe";

interface WelcomeProps {
  apiKey: string;
  onApiKey: (v: string) => void;
  busy: boolean;
  notice: string | null;
  onConnect: (e: React.FormEvent) => void;
}

function StepArrow({ flip = false }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function Welcome({ apiKey, onApiKey, busy, notice, onConnect }: WelcomeProps) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const total = 2;

  const keyValid = apiKey.trim().startsWith("mocha_") && apiKey.trim().length > 8;

  const go = useCallback((next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(Math.min(total - 1, Math.max(0, next)));
  }, [step, total]);

  const next = useCallback(() => {
    go(1);
  }, [go]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 420);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" && step < total - 1 && !busy) next();
      if (e.key === "ArrowLeft" && step > 0 && !busy) go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, busy, next, go, total]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < total - 1) {
      next();
      return;
    }
    onConnect(e);
  };

  const globeScale = step === 0 ? 1 : 0.92;
  const globeOpacity = step === 0 ? 1 : 0.92;

  return (
    <div className="quiet-scroll mx-auto flex h-full w-full max-w-5xl items-center px-2 pb-10 pt-6">
      <div className="grid w-full items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        <div className="relative order-1 mx-auto w-full max-w-[520px]">
          <div
            className="transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{ transform: `scale(${globeScale})`, opacity: globeOpacity }}
          >
            <WelcomeGlobe />
          </div>
          <div className="pointer-events-none absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-[11px] text-mocha-muted backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mocha-gold opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mocha-gold" />
            </span>
            live network preview, drag to explore
          </div>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-mocha-gold/10 blur-[90px]" />
        </div>

        <div className="order-2 w-full">
          <div className="mb-5 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mocha-muted">
              {String(step + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
            </span>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: total }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => go(i)}
                  aria-label={`Go to step ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${i === step ? "w-7 bg-mocha-gold" : i < step ? "w-3 bg-mocha-gold/60 hover:bg-mocha-gold" : "w-3 bg-white/10 hover:bg-white/20"}`}
                />
              ))}
            </div>
          </div>

          <div className="mb-6 h-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-mocha-gold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{ width: `${((step + 1) / total) * 100}%` }}
            />
          </div>

          <form onSubmit={submit} className="flex flex-col">
            <div key={step} className={`${dir >= 0 ? "welcome-step welcome-from-right" : "welcome-step welcome-from-left"} min-h-[310px]`}>
              {step === 0 && (
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mocha-muted">Mocha Desktop</span>
                  <h1 className="mt-4 font-ui text-4xl font-semibold leading-[1.05] tracking-tight text-mocha-primary">
                    Your files,
                    <br />
                    <span className="font-serif italic text-mocha-goldbright">machined</span> for desktop.
                  </h1>
                  <p className="mt-4 max-w-md text-[13px] leading-relaxed text-mocha-secondary">
                    One key connects this app to your vault on mocha.my.
                  </p>
                </div>
              )}

              {step === 1 && (
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mocha-muted">Step 01, access</span>
                  <h2 className="mt-4 font-ui text-3xl font-semibold leading-[1.1] tracking-tight text-mocha-primary">
                    What is your <span className="font-serif italic text-mocha-goldbright">API key</span>?
                  </h2>
                  <p className="mt-3 max-w-md text-[13px] leading-relaxed text-mocha-secondary">
                    Mint a key in the web dashboard under API Keys. It never leaves your keychain except to sign requests.
                  </p>
                  <label className="mt-6 block">
                    <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">API key</span>
                    <div className="relative">
                      <input
                        ref={inputRef}
                        value={apiKey}
                        onChange={(e) => onApiKey(e.target.value)}
                        placeholder="mocha_..."
                        type={showKey ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        className="field w-full rounded-2xl py-3 pl-4 pr-16 font-mono text-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-muted transition-colors duration-300 hover:text-mocha-primary"
                      >
                        {showKey ? "Hide" : "Show"}
                      </button>
                    </div>
                  </label>
                  <div className="mt-3 min-h-[44px]">
                    {!keyValid && apiKey.length > 0 && (
                      <div className="welcome-error rounded-2xl border border-red-400/20 bg-red-400/5 px-4 py-2.5 font-mono text-[11px] text-red-200">
                        Key must start with mocha_
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-mocha-muted">
                    <span>No key yet?</span>
                    <button
                      type="button"
                      onClick={() => BrowserOpenURL("https://mocha.my/api-keys")}
                      className="text-mocha-goldbright underline decoration-mocha-gold/40 underline-offset-4 transition-colors duration-300 hover:text-mocha-gold"
                    >
                      Get one at mocha.my/api-keys
                    </button>
                  </div>
                </div>
              )}
            </div>

            {notice && (
              <div className="welcome-error mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-mocha-secondary">
                {notice}
              </div>
            )}

            <div className="mt-7 flex shrink-0 items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => go(step - 1)}
                disabled={step === 0 || busy}
                aria-label="Previous step"
                className="glass-button btn-ghost flex h-11 w-11 items-center justify-center rounded-full text-mocha-secondary transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-mocha-primary disabled:cursor-default disabled:opacity-30"
              >
                <StepArrow flip />
              </button>

              <div className="w-16 text-center font-mono text-[11px] text-mocha-dim">
                {step === 0 ? "start" : "access"}
              </div>

              <button
                type={step < total - 1 ? "button" : "submit"}
                onClick={step < total - 1 ? next : undefined}
                disabled={busy || (step === total - 1 && !keyValid)}
                className="glass-button btn-gold group flex min-w-[184px] items-center justify-between gap-3 rounded-full py-1.5 pl-6 pr-1.5 text-sm font-semibold transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:opacity-40"
              >
                <span>{step < total - 1 ? "Begin setup" : busy ? "Connecting" : "Connect Mocha"}</span>
                <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 ${busy && step === total - 1 ? "animate-pulse" : ""}`}>
                  <StepArrow />
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
