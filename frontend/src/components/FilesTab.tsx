import { formatBytes, type FileItem, type Profile, type StorageInfo, type TransferProgress } from "../lib";
import { TransferPanel } from "./TransferPanel";
import { FileList, type FileActions } from "./FileList";
import { FileGrid } from "./FileGrid";

export function FilesTab({ crumbs, onNavigate, filesView, folders, onRenameFolder, onMoveFolder, files, filesLoading, filesError, hasMore, loadingMore, onLoadMore, query, onClearSearch, selectedIds, onToggleSelect, actions, storage, profile, transfers, onCancelTransfer }: {
  crumbs: { label: string; value: string }[];
  onNavigate: (p: string) => void;
  filesView: "list" | "grid";
  folders: string[];
  onRenameFolder: (name: string) => void;
  onMoveFolder: (name: string) => void;
  files: FileItem[];
  filesLoading: boolean;
  filesError: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  query: string;
  onClearSearch: () => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  actions: FileActions;
  storage: StorageInfo | null;
  profile: Profile | null;
  transfers: TransferProgress[];
  onCancelTransfer: (jobId: string) => void;
}) {
  const pct = storage && storage.maxStorageBytes > 0 ? Math.min(100, storage.storagePercent) : 0;
  return (
    <div className="mt-5 grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 overflow-hidden md:grid-cols-12">
      <div className="bezel-shell rise-in flex min-h-0 flex-col md:col-span-8">
        <div className="bezel-core flex min-h-0 flex-1 flex-col p-2">
          {folders.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2 p-4">
              {folders.map((f, i) => (
                <div key={f} style={{ animationDelay: `${Math.min(i, 10) * 45}ms` }} className="folder-enter card-hover group/folder flex items-center gap-1 rounded-full border border-white/10 bg-white/5 pl-4 pr-1 py-1">
                  <button onClick={() => onNavigate(f.replace(/^\//, ""))} className="font-mono text-xs text-mocha-secondary hover:text-mocha-goldbright">
                    {f}
                  </button>
                  <button title="Rename folder" onClick={() => onRenameFolder(f)} className="rounded-full px-2 py-1 font-mono text-[10px] text-mocha-dim opacity-100 hover:text-mocha-goldbright md:opacity-0 md:group-hover/folder:opacity-100 md:group-focus-within/folder:opacity-100">Rename</button>
                  <button title="Move folder" onClick={() => onMoveFolder(f)} className="rounded-full px-2 py-1 font-mono text-[10px] text-mocha-dim opacity-100 hover:text-mocha-goldbright md:opacity-0 md:group-hover/folder:opacity-100 md:group-focus-within/folder:opacity-100">Move</button>
                </div>
              ))}
            </div>
          )}
          <div className="files-scroll flex min-h-0 flex-1 flex-col p-1.5">
            {filesLoading && files.length === 0 ? (
              <div className="flex flex-1 flex-col gap-2 p-2"><div className="skeleton-shimmer h-14 rounded-xl" /><div className="skeleton-shimmer h-14 rounded-xl" style={{ animationDelay: "100ms" }} /><div className="skeleton-shimmer h-14 rounded-xl" style={{ animationDelay: "200ms" }} /></div>
            ) : (
              <div className="folder-enter flex min-h-0 flex-1 flex-col" style={{ animationDelay: "80ms" }}>
                {filesView === "grid" ? (
                  <FileGrid files={files} selectedIds={selectedIds} onToggleSelect={onToggleSelect} actions={actions} />
                ) : (
                  <FileList files={files} selectedIds={selectedIds} onToggleSelect={onToggleSelect} actions={actions} />
                )}
                {files.length === 0 && !filesError && (
              <div className="empty-in flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                {query ? (
                  <>
                    <div className="font-serif text-2xl italic text-mocha-secondary">No matches for &ldquo;{query}&rdquo;</div>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-mocha-muted">The search filter is hiding everything in this view.</p>
                    <button onClick={onClearSearch} className="glass-button btn-ghost mt-4 rounded-full px-4 py-2 text-xs">Clear search</button>
                  </>
                ) : crumbs.length > 1 ? (
                  <>
                    <div className="font-serif text-2xl italic text-mocha-secondary">Nothing in this folder</div>
                    <p className="mx-auto mt-2 max-w-xs font-mono text-[11px] text-mocha-muted">{crumbs[crumbs.length - 1].value}</p>
                    <button onClick={() => onNavigate("/")} className="glass-button btn-ghost mt-4 rounded-full px-4 py-2 text-xs">Back to Files</button>
                  </>
                ) : (
                  <>
                    <div className="font-serif text-2xl italic text-mocha-secondary">Nothing here yet</div>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-mocha-muted">Drop files with Upload. Large files chunk automatically and resume on failure.</p>
                  </>
                )}
              </div>
            )}
                {filesError && (
                  <div className="notice-in mx-4 mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 font-mono text-xs text-red-200">{filesError}</div>
                )}
                {hasMore && (
                  <button onClick={onLoadMore} disabled={loadingMore} className="glass-button btn-ghost mx-4 mb-4 rounded-full px-4 py-2 font-mono text-[11px] disabled:opacity-50">
                    {loadingMore ? "Loading" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-4 md:col-span-4">
        <div className="bezel-shell rise-in shrink-0" style={{ animationDelay: "120ms" }}>
          <div className="bezel-core p-4">
            <span className="text-[13px] text-mocha-secondary">Storage</span>
            <div className="mt-3 font-ui text-2xl font-semibold tabular-nums">{storage ? formatBytes(storage.usedBytes) : "-"}</div>
            <div className="mt-1 font-mono text-[11px] text-mocha-muted">of {storage ? formatBytes(storage.maxStorageBytes) : "-"} {"·"} {profile?.uploadsCount ?? 0} uploads</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5 progress-sheen">
              <div className="h-full rounded-full bg-mocha-gold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="bezel-shell rise-in flex min-h-0 flex-1 flex-col" style={{ animationDelay: "200ms" }}>
          <div className="bezel-core flex min-h-0 flex-1 flex-col p-4">
            <span className="shrink-0 text-[13px] text-mocha-secondary">Activity</span>
            <TransferPanel transfers={transfers} onCancel={onCancelTransfer} />
          </div>
        </div>
      </div>
    </div>
  );
}
