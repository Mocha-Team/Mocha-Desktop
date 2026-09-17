import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EventsOff, EventsOn } from "../wailsjs/runtime/runtime";
import { api, copyText, folderName, formatBytes, formatDate, formatSpeed, formatTime, isPreviewable, parseLines, type AppSettings, type ArchiveEntry, type FileItem, type Profile, type RemoveSyncPreview, type RemoveSyncResult, type Share, type Status, type StorageInfo, type SyncFolder, type TransferProgress, type TrashItem } from "./lib";
import { useRevealRoot } from "./hooks";
import { Loader } from "./Loader";
import { Titlebar } from "./Titlebar";
import { Flyout } from "./Flyout";
import { Preview } from "./Preview";
import { SettingRow } from "./Toggle";
import { TransferRow } from "./components/TransferPanel";
import { ArrowIcon, CaretIcon, FolderGlyph } from "./components/icons";
import { FilesTab } from "./components/FilesTab";
import { ModalShell } from "./components/ModalShell";
import { ShareModal } from "./components/ShareModal";

type Tab = "files" | "shares" | "sync" | "activity" | "trash" | "settings";

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [tab, setTab] = useState<Tab>("files");
  const [view, setView] = useState<"full" | "flyout">("full");
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const [path, setPath] = useState("/");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [transfers, setTransfers] = useState<Record<string, TransferProgress>>({});
  const [syncFolders, setSyncFolders] = useState<SyncFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState("https://mocha.my");
  const [apiKey, setApiKey] = useState("");
  const [booted, setBooted] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removePreview, setRemovePreview] = useState<{ path: string; preview: RemoveSyncPreview } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [modal, setModal] = useState<null | { kind: "mkdir" } | { kind: "renameFile"; file: FileItem } | { kind: "renameFolder"; name: string } | { kind: "moveFile"; file: FileItem } | { kind: "moveFolder"; name: string }>(null);
  const [modalValue, setModalValue] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [archiveFile, setArchiveFile] = useState<FileItem | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntry[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [overwrite, setOverwrite] = useState<{ file: FileItem; dest: string; size: number } | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [menuSupported, setMenuSupported] = useState(true);
  const [ignoreEditor, setIgnoreEditor] = useState<string | null>(null);
  const [ignoreDraft, setIgnoreDraft] = useState("");
  const [ignoreBusy, setIgnoreBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewUrlLoading, setPreviewUrlLoading] = useState(false);
  const [previewUrlError, setPreviewUrlError] = useState<string | null>(null);
  const previewReq = useRef(0);
  const filesReq = useRef(0);
  const lastPathRef = useRef<string | null>(null);

  const [filesView, setFilesView] = useState<"list" | "grid">("list");

  useEffect(() => {
    if (!status?.configured) return;
    api.getSettings().then((s) => {
      setSettings(s);
      setFilesView(s.filesView === "grid" ? "grid" : "list");
    }).catch(() => undefined);
  }, [status?.configured]);

  const changeFilesView = useCallback(async (v: "list" | "grid") => {
    setFilesView(v);
    const base = settings ?? await api.getSettings().catch(() => null);
    if (base) {
      await api.saveSettings({ ...base, filesView: v }).catch(() => undefined);
      setSettings((s) => ({ ...(s || base), filesView: v }));
    }
  }, [settings]);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  function normalizeFolders(list: SyncFolder[]): SyncFolder[] {
    if (!Array.isArray(list)) return [];
    return list.map((f) => ({ ...f, queued: f.queued ?? [] }));
  }

  const refreshSync = useCallback(async () => {
    try {
      const list = await api.syncFolders();
      setSyncFolders(normalizeFolders(list));
    } catch {
      return;
    }
  }, []);

  const refreshData = useCallback(async () => {
    const req = ++filesReq.current;
    const navigating = lastPathRef.current !== path;
    lastPathRef.current = path;
    setFilesLoading(true);
    setFilesError(null);
    setCursor("");
    setHasMore(false);
    setLoadingMore(false);
    setSelectedIds(new Set());
    if (navigating) {
      setFiles([]);
      setFolders([]);
    }
    try {
      const [p, st, sh] = await Promise.all([
        api.profile().catch(() => null),
        api.storage().catch(() => null),
        api.shares().catch(() => [] as Share[]),
      ]);
      if (filesReq.current !== req) return;
      if (p) setProfile(p);
      if (st) setStorage(st);
      setShares(sh || []);
      try {
        const list = await api.list(path, 100, "", query);
        if (filesReq.current !== req) return;
        setFiles(list.files || []);
        setFolders(list.folders || []);
        setCursor(list.nextCursor || "");
        setHasMore(!!list.hasMore);
      } catch (err) {
        if (filesReq.current !== req) return;
        const msg = err instanceof Error ? err.message : "File listing failed";
        setFilesError(msg);
        setNotice(msg);
      }
    } catch (e) {
      if (filesReq.current !== req) return;
      setNotice(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      if (filesReq.current === req) setFilesLoading(false);
    }
  }, [path, query]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    const req = filesReq.current;
    setLoadingMore(true);
    try {
      const list = await api.list(path, 100, cursor, query);
      if (filesReq.current !== req) return;
      setFiles((f) => [...f, ...(list.files || [])]);
      setCursor(list.nextCursor || "");
      setHasMore(!!list.hasMore);
    } catch (err) {
      if (filesReq.current !== req) return;
      setNotice(err instanceof Error ? err.message : "Load more failed");
    } finally {
      if (filesReq.current === req) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, path, cursor, query]);

  const refreshTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      setTrash(await api.trash());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Trash failed");
    } finally {
      setTrashLoading(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      setSettingsDraft((s.globalIgnores || []).join("\n"));
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void refreshStatus().then(() => setBooted(true));
    api.supportsContextMenu().then(setMenuSupported).catch(() => setMenuSupported(false));
  }, [refreshStatus]);

  const debouncedQuery = useDeferredValue(query);

  useEffect(() => {
    if (status?.configured) {
      refreshData();
      refreshSync();
    }
  }, [status?.configured, path, debouncedQuery, refreshData, refreshSync]);

  useEffect(() => {
    if (!status?.configured) return;
    if (tab === "sync") refreshSync();
    if (tab === "trash") void refreshTrash();
    if (tab === "settings") void refreshSettings();
  }, [status?.configured, tab, refreshSync, refreshTrash, refreshSettings]);

  useEffect(() => {
    const cleanup = (key: string) => {
      setTimeout(() => {
        setTransfers((t) => {
          if (!(key in t)) return t;
          const next = { ...t };
          delete next[key];
          return next;
        });
      }, 2500);
    };
    EventsOn("upload:progress", (p: TransferProgress) => {
      setTransfers((t) => ({ ...t, ["u" + p.jobId]: p }));
      if (p.status === "done" || p.status === "error" || p.status === "cancelled") cleanup("u" + p.jobId);
    });
    EventsOn("download:progress", (p: TransferProgress) => {
      setTransfers((t) => ({ ...t, ["d" + p.jobId]: p }));
      if (p.status === "done" || p.status === "error" || p.status === "cancelled") cleanup("d" + p.jobId);
    });
    EventsOn("sync:status", (list: SyncFolder[]) => {
      setSyncFolders(normalizeFolders(list));
    });
    EventsOn("tray:flyout", () => {
      setView("flyout");
      void refreshSync();
    });
    EventsOn("tray:full", () => {
      setView("full");
    });
    return () => {
      EventsOff("upload:progress");
      EventsOff("download:progress");
      EventsOff("sync:status");
      EventsOff("tray:flyout");
      EventsOff("tray:full");
    };
  }, [refreshSync]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  useRevealRoot([tab, files.length, status?.configured]);

  const crumbs = useMemo(() => {
    const parts = path.split("/").filter(Boolean);
    return [{ label: "Files", value: "/" }, ...parts.map((p, i) => ({ label: p, value: "/" + parts.slice(0, i + 1).join("/") + "/" }))];
  }, [path]);

  const navigate = (p: string) => setPath(p.includes("/") ? p : path + p.replace(/^\//, "") + "/");

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.saveConnection(appUrl, apiKey);
      const s = await refreshStatus();
      setStatus(s);
      await refreshData();
      setNotice("Connected to Mocha");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (uploading) return;
    setUploading(true);
    try {
      const jobs = await api.pickUpload(path);
      if (Array.isArray(jobs) && jobs.length > 1) {
        setNotice(`Uploaded ${jobs.length} files in parallel`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      await refreshData();
    }
  }

  async function remove(id: string) {
    try {
      await api.remove(id);
      await refreshData();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function share(id: string) {
    const f = files.find((x) => x.id === id);
    if (f) setShareFile(f);
  }

  const previewableFiles = useMemo(() => files.filter((f) => isPreviewable(f)), [files]);

  const openPreview = useCallback(async (file: FileItem) => {
    const req = ++previewReq.current;
    setPreviewFile(file);
    setPreviewUrl("");
    setPreviewUrlError(null);
    setPreviewUrlLoading(true);
    try {
      const res = await api.previewUrl(file.id);
      if (previewReq.current !== req) return;
      if (!res?.url) {
        setPreviewUrlError("Preview URL is missing");
        return;
      }
      setPreviewUrl(res.url);
    } catch (err) {
      if (previewReq.current !== req) return;
      setPreviewUrlError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      if (previewReq.current === req) setPreviewUrlLoading(false);
    }
  }, []);

  const closePreview = useCallback(() => {
    previewReq.current++;
    setPreviewFile(null);
    setPreviewUrl("");
    setPreviewUrlError(null);
    setPreviewUrlLoading(false);
  }, []);

  const navigatePreview = useCallback(
    (direction: "next" | "prev") => {
      if (!previewFile || previewableFiles.length <= 1) return;
      const idx = previewableFiles.findIndex((f) => f.id === previewFile.id);
      if (idx === -1) return;
      const nextIdx = direction === "next" ? (idx + 1) % previewableFiles.length : (idx - 1 + previewableFiles.length) % previewableFiles.length;
      void openPreview(previewableFiles[nextIdx]);
    },
    [previewFile, previewableFiles, openPreview]
  );

  async function downloadFile(file: FileItem) {
    try {
      await api.download(file.id, file.original_name);
      setNotice("Saved " + file.original_name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      if (msg.startsWith("exists:")) {
        const dest = msg.slice("exists:".length);
        setOverwrite({ file, dest, size: 0 });
        setNotice("File exists - confirm overwrite");
        return;
      }
      setNotice(msg);
    }
  }

  async function confirmOverwrite(close: () => void) {
    if (!overwrite) return;
    try {
      await api.downloadToPath(overwrite.file.id, overwrite.dest, true);
      setNotice("Saved " + overwrite.file.original_name);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Download failed");
    } finally {
      close();
    }
  }

  async function cancelTransfer(jobId: string) {
    try {
      await api.cancelTransfer(jobId);
      setNotice("Transfer cancelled");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  async function submitModal(close: () => void) {
    if (!modal || modalBusy) return;
    const value = modalValue.trim();
    if (!value) {
      setNotice("Name required");
      return;
    }
    setModalBusy(true);
    try {
      if (modal.kind === "mkdir") await api.createFolder(path, value);
      else if (modal.kind === "renameFile") await api.renameFile(modal.file.id, value);
      else if (modal.kind === "renameFolder") await api.renameFolder(path, modal.name, value);
      else if (modal.kind === "moveFile") await api.moveFile(modal.file.id, value);
      else if (modal.kind === "moveFolder") await api.moveFolder(path + modal.name.replace(/^\//, ""), value);
      close();
      await refreshData();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setModalBusy(false);
    }
  }

  function openModalFor(m: NonNullable<typeof modal>) {
    if (m.kind === "renameFile") setModalValue(m.file.original_name);
    else if (m.kind === "renameFolder") setModalValue(m.name.replace(/^\//, ""));
    else if (m.kind === "moveFile" || m.kind === "moveFolder") setModalValue("/");
    else setModalValue("");
    setModal(m);
  }

  async function openArchive(file: FileItem) {
    setArchiveFile(file);
    setArchiveEntries([]);
    setArchiveLoading(true);
    try {
      setArchiveEntries(await api.listArchive(file.id));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Archive unavailable");
    } finally {
      setArchiveLoading(false);
    }
  }

  async function bulkDownload() {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setNotice("Select files first");
      return;
    }
    try {
      const dest = await api.bulkDownload(ids, []);
      setNotice("Saved " + dest);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Bulk download failed");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function togglePause(folderPath: string, paused: boolean) {
    try {
      await api.setSyncPaused(folderPath, !paused);
      await refreshSync();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Pause failed");
    }
  }

  async function openIgnoreEditor(folderPath: string) {
    setIgnoreEditor(folderPath);
    try {
      const list = await api.getFolderIgnores(folderPath);
      setIgnoreDraft(list.join("\n"));
    } catch {
      setIgnoreDraft("");
    }
  }

  async function saveIgnoreEditor(close: () => void) {
    if (!ignoreEditor || ignoreBusy) return;
    setIgnoreBusy(true);
    try {
      const patterns = parseLines(ignoreDraft);
      await api.saveFolderIgnores(ignoreEditor, patterns);
      close();
      setNotice("Ignore rules saved");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIgnoreBusy(false);
    }
  }

  async function persistSettings(next: AppSettings) {
    setSettingsBusy(true);
    try {
      await api.saveSettings(next);
      setSettings(next);
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSettingsBusy(false);
    }
  }

  function updateSettings(patch: Partial<AppSettings>) {
    const next = { ...(settings || {}), ...patch };
    setSettings(next);
    void persistSettings(next);
  }

  async function saveSettings() {
    if (settingsBusy) return;
    const next: AppSettings = {
      ...(settings || {}),
      globalIgnores: parseLines(settingsDraft),
    };
    if (await persistSettings(next)) setNotice("Settings saved");
  }

  async function addFolder() {
    try {
      await api.addSyncFolder();
      const s = await refreshStatus();
      setStatus(s);
      await refreshSync();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not add folder");
    }
  }

  async function removeFolder(folderPath: string) {
    setRemovePreview(null);
    setConfirmRemove(folderPath);
  }

  async function previewDeleteFiles(folderPath: string) {
    setPreviewLoading(true);
    try {
      const preview = await api.previewRemoveSyncFolder(folderPath);
      setRemovePreview({ path: folderPath, preview });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not preview files");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function keepOnlyFolder(folderPath: string) {
    await finishRemoveFolder(folderPath, null);
  }

  async function executeDeleteFiles(folderPath: string) {
    setRemoving(true);
    try {
      const result: RemoveSyncResult = await api.removeSyncFolderAndFiles(folderPath);
      const parts = [`${result.deleted} deleted`];
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.skipped > 0) parts.push(`${result.skipped} not matched, delete manually`);
      await finishRemoveFolder(folderPath, `Stopped sync (${parts.join(", ")})`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not remove folder");
    } finally {
      setRemoving(false);
    }
  }

  async function finishRemoveFolder(folderPath: string, message: string | null) {
    if (message === null) {
      setRemoving(true);
      try {
        await api.removeSyncFolder(folderPath);
        setNotice("Stopped sync, uploaded files kept");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not remove folder");
        return;
      } finally {
        setRemoving(false);
      }
    }
    setConfirmRemove(null);
    setRemovePreview((prev) => (prev && prev.path === folderPath ? null : prev));
    setTransfers((t) => {
      const next: typeof t = {};
      for (const [k, v] of Object.entries(t)) {
        if (!k.startsWith("usync-")) next[k] = v;
      }
      return next;
    });
    const s = await refreshStatus();
    setStatus(s);
    await refreshSync();
    await refreshData();
  }

  async function rescanSync() {
    try {
      await api.rescanSync();
      await refreshSync();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Rescan failed");
    }
  }

  const activeTransfers = useMemo(() => Object.values(transfers).slice(-6).reverse(), [transfers]);
  const syncingNow = useMemo(() => Object.values(transfers).filter((t) => t.jobId.startsWith("sync-") && t.status !== "done" && t.status !== "error" && t.status !== "cancelled").reverse(), [transfers]);

  if (view === "flyout") {
    return (
      <div className="h-[100dvh] w-[100dvw] overflow-hidden bg-[var(--background)] text-mocha-primary">
        {!status ? (
          <div className="flex h-full items-center justify-center font-mono text-[11px] tracking-widest text-mocha-muted">LOADING</div>
        ) : (
          <Flyout
            folders={syncFolders}
            transfers={activeTransfers}
            onOpen={() => void api.showMain()}
            onClose={() => void api.closeWindow()}
          />
        )}
      </div>
    );
  }

  if (!status || !booted) {
    return (
      <div className="bg-[var(--background)]">
        <Titlebar />
        <div className="pt-9">
          <Loader />
        </div>
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="h-[100dvh] overflow-hidden bg-[var(--background)] px-4 py-8">
        <Titlebar />
        <div className="quiet-scroll relative mx-auto h-full w-full max-w-md pb-16 pt-24">
          <div className="reveal is-visible">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-mocha-muted">Mocha Desktop</span>
            <h1 className="mt-4 font-ui text-3xl font-semibold leading-[1.1] tracking-tight text-mocha-primary">
              Your files,
              <br />
              <span className="font-serif italic text-mocha-goldbright">machined</span> for desktop.
            </h1>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-mocha-secondary">
              Connect with a Mocha API key. Keys stay in your OS keychain, uploads use multipart presigned URLs, downloads resume with Range.
            </p>
          </div>
          <div className="bezel-shell reveal is-visible mt-6">
            <form onSubmit={connect} className="bezel-core space-y-3 p-4">
              <label className="block">
                <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">App URL</span>
                <input value={appUrl} onChange={(e) => setAppUrl(e.target.value)} placeholder="https://mocha.my" className="field w-full rounded-2xl px-4 py-3 text-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" />
              </label>
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 font-mono text-[11px] text-mocha-muted">API endpoint fixed to https://api.mocha.my</div>
              <label className="block">
                <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">API key</span>
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="mocha_..." type="password" className="field w-full rounded-2xl px-4 py-3 font-mono text-sm transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" />
              </label>
              <button type="submit" disabled={busy} className="glass-button btn-gold group flex w-full items-center justify-between rounded-full py-2 pl-6 pr-2 text-sm font-semibold active:scale-[0.98]">
                <span>{busy ? "Connecting" : "Connect Mocha"}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110">
                  <ArrowIcon />
                </span>
              </button>
              <p className="font-mono text-[11px] leading-relaxed text-mocha-muted">Mint a key in web dashboard under API Keys. API access is on by default unless an admin revoked it.</p>
            </form>
          </div>
          {notice && <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-mocha-secondary">{notice}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--background)] px-4 pb-4 text-mocha-primary">
      <Titlebar />

      <header className="fixed left-1/2 top-[52px] z-30 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
        <div className={`flex items-center gap-1 rounded-full border border-white/10 bg-black/60 py-1 pl-4 pr-1 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-3xl`}>
          <span className="mr-2 font-serif text-base italic text-mocha-goldbright">Mocha</span>
          {(["files", "shares", "sync", "activity", "trash"] as Tab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); closeMenu(); }} className={`glass-button rounded-full px-3 py-1.5 text-[11px] font-medium capitalize tracking-wide transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${tab === t ? "bg-white/10 text-mocha-goldbright" : "text-mocha-secondary hover:bg-white/5 hover:text-mocha-primary"}`}>
              {t}
            </button>
          ))}
          <button onClick={toggleMenu} aria-label="Menu" aria-expanded={menuOpen} className={`glass-button relative ml-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-mocha-primary`}>
            <span className={`absolute h-px w-4 bg-current transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${menuOpen ? "rotate-45" : "-translate-y-[3px]"}`} />
            <span className={`absolute h-px w-4 bg-current transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${menuOpen ? "-rotate-45" : "translate-y-[3px]"}`} />
          </button>
        </div>
        {menuOpen && (
          <div className="menu-pop mt-3 overflow-hidden rounded-[2rem] border border-white/10 bg-black/80 backdrop-blur-3xl">
            {[profile?.name || "Account", "Settings", "Sign out"].map((item, i) => (
              <button key={item} onClick={() => { if (item === "Settings") { setTab("settings"); } else if (item === "Sign out") { api.signOut().then(() => refreshStatus()); } closeMenu(); }} style={{ animationDelay: `${80 + i * 60}ms` }} className="menu-item block w-full px-6 py-3 text-left text-sm text-mocha-secondary transition-colors duration-300 hover:bg-white/5 hover:text-mocha-primary">
                {item}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden pt-24">
        <div className="reveal-fade flex shrink-0 flex-wrap items-center justify-between gap-4">
          <div>
            {tab === "files" && path !== "/" && (
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-mocha-muted">
                {crumbs.map((c, i) => (
                  <span key={c.value} className="flex items-center gap-1">
                    {i > 0 && (
                      <span className="text-mocha-dim" aria-hidden="true">
                        <CaretIcon />
                      </span>
                    )}
                    <button onClick={() => setPath(c.value)} className="rounded-full border border-white/5 bg-white/5 px-3 py-1 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-mocha-gold/30 hover:text-mocha-goldbright">
                      {c.label}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" className={`field w-40 rounded-full px-3.5 py-2 text-[13px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]`} />
            {tab === "files" && (
              <>
                <button
                  onClick={() => void changeFilesView(filesView === "grid" ? "list" : "grid")}
                  title={filesView === "grid" ? "List view" : "Grid view"}
                  aria-label="Toggle view"
                  className={`glass-button btn-ghost flex h-8 w-8 items-center justify-center rounded-full`}
                >
                  {filesView === "grid" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="4" y="4" width="7" height="7" rx="1" />
                      <rect x="13" y="4" width="7" height="7" rx="1" />
                      <rect x="4" y="13" width="7" height="7" rx="1" />
                      <rect x="13" y="13" width="7" height="7" rx="1" />
                    </svg>
                  )}
                </button>
                <button onClick={() => openModalFor({ kind: "mkdir" })} className={`glass-button btn-ghost rounded-full px-3.5 py-2 text-[13px]`}>New Folder</button>
                {selectedIds.size > 0 && (
                  <button onClick={() => void bulkDownload()} className={`glass-button btn-ghost rounded-full px-3.5 py-2 text-[13px]`}>Zip ({selectedIds.size})</button>
                )}
              </>
            )}
            <button onClick={upload} disabled={uploading} className={`glass-button btn-gold group flex items-center gap-2 rounded-full py-1 pl-4 pr-1 text-[13px] font-semibold active:scale-[0.98] disabled:opacity-60`}>
              {uploading ? "Uploading" : "Upload"}
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/10 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110">
                <ArrowIcon />
              </span>
            </button>
          </div>
        </div>

        {notice && tab !== "files" && <div className="reveal-fade is-visible mt-4 shrink-0 rounded-2xl border border-mocha-gold/20 bg-mocha-gold/10 px-4 py-2.5 text-[13px] text-mocha-goldbright">{notice}</div>}

        {tab === "files" && (
          <div key={tab + path} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <FilesTab
              crumbs={crumbs}
              onNavigate={navigate}
              filesView={filesView}
              folders={folders}
              onRenameFolder={(name) => openModalFor({ kind: "renameFolder", name })}
              onMoveFolder={(name) => openModalFor({ kind: "moveFolder", name })}
              files={files}
              filesLoading={filesLoading}
              filesError={filesError}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMore()}
              query={query}
              onClearSearch={() => setQuery("")}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              actions={{
                onOpen: (f) => void openPreview(f),
                onBrowse: (f) => void openArchive(f),
                onSave: (f) => void downloadFile(f),
                onRename: (f) => openModalFor({ kind: "renameFile", file: f }),
                onMove: (f) => openModalFor({ kind: "moveFile", file: f }),
                onShare: (id) => void share(id),
                onDelete: (id) => void remove(id),
              }}
              storage={storage}
              profile={profile}
              transfers={Object.values(transfers).slice().reverse()}
              onCancelTransfer={(id) => void cancelTransfer(id)}
            />
          </div>
        )}

        {tab === "shares" && (
          <div key={tab} className="bezel-shell reveal-fade mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core files-scroll flex min-h-0 flex-1 flex-col space-y-1.5 p-2">
              {shares.map((s) => (
                <div key={s.token} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-mocha-gold/20">
                   <div className="min-w-0 flex-1">
                     <div className="truncate text-sm font-medium">{s.original_name || s.folder_path || "Folder share"}</div>
                     <div className="mt-1 font-mono text-[11px] text-mocha-muted">/{s.token} {"·"} {s.download_count} downloads {"·"} {s.password_protected ? "locked" : "open"}</div>
                   </div>
                  <button onClick={() => { void copyText(`https://mocha.my/share/${s.token}`).then((ok) => setNotice(ok ? "Link copied" : s.token)); }} className="glass-button btn-ghost rounded-full px-4 py-2 text-xs">Copy</button>
                  <button onClick={() => api.deleteShare(s.token).then(() => refreshData())} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-200">Revoke</button>
                </div>
              ))}
              {shares.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center font-serif text-xl italic text-mocha-secondary">No share links yet</div>
              )}
            </div>
          </div>
        )}

        {tab === "sync" && (
          <div key={tab} className="mt-5 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-12">
            <div className="bezel-shell reveal-fade flex min-h-0 flex-col md:col-span-8">
              <div className="bezel-core flex min-h-0 flex-1 flex-col p-2">
                <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-2">
                  <span className="text-[13px] text-mocha-secondary">
                    {syncFolders.length === 0 ? "No folders watched" : `${syncFolders.length} folder${syncFolders.length === 1 ? "" : "s"} watched`}
                  </span>
                  <button onClick={addFolder} className="glass-button btn-gold group flex items-center gap-2 rounded-full py-1 pl-4 pr-1 text-[13px] font-semibold active:scale-[0.98]">
                    Add folder
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/10 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110"><ArrowIcon /></span>
                  </button>
                </div>
                <div className="files-scroll flex min-h-0 flex-1 flex-col space-y-1.5 p-1.5">
                  {syncFolders.map((f) => (
                    <div key={f.path} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-white/10">
                      <div className="flex items-center gap-3">
                        <FolderGlyph />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{folderName(f.path)}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-mocha-muted">{f.path}</div>
                          {f.remotePath && (
                            <div className="mt-0.5 truncate font-mono text-[11px] text-mocha-gold">syncs to {f.remotePath}</div>
                          )}
                        </div>
                        <span className={`shrink-0 font-mono text-[11px] ${f.status === "error" ? "text-red-300" : f.status === "idle" ? "text-mocha-muted" : "text-mocha-gold"}`}>
                          {f.paused || f.status === "paused" ? "Paused" : f.status === "scanning" ? "Scanning" : f.status === "syncing" ? (f.pending > 0 ? `${f.pending} left` : "Syncing") : f.status === "error" ? "Error" : "Up to date"}
                        </span>
                        <button onClick={() => void togglePause(f.path, !!(f.paused || f.status === "paused"))} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1.5 text-xs">{f.paused || f.status === "paused" ? "Resume" : "Pause"}</button>
                        <button onClick={() => void openIgnoreEditor(f.path)} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1.5 text-xs">Ignores</button>
                        <button onClick={() => removeFolder(f.path)} className="glass-button shrink-0 rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200">Remove</button>
                      </div>
                      {confirmRemove === f.path && !removePreview && (
                        <div className="mt-2.5 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                          <div className="font-serif text-[15px] italic text-mocha-secondary">Stop syncing this folder?</div>
                          <div className="mt-1 font-mono text-[11px] text-mocha-muted">Uploaded copies stay on the server unless deleted.</div>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <button disabled={removing || previewLoading} onClick={() => keepOnlyFolder(f.path)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs disabled:opacity-50">Keep files</button>
                            <button disabled={removing || previewLoading} onClick={() => previewDeleteFiles(f.path)} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50">{previewLoading ? "Checking..." : "Delete files too"}</button>
                            <button disabled={removing || previewLoading} onClick={() => { setRemovePreview(null); setConfirmRemove(null); }} className="glass-button rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-muted disabled:opacity-50">Cancel</button>
                          </div>
                        </div>
                      )}
                      {removePreview && removePreview.path === f.path && (
                        <div className="mt-2.5 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                          {removePreview.preview.total === 0 ? (
                            <>
                              <div className="font-serif text-[15px] italic text-mocha-secondary">No uploaded copies found</div>
                              <div className="mt-1 font-mono text-[11px] text-mocha-muted">Nothing on the server matches this folder.</div>
                            </>
                          ) : (
                            <>
                              <div className="font-serif text-[15px] italic text-mocha-secondary">Permanently delete {removePreview.preview.matched} file{removePreview.preview.matched === 1 ? "" : "s"} from the server{removePreview.preview.remotePath ? ` in ${removePreview.preview.remotePath}` : ""}?</div>
                              <div className="quiet-scroll mt-2 max-h-32 space-y-1 overflow-y-auto">
                                {removePreview.preview.files.map((file) => (
                                  <div key={file.rel} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                                    <span className={`truncate ${file.matched ? "text-mocha-secondary" : "text-mocha-dim"}`}>{file.rel}</span>
                                    <span className="shrink-0 text-mocha-dim">{formatBytes(file.size)}{file.matched ? "" : " · keep"}</span>
                                  </div>
                                ))}
                                {removePreview.preview.truncated && (
                                  <div className="font-mono text-[11px] text-mocha-dim">+ more not shown</div>
                                )}
                              </div>
                              {removePreview.preview.unmatched > 0 && (
                                <div className="mt-2 font-mono text-[11px] text-mocha-muted">{removePreview.preview.unmatched} could not be matched and will be kept.</div>
                              )}
                            </>
                          )}
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {removePreview.preview.matched > 0 && (
                              <button disabled={removing} onClick={() => executeDeleteFiles(f.path)} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50">Delete {removePreview.preview.matched} file{removePreview.preview.matched === 1 ? "" : "s"}</button>
                            )}
                            <button disabled={removing} onClick={() => keepOnlyFolder(f.path)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs disabled:opacity-50">{removePreview.preview.total === 0 ? "Stop sync anyway" : "Keep files"}</button>
                            <button disabled={removing} onClick={() => { setRemovePreview(null); setConfirmRemove(null); }} className="glass-button rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-muted disabled:opacity-50">Cancel</button>
                          </div>
                        </div>
                      )}
                      {f.status === "error" && f.error && (
                        <div className="mt-2 truncate font-mono text-[11px] text-red-300">{f.error}</div>
                      )}
                      {f.status === "syncing" && f.current && (
                        <div className="mt-2.5">
                          <div className="flex items-center justify-between font-mono text-[11px] text-mocha-muted">
                            <span className="truncate">{f.current}</span>
                            <span className="ml-2 shrink-0 tabular-nums">{Math.round(f.progress || 0)}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                            <div className="h-full rounded-full bg-mocha-gold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${Math.min(100, f.progress || 0)}%` }} />
                          </div>
                        </div>
                      )}
                      {f.status === "idle" && (
                        <div className="mt-1.5 font-mono text-[11px] text-mocha-muted">
                          {f.files} file{f.files === 1 ? "" : "s"}{f.lastSync > 0 ? ` · synced ${formatTime(f.lastSync)}` : ""}
                        </div>
                      )}
                      {f.queued.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
                          {f.queued.map((q) => (
                            <div key={q} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                              <span className="truncate text-mocha-muted">{q}</span>
                              <span className="shrink-0 text-mocha-dim">waiting</span>
                            </div>
                          ))}
                          {f.pending > f.queued.length && (
                            <div className="font-mono text-[11px] text-mocha-dim">+ {f.pending - f.queued.length} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {syncFolders.length === 0 && (
                    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                      <div className="font-serif text-2xl italic text-mocha-secondary">No watched folders</div>
                      <p className="mx-auto mt-2 max-w-xs text-sm text-mocha-muted">Add a folder and everything inside it uploads automatically. New and changed files sync on their own.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="bezel-shell reveal-fade flex min-h-0 flex-col md:col-span-4">
              <div className="bezel-core flex min-h-0 flex-1 flex-col p-4">
                <div className="flex shrink-0 items-center justify-between">
                  <span className="text-[13px] text-mocha-secondary">
                    {syncingNow.length === 0 ? "Nothing syncing" : `Syncing ${syncingNow.length} file${syncingNow.length === 1 ? "" : "s"}`}
                  </span>
                  <button onClick={rescanSync} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1 text-[11px]">Rescan</button>
                </div>
                <div className="quiet-scroll mt-3 flex min-h-0 flex-1 flex-col space-y-1.5">
                  {syncingNow.map((t) => (
                    <div key={t.jobId} className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px]">{t.fileName || t.jobId.slice(0, 8)}</span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-mocha-gold">{Math.round(t.percent || 0)}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full bg-mocha-gold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${Math.min(100, t.percent || 0)}%` }} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-mocha-muted">{t.speedBps ? formatSpeed(t.speedBps) : ""}</div>
                    </div>
                  ))}
                  {syncingNow.length === 0 && (
                    <div className="flex flex-1 items-center justify-center py-8 text-center font-serif text-xl italic text-mocha-muted">Everything is in sync.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div key={tab} className="bezel-shell reveal-fade mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core files-scroll flex min-h-0 flex-1 flex-col space-y-2 p-3">
              {activeTransfers.map((t) => (
                <TransferRow key={t.jobId} t={t} onCancel={(id) => void cancelTransfer(id)} />
              ))}
              {activeTransfers.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center font-serif text-xl italic text-mocha-secondary">No transfers yet</div>
              )}
            </div>
          </div>
        )}

        {tab === "trash" && (
          <div key={tab} className="bezel-shell reveal-fade mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core files-scroll flex min-h-0 flex-1 flex-col space-y-1.5 p-2">
              <div className="flex shrink-0 items-center justify-between px-3 pb-2 pt-2">
                <span className="text-[13px] text-mocha-secondary">{trash.length === 0 ? "Trash is empty" : `${trash.length} deleted file${trash.length === 1 ? "" : "s"}`}</span>
                {trash.length > 0 && (
                  <button onClick={() => api.clearTrash().then(() => refreshTrash()).catch((e) => setNotice(e instanceof Error ? e.message : "Empty failed"))} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-200">Empty trash</button>
                )}
              </div>
              {trashLoading && <div className="px-4 py-6 text-center font-mono text-xs tracking-widest text-mocha-muted">LOADING TRASH</div>}
              {trash.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.original_name}</div>
                    <div className="mt-1 font-mono text-[11px] text-mocha-muted">{formatBytes(t.size)} {"·"} {t.path} {"·"} {t.deleted_at ? formatDate(t.deleted_at) : ""}</div>
                  </div>
                  <button onClick={() => api.deleteTrashItem(t.id).then(() => refreshTrash()).catch((e) => setNotice(e instanceof Error ? e.message : "Delete failed"))} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-200">Delete</button>
                </div>
              ))}
              {trash.length === 0 && !trashLoading && (
                <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center font-serif text-xl italic text-mocha-secondary">Nothing in trash</div>
              )}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div key={tab} className="bezel-shell reveal-fade mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core quiet-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Sync behavior</div>
              <SettingRow
                title="Drain in-flight on pause"
                desc="On: finish current files, then pause. Off: cancel them."
                checked={(settings?.pauseMode || "drain") === "drain"}
                onChange={(v) => updateSettings({ pauseMode: v ? "drain" : "cancel" })}
              />
              <SettingRow
                title="Bidirectional sync"
                desc="Download remote changes. Size-based compare, same-size edits may not download."
                checked={!!settings?.bidirectionalSync}
                onChange={(v) => updateSettings({ bidirectionalSync: v })}
              />
              <SettingRow
                title="Remote wins conflicts"
                desc="On: download overwrites local. Off: skip on conflict."
                checked={settings?.conflictPolicy === "local-wins"}
                onChange={(v) => updateSettings({ conflictPolicy: v ? "local-wins" : "skip" })}
              />
              {menuSupported && (
                <SettingRow
                  title="Quick Share context menu"
                  desc="Windows right-click entry that uploads the selected file and copies a share link."
                  checked={!!settings?.contextMenu}
                  onChange={(v) => updateSettings({ contextMenu: v })}
                />
              )}
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Global ignore patterns (one per line)</div>
              <textarea value={settingsDraft} onChange={(e) => setSettingsDraft(e.target.value)} rows={6} placeholder={".git/\nnode_modules/\n.DS_Store\n*.tmp"} className="field mt-2 w-full rounded-2xl px-4 py-3 font-mono text-xs" />
              <div>
                <button onClick={() => void saveSettings()} disabled={settingsBusy} className="glass-button btn-gold rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-60">{settingsBusy ? "Saving" : "Save settings"}</button>
              </div>
            </div>
          </div>
        )}

      </main>

      {modal && (
        <ModalShell shellClassName="w-full max-w-sm" onClose={() => { setModal(null); setModalValue(""); }}>
          {(close) => (
            <div className="bezel-core space-y-3 p-4">
              <div className="font-serif text-lg italic">{modal.kind === "mkdir" ? "New folder" : modal.kind === "renameFile" ? "Rename file" : modal.kind === "renameFolder" ? "Rename folder" : modal.kind.startsWith("move") ? "Move to path" : "Rename"}</div>
              {(modal.kind === "moveFile" || modal.kind === "moveFolder") && <p className="font-mono text-[11px] text-mocha-muted">Destination folder path, e.g. /photos/</p>}
              <input value={modalValue} onChange={(e) => setModalValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitModal(close); }} autoFocus placeholder={modal.kind === "mkdir" ? "Folder name" : "Name"} className="field w-full rounded-2xl px-4 py-3 text-sm" />
              <div className="flex gap-2">
                <button onClick={() => void submitModal(close)} disabled={modalBusy} className="glass-button btn-gold flex-1 rounded-full py-2 text-sm font-semibold disabled:opacity-60">{modalBusy ? "Saving" : "Confirm"}</button>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {shareFile && (
        <ShareModal
          file={shareFile}
          appUrl={appUrl}
          onClose={() => setShareFile(null)}
          onCreated={() => { void api.shares().then((sh) => setShares(sh)).catch(() => undefined); }}
        />
      )}

      {archiveFile && (
        <ModalShell label={`Browse ${archiveFile.original_name}`} shellClassName="w-full max-w-lg" onClose={() => setArchiveFile(null)}>
          {(close) => (
            <div className="bezel-core flex max-h-[70dvh] flex-col p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate font-serif text-lg italic">{archiveFile.original_name}</div>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Close</button>
              </div>
              <div className="quiet-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {archiveLoading && <div className="py-6 text-center font-mono text-xs tracking-widest text-mocha-muted">LOADING ARCHIVE</div>}
                {!archiveLoading && archiveEntries.map((en) => (
                  <div key={en.path} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{en.path}</div>
                      <div className="font-mono text-[11px] text-mocha-muted">{en.isDirectory ? "folder" : formatBytes(en.fileSize)}</div>
                    </div>
                    {!en.isDirectory && (
                      <button onClick={() => api.extractArchive(archiveFile.id, en.path, en.fileName).then((d) => setNotice("Extracted " + d)).catch((e) => setNotice(e instanceof Error ? e.message : "Extract failed"))} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Save</button>
                    )}
                  </div>
                ))}
                {!archiveLoading && archiveEntries.length === 0 && (
                  <div className="py-6 text-center font-serif text-lg italic text-mocha-muted">No entries found</div>
                )}
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {overwrite && (
        <ModalShell shellClassName="w-full max-w-sm" onClose={() => setOverwrite(null)}>
          {(close) => (
            <div className="bezel-core space-y-3 p-4">
              <div className="font-serif text-lg italic">File already exists</div>
              <p className="break-all font-mono text-[11px] text-mocha-muted">{overwrite.dest}</p>
              <div className="flex gap-2">
                <button onClick={() => void confirmOverwrite(close)} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 flex-1 py-2 text-sm text-red-200">Overwrite</button>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {ignoreEditor && (
        <ModalShell shellClassName="w-full max-w-sm" onClose={() => setIgnoreEditor(null)}>
          {(close) => (
            <div className="bezel-core space-y-3 p-4">
              <div className="font-serif text-lg italic">Ignore rules</div>
              <p className="break-all font-mono text-[11px] text-mocha-muted">{ignoreEditor}</p>
              <textarea value={ignoreDraft} onChange={(e) => setIgnoreDraft(e.target.value)} rows={5} placeholder={"*.log\nbuild/"} className="field w-full rounded-2xl px-4 py-3 font-mono text-xs" />
              <div className="flex gap-2">
                <button onClick={() => void saveIgnoreEditor(close)} disabled={ignoreBusy} className="glass-button btn-gold flex-1 rounded-full py-2 text-sm font-semibold disabled:opacity-60">{ignoreBusy ? "Saving" : "Save"}</button>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {previewFile && (
        <Preview
          file={previewFile}
          url={previewUrl}
          loading={previewUrlLoading}
          error={previewUrlError}
          position={(() => {
            const idx = previewableFiles.findIndex((f) => f.id === previewFile.id);
            return idx >= 0 ? `${idx + 1} / ${previewableFiles.length}` : null;
          })()}
          hasPrev={previewableFiles.length > 1}
          hasNext={previewableFiles.length > 1}
          onClose={closePreview}
          onPrev={() => navigatePreview("prev")}
          onNext={() => navigatePreview("next")}
          onDownload={() => void downloadFile(previewFile)}
        />
      )}
    </div>
  );
}
