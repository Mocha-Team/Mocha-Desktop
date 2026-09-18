import { useEffect, useState } from "react";

export type NoticeTone = "info" | "success" | "error";

export interface Notice {
  id: number;
  text: string;
  tone: NoticeTone;
}

const toneClass: Record<NoticeTone, string> = {
  info: "border-white/10 text-mocha-primary",
  success: "border-[rgba(138,191,138,0.22)] text-[#a9d3a9]",
  error: "border-[rgba(212,124,107,0.24)] text-[#f0c8c0]",
};

const dotClass: Record<NoticeTone, string> = {
  info: "bg-mocha-gold shadow-[0_0_8px_rgba(201,168,108,0.6)]",
  success: "bg-[#8abf8a] shadow-[0_0_8px_rgba(138,191,138,0.5)]",
  error: "bg-[#d47c6b] shadow-[0_0_8px_rgba(212,124,107,0.5)]",
};

export function ToastStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
      {notices.map((n) => (
        <Toast key={n.id} notice={n} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const ttl = notice.tone === "error" ? 6000 : 4200;

  useEffect(() => {
    const t = window.setTimeout(() => setLeaving(true), ttl);
    return () => window.clearTimeout(t);
  }, [ttl]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => onDismiss(notice.id), 220);
    return () => window.clearTimeout(t);
  }, [leaving, notice.id, onDismiss]);

  return (
    <button
      type="button"
      onClick={() => setLeaving(true)}
      className={`pointer-events-auto flex max-w-[28rem] items-center gap-2.5 rounded-2xl border bg-black/70 px-4 py-2.5 text-left text-[13px] backdrop-blur-3xl ${toneClass[notice.tone]} ${leaving ? "toast-out" : "toast-in"}`}
      style={{ boxShadow: "0 20px 60px -20px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.06)" }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[notice.tone]}`} />
      <span className="min-w-0">{notice.text}</span>
    </button>
  );
}
