import { useEffect, useRef, useState } from "react";
import { api, isImageFile, isVideoFile, type FileItem } from "../lib";
import { FileIcon } from "./icons";

export function Thumbnail({ file, className = "" }: { file: FileItem; className?: string }) {
  const media = isImageFile(file) || isVideoFile(file);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !media) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [media]);

  useEffect(() => {
    if (!visible || !media) return;
    let alive = true;
    setUrl("");
    setFailed(false);
    api.previewUrl(file.id)
      .then((r) => {
        if (!alive) return;
        if (r?.url) setUrl(r.url);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [visible, media, file.id]);

  if (!media || failed) {
    return (
      <div ref={ref} className={`flex items-center justify-center ${className || ""}`}>
        <FileIcon file={file} />
      </div>
    );
  }
  if (!visible || !url) {
    return (
      <div ref={ref} className={`flex items-center justify-center ${className || ""}`}>
        <div className="h-full w-full animate-pulse bg-white/5" />
      </div>
    );
  }
  if (isImageFile(file)) {
    return (
      <img
        src={url}
        alt={file.original_name}
        draggable={false}
        onError={() => setFailed(true)}
        className={`thumb-fade object-cover ${className || ""}`}
      />
    );
  }
  return (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
      className={`thumb-fade object-cover ${className || ""}`}
    />
  );
}
