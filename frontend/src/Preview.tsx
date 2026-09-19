import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes, isAudioFile, isImageFile, isVideoFile, type FileItem } from "./lib";

interface PreviewProps {
  file: FileItem;
  url: string;
  loading: boolean;
  position: string | null;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownload: () => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

function Icon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function Preview({ file, url, loading, position, hasPrev, hasNext, onClose, onPrev, onNext, onDownload }: PreviewProps) {
  const isVideo = isVideoFile(file);
  const isImage = !isVideo && isImageFile(file);
  const isAudio = !isVideo && !isImage && isAudioFile(file);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeTimer = useRef<number | null>(null);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    videoRef.current?.pause();
    closeTimer.current = window.setTimeout(onClose, 250);
  }, [closing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    setZoom(1);
    setFit("contain");
    setPan({ x: 0, y: 0 });
    setMediaError(null);
  }, [file.id, url]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      } else if (e.key === "ArrowRight" && hasNext && !mod) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft" && hasPrev && !mod) {
        e.preventDefault();
        onPrev();
      } else if (isImage && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.25) * 100) / 100));
      } else if (isImage && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.25) * 100) / 100));
      } else if (isImage && e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === " " && videoRef.current && isVideo && url) {
        e.preventDefault();
        if (videoRef.current.paused) void videoRef.current.play().catch(() => undefined);
        else videoRef.current.pause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose, onNext, onPrev, hasNext, hasPrev, isImage, isVideo, url]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !isImage) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      setZoom((z) => {
        const next = z * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isImage, file.id]);

  function beginPan(e: React.MouseEvent) {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }

  function movePan(e: React.MouseEvent) {
    if (!dragging) return;
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) });
  }

  function endPan() {
    setDragging(false);
  }

  const shownError = mediaError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${file.original_name}`}
      className={`preview-overlay ${closing ? "is-closing" : "is-open"} fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-md md:p-6`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className={`bezel-shell preview-shell ${closing ? "is-closing" : "is-open"} relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden`}>
        <div className="bezel-core flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-3 border-b border-white/5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-serif text-[15px] italic">{file.original_name}</div>
              <div className="mt-0.5 font-mono text-[11px] text-mocha-muted">
                {formatBytes(file.size)} {"·"} {file.mime_type}
                {position ? ` · ${position}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {(hasPrev || hasNext) && (
                <>
                  <button
                    onClick={onPrev}
                    disabled={!hasPrev}
                    aria-label="Previous"
                    className="glass-button btn-ghost flex h-7 w-7 items-center justify-center rounded-full text-mocha-secondary disabled:opacity-30"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <button
                    onClick={onNext}
                    disabled={!hasNext}
                    aria-label="Next"
                    className="glass-button btn-ghost flex h-7 w-7 items-center justify-center rounded-full text-mocha-secondary disabled:opacity-30"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </>
              )}
              <button onClick={onDownload} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">
                Save
              </button>
              <button
                onClick={requestClose}
                aria-label="Close preview"
                className="glass-button btn-ghost flex h-7 w-7 items-center justify-center rounded-full text-mocha-secondary"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            <div key={file.id} className="preview-media-swap flex min-h-0 w-full flex-1 items-center justify-center">
            {loading && (
              <div className="flex flex-col items-center gap-3 py-16 font-mono text-[11px] uppercase tracking-[0.2em] text-mocha-muted">
                <span className="loader-ring block h-6 w-6 rounded-full border border-white/10 border-t-mocha-gold" />
                Loading preview
              </div>
            )}
            {!loading && shownError && (
              <div className="flex max-w-sm flex-col items-center px-6 py-10 text-center">
                <div className="font-serif text-xl italic text-mocha-secondary">Preview unavailable</div>
                <p className="mt-2 font-mono text-[11px] leading-relaxed text-mocha-muted">{shownError}</p>
                <button onClick={onDownload} className="glass-button btn-gold mt-4 rounded-full px-4 py-2 text-xs font-semibold">
                  Save file instead
                </button>
              </div>
            )}
            {!loading && !shownError && url && isImage && (
              <div className="flex min-h-0 w-full flex-1 flex-col">
                <div
                  ref={stageRef}
                  className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl ${zoom > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
                  onMouseDown={beginPan}
                  onMouseMove={movePan}
                  onMouseUp={endPan}
                  onMouseLeave={endPan}
                >
                  <img
                    src={url}
                    alt={file.original_name}
                    draggable={false}
                    onError={() => setMediaError("This image cannot be displayed here. Save it to view locally.")}
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      objectFit: fit,
                      maxHeight: "52dvh",
                      maxWidth: "100%",
                      width: fit === "cover" ? "100%" : "auto",
                      transition: dragging ? "none" : "transform 200ms cubic-bezier(0.32,0.72,0,1)",
                    }}
                    className="select-none rounded-lg"
                  />
                </div>
                <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-1.5">
                  <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.25) * 100) / 100))} className="glass-button btn-ghost rounded-full px-3 py-1.5 font-mono text-[11px]" aria-label="Zoom out">
                    <Icon d="M5 12h14" />
                  </button>
                  <span className="min-w-14 text-center font-mono text-[11px] tabular-nums text-mocha-muted">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.25) * 100) / 100))} className="glass-button btn-ghost rounded-full px-3 py-1.5 font-mono text-[11px]" aria-label="Zoom in">
                    <Icon d="M12 5v14M5 12h14" />
                  </button>
                  <button
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="glass-button btn-ghost rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-secondary"
                  >
                    Reset
                  </button>
                  <button onClick={() => setFit((f) => (f === "contain" ? "cover" : "contain"))} className="glass-button btn-ghost rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-secondary">
                    {fit === "contain" ? "Fill" : "Fit"}
                  </button>
                </div>
              </div>
            )}
            {!loading && !shownError && url && isVideo && (
              <video
                ref={videoRef}
                key={file.id}
                src={url}
                controls
                autoPlay
                playsInline
                preload="auto"
                onError={() => setMediaError("This video cannot be played here. Save it to watch locally.")}
                style={{ maxHeight: "56dvh", background: "#000" }}
                className="w-full rounded-xl"
              />
            )}
            {!loading && !shownError && url && isAudio && (
              <div className="flex w-full max-w-md flex-col items-center px-6 py-10">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5 font-mono text-[10px] uppercase tracking-widest text-mocha-gold">
                  {(file.mime_type.split("/")[1] || "aud").slice(0, 4)}
                </span>
                <div className="mt-4 max-w-full truncate font-serif text-[15px] italic">{file.original_name}</div>
                <div className="mt-1 font-mono text-[11px] text-mocha-muted">{formatBytes(file.size)}</div>
                <audio
                  key={file.id}
                  src={url}
                  controls
                  autoPlay
                  preload="auto"
                  onError={() => setMediaError("This audio cannot be played here. Save it to listen locally.")}
                  className="mt-5 w-full"
                />
              </div>
            )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-white/5 px-4 py-2.5 font-mono text-[10px] text-mocha-dim">
            <span>{isImage ? "Scroll to zoom · drag to pan · + / - · 0 resets" : isVideo ? "Space plays · arrows switch files · Esc closes" : "Esc closes · arrows switch files"}</span>
            <span className="uppercase tracking-[0.2em]">{isVideo ? "Video" : isImage ? "Image" : isAudio ? "Audio" : "Preview"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
