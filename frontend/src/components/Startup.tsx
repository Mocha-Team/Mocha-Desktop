import { WelcomeGlobe } from "./NetworkGlobe";

export function Startup() {
  return (
    <div className="relative flex h-[calc(100dvh-2.25rem)] w-full flex-col items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[60%] w-[60%] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-mocha-gold/10 blur-[100px]" />
      <div className="startup-enter pointer-events-none z-10 w-full max-w-[360px]">
        <WelcomeGlobe />
      </div>
      <div className="startup-enter z-10 -mt-4 flex flex-col items-center" style={{ animationDelay: "150ms" }}>
        <span className="font-serif text-4xl italic tracking-tight text-mocha-goldbright">Mocha</span>
        <span className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-mocha-muted">Desktop</span>
      </div>
      <div className="startup-enter z-10 mt-6" style={{ animationDelay: "300ms" }}>
        <p className="loader-breathe font-mono text-[10px] font-bold uppercase text-mocha-muted">Loading</p>
      </div>
    </div>
  );
}
