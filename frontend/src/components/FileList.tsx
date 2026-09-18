import { formatBytes, formatDate, isArchiveFile, isPreviewable, isVideoFile, type FileItem } from "../lib";
import { FileIcon } from "./icons";

export interface FileActions {
  onOpen: (f: FileItem) => void;
  onBrowse: (f: FileItem) => void;
  onSave: (f: FileItem) => void;
  onRename: (f: FileItem) => void;
  onMove: (f: FileItem) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
}

export function FileList({ files, selectedIds, onToggleSelect, actions }: {
  files: FileItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  actions: FileActions;
}) {
  return (
    <div className="space-y-1">
      {files.map((f, i) => {
        const canPreview = isPreviewable(f);
        return (
          <div key={f.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} className="file-row-in card-hover group flex items-center gap-3 rounded-xl border border-transparent px-4 py-3 hover:border-white/10 hover:bg-white/[0.04]">
            <input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => onToggleSelect(f.id)} aria-label={`Select ${f.original_name}`} className="h-4 w-4 shrink-0 accent-[#c9a227]" />
            <FileIcon file={f} />
            <div className="min-w-0 flex-1">
              {canPreview ? (
                <button onClick={() => actions.onOpen(f)} title="Open preview" className="block max-w-full truncate text-left text-sm font-medium transition-colors hover:text-mocha-goldbright">
                  {f.original_name}
                </button>
              ) : (
                <div className="truncate text-sm font-medium">{f.original_name}</div>
              )}
              <div className="mt-0.5 truncate font-mono text-[11px] text-mocha-muted">{formatBytes(f.size)} {"·"} {formatDate(f.created_at)}</div>
            </div>
            <div className="flex items-center gap-1.5 opacity-100 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              {canPreview && (
                <button onClick={() => actions.onOpen(f)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">{isVideoFile(f) ? "Play" : "View"}</button>
              )}
              {isArchiveFile(f) && (
                <button onClick={() => actions.onBrowse(f)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Browse</button>
              )}
              <button onClick={() => actions.onSave(f)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Save</button>
              <button onClick={() => actions.onRename(f)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Rename</button>
              <button onClick={() => actions.onMove(f)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Move</button>
              <button onClick={() => actions.onShare(f.id)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Share</button>
              <button onClick={() => actions.onDelete(f.id)} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200">Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
