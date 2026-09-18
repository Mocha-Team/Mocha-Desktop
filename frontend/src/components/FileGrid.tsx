import { formatBytes, formatDate, isPreviewable, type FileItem } from "../lib";
import { Thumbnail } from "./Thumbnail";
import type { FileActions } from "./FileList";

export function FileGrid({ files, selectedIds, onToggleSelect, actions }: {
  files: FileItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  actions: FileActions;
}) {
  return (
    <div className="grid gap-3 p-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {files.map((f, i) => {
        const previewable = isPreviewable(f);
        const selected = selectedIds.has(f.id);
        return (
          <div key={f.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className={`file-row-in card-hover group relative overflow-hidden rounded-2xl border hover:border-mocha-gold/30 ${selected ? "border-mocha-gold/60 bg-mocha-gold/[0.06]" : "border-white/5 bg-white/[0.02]"}`}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(f.id)}
              aria-label={`Select ${f.original_name}`}
              className="absolute left-2 top-2 z-10 h-4 w-4 accent-[#c9a227] transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100 checked:opacity-100 focus:opacity-100"
            />
            <button
              onClick={() => (previewable ? actions.onOpen(f) : onToggleSelect(f.id))}
              title={previewable ? "Open preview" : undefined}
              className="thumb-zoom block aspect-[4/3] w-full overflow-hidden bg-black/20"
            >
              <Thumbnail file={f} className="h-full w-full" />
            </button>
            <div className="px-3 py-2">
              <div className="truncate text-xs font-medium">{f.original_name}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-mocha-muted opacity-100 transition-opacity duration-700 md:opacity-0 md:group-hover:opacity-100">
                {formatBytes(f.size)} {"·"} {formatDate(f.created_at)}
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap gap-1 bg-black/70 p-2 opacity-100 transition-opacity duration-300 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              {previewable && (
                <button onClick={(e) => { e.stopPropagation(); actions.onOpen(f); }} className="glass-button btn-ghost rounded-full px-2 py-1 text-[10px]">View</button>
              )}
              <button onClick={(e) => { e.stopPropagation(); actions.onSave(f); }} className="glass-button btn-ghost rounded-full px-2 py-1 text-[10px]">Save</button>
              <button onClick={(e) => { e.stopPropagation(); actions.onRename(f); }} className="glass-button btn-ghost rounded-full px-2 py-1 text-[10px]">Rename</button>
              <button onClick={(e) => { e.stopPropagation(); actions.onMove(f); }} className="glass-button btn-ghost rounded-full px-2 py-1 text-[10px]">Move</button>
              <button onClick={(e) => { e.stopPropagation(); actions.onShare(f.id); }} className="glass-button btn-ghost rounded-full px-2 py-1 text-[10px]">Share</button>
              <button onClick={(e) => { e.stopPropagation(); actions.onDelete(f.id); }} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-2 py-1 text-[10px] text-red-200">Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
