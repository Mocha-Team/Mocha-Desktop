import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EventsOff, EventsOn } from "../wailsjs/runtime/runtime";
import { api, copyText, folderName, formatBytes, formatDate, formatTime, isPreviewable, parseLines, type AppSettings, type ArchiveEntry, type FileItem, type PairFile, type Profile, type RemotePickFile, type RemoveSyncPreview, type RemoveSyncResult, type Share, type Status, type StorageInfo, type SyncConflict, type SyncFolder, type TransferProgress, type TrashItem, type UpdateCheck } from "./lib";
import { useRevealRoot } from "./hooks";
import { Titlebar } from "./Titlebar";
import { Flyout } from "./Flyout";
import { Preview } from "./Preview";
import { SettingRow } from "./Toggle";
import { TransferRow } from "./components/TransferPanel";
import { ArrowIcon, CaretIcon, FolderGlyph } from "./components/icons";
import { FilesTab } from "./components/FilesTab";
import { ModalShell } from "./components/ModalShell";
import { ShareModal } from "./components/ShareModal";
import { Startup } from "./components/Startup";
import { Welcome } from "./components/Welcome";
import { UpdateBanner } from "./components/UpdateBanner";
import { ToastStack, type Notice, type NoticeTone } from "./components/Toasts";

type Tab = "files" | "shares" | "sync" | "activity" | "trash" | "settings";

let noticeSeq = 0;

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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardStepDir, setWizardStepDir] = useState(1);
  const [wizardSource, setWizardSource] = useState<"local" | "remote">("local");
  const [wizardDirection, setWizardDirection] = useState("upload-only");
  const [wizardRemotePath, setWizardRemotePath] = useState("/");
  const [wizardRemoteFiles, setWizardRemoteFiles] = useState<RemotePickFile[]>([]);
  const [wizardRemoteChecked, setWizardRemoteChecked] = useState<Set<string>>(new Set());
  const [wizardRemoteLoading, setWizardRemoteLoading] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardKeepLocal, setWizardKeepLocal] = useState(true);
  const [pins, setPins] = useState<Record<string, Record<string, string>>>({});
  const [syncDetails, setSyncDetails] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Record<string, SyncConflict[]>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const notify = useCallback((text: string, tone: NoticeTone = "info") => {
    const id = ++noticeSeq;
    setNotices((list) => [...list, { id, text, tone }].slice(-3));
  }, []);

  const fail = useCallback((e: unknown, fallback: string) => {
    notify(e instanceof Error ? e.message : fallback, "error");
  }, [notify]);

  const dismissNotice = useCallback((id: number) => setNotices((list) => list.filter((n) => n.id !== id)), []);

  const [updateInfo, setUpdateInfo] = useState<UpdateCheck | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const appUrl = "https://mocha.my";
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
  const [startupSupported, setStartupSupported] = useState(true);
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
    api.appVersion().then(setAppVersion).catch(() => undefined);
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
        notify(msg, "error");
      }
    } catch (e) {
      if (filesReq.current !== req) return;
      fail(e, "Refresh failed");
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
      fail(err, "Load more failed");
    } finally {
      if (filesReq.current === req) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, path, cursor, query]);

  const refreshTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      setTrash(await api.trash());
    } catch (err) {
      fail(err, "Trash failed");
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

  async function manualUpdateCheck() {
    setUpdateError(null);
    try {
      const res = await api.checkForUpdates();
      if (res?.available) {
        setUpdateInfo(res);
        setUpdateProgress(null);
      } else {
        notify("Mocha is up to date");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update check failed";
        notify(msg.includes("no update for") ? "Updates are not available for this platform" : msg, "error");
    }
  }

  async function applyUpdate() {
    if (!updateInfo?.asset || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    try {
      const dest = await api.downloadAndApplyUpdate(updateInfo.asset.url, updateInfo.asset.sha256, updateInfo.asset.name);
      setUpdateInfo(null);
      setUpdateProgress(null);
      setUpdateBusy(false);
      notify(typeof dest === "string" && dest ? `Update ready: ${dest}` : "Update applied, restart to finish");
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Update failed");
      setUpdateBusy(false);
    }
  }

  useEffect(() => {
    const started = Date.now();
    let timer = 0;
    void refreshStatus().finally(() => {
      timer = window.setTimeout(() => setBooted(true), Math.max(0, 2400 - (Date.now() - started)));
    });
    api.checkForUpdates()
      .then((res) => {
        if (res?.available) {
          setUpdateInfo(res);
          setUpdateProgress(null);
          setUpdateError(null);
        }
      })
      .catch(() => undefined);
    api.supportsContextMenu().then(setMenuSupported).catch(() => setMenuSupported(false));
    api.supportsLaunchAtStartup().then(setStartupSupported).catch(() => setStartupSupported(false));
    return () => window.clearTimeout(timer);
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
    EventsOn("auth:revoked", () => {
      void refreshStatus();
      notify("This computer was signed out from the web", "error");
    });
    EventsOn("tray:flyout", () => {
      setView("flyout");
      void refreshSync();
    });
    EventsOn("tray:full", () => {
      setView("full");
    });
    EventsOn("update:progress", (p: { loaded: number; total: number }) => {
      if (p.total > 0) setUpdateProgress(Math.round((p.loaded / p.total) * 100));
    });
    EventsOn("update:error", (p: { error: string }) => {
      setUpdateError(p.error || "Update failed");
      setUpdateBusy(false);
    });
    EventsOn("update:applied", (p: { path: string }) => {
      setUpdateInfo(null);
      setUpdateProgress(null);
      setUpdateBusy(false);
      notify(p?.path ? `Update ready: ${p.path}` : "Update applied, restart to finish");
    });
    return () => {
      for (const e of ["upload:progress", "download:progress", "sync:status", "auth:revoked", "tray:flyout", "tray:full", "update:progress", "update:error", "update:applied"]) EventsOff(e);
    };
  }, [refreshStatus, refreshSync]);

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
      notify("Connected to Mocha", "success");
    } catch (err) {
      fail(err, "Connection failed");
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
        notify(`Uploaded ${jobs.length} files in parallel`, "success");
      }
    } catch (err) {
      fail(err, "Upload failed");
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
      fail(err, "Delete failed");
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
      notify("Saved " + file.original_name, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      if (msg.startsWith("exists:")) {
        const dest = msg.slice("exists:".length);
        setOverwrite({ file, dest, size: 0 });
        notify("File exists - confirm overwrite");
        return;
      }
      notify(msg, "error");
    }
  }

  async function confirmOverwrite(close: () => void) {
    if (!overwrite) return;
    try {
      await api.downloadToPath(overwrite.file.id, overwrite.dest, true);
      notify("Saved " + overwrite.file.original_name, "success");
    } catch (e) {
      fail(e, "Download failed");
    } finally {
      close();
    }
  }

  async function cancelTransfer(jobId: string) {
    try {
      await api.cancelTransfer(jobId);
      notify("Transfer cancelled");
    } catch (e) {
      fail(e, "Cancel failed");
    }
  }

  async function submitModal(close: () => void) {
    if (!modal || modalBusy) return;
    const value = modalValue.trim();
    if (!value) {
      notify("Name required");
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
      fail(err, "Operation failed");
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
      fail(err, "Archive unavailable");
    } finally {
      setArchiveLoading(false);
    }
  }

  async function bulkDownload() {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      notify("Select files first");
      return;
    }
    try {
      const dest = await api.bulkDownload(ids, []);
      notify("Saved " + dest, "success");
    } catch (err) {
      fail(err, "Bulk download failed");
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
      fail(err, "Pause failed");
    }
  }

  async function rescanPair(pairId: string) {
    try {
      await api.rescanPair(pairId);
      await refreshSync();
    } catch (err) {
      fail(err, "Sync failed");
    }
  }

  async function dismissPairError(pairId: string) {
    try {
      await api.clearSyncError(pairId);
      await refreshSync();
    } catch (err) {
      fail(err, "Clear failed");
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
      notify("Ignore rules saved", "success");
    } catch (err) {
      fail(err, "Save failed");
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
      fail(err, "Save failed");
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
      if (await persistSettings(next)) notify("Settings saved", "success");
  }

  function wizardDirectionLabel(v: string): string {
    if (v === "download-only") return "Get from Mocha";
    if (v === "mirror") return "Keep both in sync";
    return "Send to Mocha";
  }

  function openWizard() {
    setWizardStepDir(1);
    setWizardStep(1);
    setWizardSource("local");
    setWizardDirection("upload-only");
    setWizardRemotePath("/");
    setWizardRemoteFiles([]);
    setWizardRemoteChecked(new Set());
    setWizardKeepLocal(true);
    setWizardBusy(false);
    setWizardOpen(true);
  }

  function pickWizardSource(s: "local" | "remote") {
    setWizardSource(s);
    setWizardDirection(s === "remote" ? "mirror" : "upload-only");
    setWizardRemoteFiles([]);
    setWizardRemoteChecked(new Set());
  }

  function pairKeyFor(f: SyncFolder): string {
    return (f.pairId || f.path || "").toLowerCase();
  }

  function pairFiles(f: SyncFolder): PairFile[] {
    const key = pairKeyFor(f);
    const m = pins[key] || {};
    const rels = new Set<string>([...Object.keys(m), ...(f.queued || [])]);
    return [...rels].sort().map((rel) => ({ rel, pin: m[rel] || "keep" }));
  }

  async function changeDirection(pairId: string, direction: string) {
    try {
      await api.setPairDirection(pairId, direction);
      await refreshSync();
    } catch (err) {
      fail(err, "Direction failed");
    }
  }

  async function toggleDetails(pairId: string) {
    const open = new Set(syncDetails);
    if (open.has(pairId)) {
      open.delete(pairId);
      setSyncDetails(open);
      return;
    }
    try {
      const m = await api.getFilePins(pairId);
      setPins((p) => ({ ...p, [pairId]: m || {} }));
    } catch {
      setPins((p) => ({ ...p, [pairId]: p[pairId] || {} }));
    }
    try {
      const list = await api.listConflicts(pairId);
      setConflicts((c) => ({ ...c, [pairId]: list || [] }));
    } catch {
      setConflicts((c) => ({ ...c, [pairId]: c[pairId] || [] }));
    }
    open.add(pairId);
    setSyncDetails(open);
  }

  async function togglePin(pairId: string, rel: string, current: string) {
    try {
      await api.setFilePin(pairId, rel, current === "cloud" ? "keep" : "cloud");
      const m = await api.getFilePins(pairId);
      setPins((p) => ({ ...p, [pairId]: m || {} }));
    } catch (err) {
      fail(err, "Pin failed");
    }
  }

  async function loadConflictsFor(pairId: string) {
    try {
      const list = await api.listConflicts(pairId);
      setConflicts((c) => ({ ...c, [pairId]: list || [] }));
    } catch (err) {
      fail(err, "Conflicts failed");
    }
  }

  async function resolveFor(pairId: string, rel: string, choice: string) {
    try {
      await api.resolveConflict(pairId, rel, choice);
      const list = await api.listConflicts(pairId);
      setConflicts((c) => ({ ...c, [pairId]: list || [] }));
    } catch (err) {
      fail(err, "Resolve failed");
    }
  }

  async function loadWizardRemote() {
    const target = wizardRemotePath.trim() || "/";
    setWizardRemoteLoading(true);
    try {
      const list = await api.listRemoteForAttach(target);
      setWizardRemoteFiles(list || []);
      setWizardRemoteChecked(new Set((list || []).map((r) => r.rel)));
    } catch (err) {
      fail(err, "Remote list failed");
    } finally {
      setWizardRemoteLoading(false);
    }
  }

  function toggleWizardRemoteCheck(rel: string) {
    setWizardRemoteChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }

  function toggleAllWizardRemote() {
    setWizardRemoteChecked((prev) => {
      if (prev.size === wizardRemoteFiles.length) return new Set<string>();
      return new Set(wizardRemoteFiles.map((r) => r.rel));
    });
  }

  function wizardCanNext(): boolean {
    if (wizardStep === 2 && wizardSource === "remote") return wizardRemotePath.trim().length > 0;
    if (wizardStep === 4 && wizardSource === "remote") return wizardRemoteChecked.size > 0;
    return true;
  }

  const wizardSteps = wizardSource === "local" ? ["source", "direction", "keep", "review"] : ["source", "folder", "direction", "files", "review"];
  const wizardStage = wizardSteps[wizardStep - 1] ?? wizardSteps[0];

  async function startWizardSync(close: () => void) {
    if (wizardBusy) return;
    if (wizardSource === "remote" && wizardRemoteChecked.size === 0) {
      notify("Pick at least one file to keep");
      return;
    }
    setWizardBusy(true);
    try {
      if (wizardSource === "remote") {
        await api.addSyncFolderRemote(wizardRemotePath.trim() || "/", [...wizardRemoteChecked], wizardDirection);
      } else {
        await api.addSyncFolderLocal(wizardDirection);
      }
      close();
      setWizardOpen(false);
      setWizardRemoteFiles([]);
      setWizardRemoteChecked(new Set());
      setWizardStepDir(1);
      setWizardStep(1);
      const s = await refreshStatus();
      setStatus(s);
      await refreshSync();
    } catch (err) {
      fail(err, "Could not start sync");
    } finally {
      setWizardBusy(false);
    }
  }

  async function removeFolder(folderPath: string) {
    setRemovePreview(null);
    setConfirmRemove(folderPath);
  }

  async function previewDeleteFiles(folderPath: string) {
    setPreviewLoading(true);
    try {
      let preview: RemoveSyncPreview;
      try {
        preview = await api.previewRemovePair(folderPath);
      } catch {
        preview = await api.previewRemoveSyncFolder(folderPath);
      }
      setRemovePreview({ path: folderPath, preview });
    } catch (err) {
      fail(err, "Could not preview files");
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
      let result: RemoveSyncResult;
      try {
        result = await api.removePair(folderPath, true);
      } catch {
        result = await api.removeSyncFolderAndFiles(folderPath);
      }
      const parts = [`${result.deleted} deleted`];
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.skipped > 0) parts.push(`${result.skipped} not matched, delete manually`);
      await finishRemoveFolder(folderPath, `Stopped sync (${parts.join(", ")})`);
    } catch (err) {
      fail(err, "Could not remove folder");
    } finally {
      setRemoving(false);
    }
  }

  async function finishRemoveFolder(folderPath: string, message: string | null) {
    if (message === null) {
      setRemoving(true);
      try {
        try {
          await api.removePair(folderPath, false);
        } catch {
          await api.removeSyncFolder(folderPath);
        }
        notify("Stopped sync, uploaded files kept");
      } catch (err) {
        fail(err, "Could not remove folder");
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

  const activeTransfers = useMemo(() => Object.values(transfers).slice(-6).reverse(), [transfers]);

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
          <Startup />
        </div>
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--background)] px-4 pb-4 text-mocha-primary">
        <Titlebar />
        <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden pt-9">
          <Welcome
            apiKey={apiKey}
            onApiKey={setApiKey}
            busy={busy}
            onConnect={connect}
          />
        </main>
        <ToastStack notices={notices} onDismiss={dismissNotice} />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--background)] px-4 pb-4 text-mocha-primary">
      <Titlebar />

      <header className="nav-enter fixed left-1/2 top-[52px] z-30 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
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
        <div className="rise-in flex shrink-0 flex-wrap items-center justify-between gap-4">
          <div>
            {tab === "files" && path !== "/" && (
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-mocha-muted">
                {crumbs.map((c, i) => (
                  <span key={c.value} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} className="file-row-in flex items-center gap-1">
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

        {updateInfo?.available && (
          <UpdateBanner
            info={updateInfo}
            progress={updateProgress}
            error={updateError}
            busy={updateBusy}
            onUpdate={() => void applyUpdate()}
            onDismiss={() => setUpdateInfo(null)}
          />
        )}
        {tab === "files" && (
          <div key={tab + path} className="tab-panel-in flex min-h-0 flex-1 flex-col overflow-hidden">
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
          <div key={tab} className="bezel-shell tab-panel-in mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core files-scroll flex min-h-0 flex-1 flex-col space-y-1.5 p-2">
              {shares.map((s, i) => (
                <div key={s.token} style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }} className="file-row-in card-hover flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                   <div className="min-w-0 flex-1">
                     <div className="truncate text-sm font-medium">{s.original_name || s.folder_path || "Folder share"}</div>
                     <div className="mt-1 font-mono text-[11px] text-mocha-muted">/{s.token} {"·"} {s.download_count} downloads {"·"} {s.password_protected ? "locked" : "open"}</div>
                   </div>
                  <button onClick={() => { void copyText(`https://mocha.my/share/${s.token}`).then((ok) => notify(ok ? "Link copied" : s.token, ok ? "success" : "info")); }} className="glass-button btn-ghost rounded-full px-4 py-2 text-xs">Copy</button>
                  <button onClick={() => api.deleteShare(s.token).then(() => refreshData())} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-200">Revoke</button>
                </div>
              ))}
              {shares.length === 0 && (
                <div className="empty-in flex flex-1 flex-col items-center justify-center px-6 py-10 text-center font-serif text-xl italic text-mocha-secondary">No share links yet</div>
              )}
            </div>
          </div>
        )}

        {tab === "sync" && (
          <div key={tab} className="bezel-shell tab-panel-in mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core flex min-h-0 flex-1 flex-col p-2">
              <div className="rise-in flex shrink-0 items-center justify-between px-3 pb-2 pt-2">
                <span className="text-[13px] text-mocha-secondary">
                  {syncFolders.length === 0 ? "No folders watched" : `${syncFolders.length} folder${syncFolders.length === 1 ? "" : "s"}`}
                </span>
                <button onClick={openWizard} className="glass-button btn-gold group flex items-center gap-2 rounded-full py-1 pl-4 pr-1 text-[13px] font-semibold active:scale-[0.98]">
                  Add sync
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/10 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110"><ArrowIcon /></span>
                </button>
              </div>
              <div className="files-scroll flex min-h-0 flex-1 flex-col space-y-1.5 p-1.5">
                {syncFolders.map((f, idx) => {
                  const key = pairKeyFor(f);
                  const paused = !!(f.paused || f.status === "paused");
                  const statusText = paused ? "Paused" : f.status === "scanning" ? "Scanning" : f.status === "syncing" ? (f.pending > 0 ? `${f.pending} left` : "Syncing") : f.status === "error" ? "Needs attention" : "Up to date";
                  const details = syncDetails.has(key);
                  const folderConflicts = conflicts[key] || [];
                  return (
                    <div key={f.path} style={{ animationDelay: `${Math.min(idx, 10) * 55}ms` }} className="file-row-in card-hover rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FolderGlyph />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{folderName(f.path)}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-mocha-muted">{f.path}{f.pending > 0 ? ` · ${f.pending} waiting` : ""}{f.files > 0 ? ` · ${f.files} files` : ""}{f.lastSync > 0 ? ` · synced ${formatTime(f.lastSync)}` : ""}</div>
                        </div>
                        <span className={`shrink-0 font-mono text-[11px] ${f.status === "error" ? "text-red-300" : f.status === "idle" ? "text-mocha-muted" : "text-mocha-gold"}`}>{statusText}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select value={f.direction || "upload-only"} onChange={(e) => void changeDirection(key, e.target.value)} className="field rounded-full px-2 py-1 font-mono text-[11px]">
                          <option value="upload-only">Send to Mocha</option>
                          <option value="download-only">Get from Mocha</option>
                          <option value="mirror">Keep in sync</option>
                        </select>
                        <button onClick={() => void rescanPair(key)} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1.5 text-xs">Sync now</button>
                        <button onClick={() => void togglePause(key, paused)} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1.5 text-xs">{paused ? "Resume" : "Pause"}</button>
                        <button onClick={() => void toggleDetails(key)} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1.5 text-xs">{details ? "Hide" : "Details"}</button>
                        <button onClick={() => removeFolder(key)} className="glass-button shrink-0 rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200">Remove</button>
                      </div>
                      {f.status === "syncing" && f.current && (
                        <div className="mt-2.5">
                          <div className="flex items-center justify-between font-mono text-[11px] text-mocha-muted">
                            <span className="truncate">{f.current}</span>
                            <span className="ml-2 shrink-0 tabular-nums">{Math.round(f.progress || 0)}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5 progress-sheen">
                            <div className="h-full rounded-full bg-mocha-gold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ width: `${Math.min(100, f.progress || 0)}%` }} />
                          </div>
                        </div>
                      )}
                      {f.status === "error" && f.error && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-red-300">{f.error}</div>
                          <button onClick={() => void dismissPairError(key)} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1 text-[11px]">Dismiss</button>
                        </div>
                      )}
                      {details && (
                        <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => void openIgnoreEditor(f.path)} className="glass-button btn-ghost rounded-full px-3 py-1 text-[11px]">Ignore rules</button>
                            <button onClick={() => void loadConflictsFor(key)} className="glass-button btn-ghost rounded-full px-3 py-1 text-[11px]">Check conflicts{folderConflicts.length > 0 ? ` (${folderConflicts.length})` : ""}</button>
                          </div>
                          {folderConflicts.length > 0 && (
                            <div className="space-y-1">
                              {folderConflicts.map((c) => (
                                <div key={c.rel} className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                                  <span className="truncate text-mocha-secondary">{c.rel}</span>
                                  <span className="flex gap-1">
                                    <button onClick={() => void resolveFor(key, c.rel, "keep-local")} className="glass-button btn-ghost rounded-full px-2 py-1 text-[11px]">Keep local</button>
                                    <button onClick={() => void resolveFor(key, c.rel, "keep-remote")} className="glass-button btn-ghost rounded-full px-2 py-1 text-[11px]">Keep remote</button>
                                    <button onClick={() => void resolveFor(key, c.rel, "keep-both")} className="glass-button btn-ghost rounded-full px-2 py-1 text-[11px]">Keep both</button>
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="space-y-1">
                            {pairFiles(f).slice(0, 20).map((pf) => (
                              <div key={pf.rel} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                                <span className="truncate text-mocha-muted">{pf.rel}</span>
                                <button onClick={() => void togglePin(key, pf.rel, pf.pin)} className="glass-button btn-ghost shrink-0 rounded-full px-3 py-1 text-[11px]">{pf.pin === "cloud" ? "Cloud" : "Keep"}</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {confirmRemove === key && !removePreview && (
                        <div className="notice-in mt-2.5 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                          <div className="font-serif text-[15px] italic text-mocha-secondary">Stop syncing this folder?</div>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <button disabled={removing || previewLoading} onClick={() => keepOnlyFolder(key)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs disabled:opacity-50">Keep files</button>
                            <button disabled={removing || previewLoading} onClick={() => previewDeleteFiles(key)} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50">{previewLoading ? "Checking..." : "Delete files too"}</button>
                            <button disabled={removing || previewLoading} onClick={() => { setRemovePreview(null); setConfirmRemove(null); }} className="glass-button rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-muted disabled:opacity-50">Cancel</button>
                          </div>
                        </div>
                      )}
                      {removePreview && removePreview.path === key && (
                        <div className="notice-in mt-2.5 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2.5">
                          <div className="font-serif text-[15px] italic text-mocha-secondary">Delete {removePreview.preview.matched} file{removePreview.preview.matched === 1 ? "" : "s"} from the server?</div>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {removePreview.preview.matched > 0 && (
                              <button disabled={removing} onClick={() => executeDeleteFiles(key)} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs text-red-200 disabled:opacity-50">Delete</button>
                            )}
                            <button disabled={removing} onClick={() => keepOnlyFolder(key)} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs disabled:opacity-50">Keep files</button>
                            <button disabled={removing} onClick={() => { setRemovePreview(null); setConfirmRemove(null); }} className="glass-button rounded-full px-3 py-1.5 font-mono text-[11px] text-mocha-muted disabled:opacity-50">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {syncFolders.length === 0 && (
                  <div className="empty-in flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="font-serif text-2xl italic text-mocha-secondary">No watched folders</div>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-mocha-muted">Add a folder and everything inside it uploads automatically.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div key={tab} className="bezel-shell tab-panel-in mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core files-scroll flex min-h-0 flex-1 flex-col space-y-2 p-3">
              {activeTransfers.map((t, i) => (
                <div key={t.jobId} style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }} className="file-row-in">
                  <TransferRow t={t} onCancel={(id) => void cancelTransfer(id)} />
                </div>
              ))}
              {activeTransfers.length === 0 && (
                <div className="empty-in flex flex-1 flex-col items-center justify-center px-6 py-10 text-center font-serif text-xl italic text-mocha-secondary">No transfers yet</div>
              )}
            </div>
          </div>
        )}

        {tab === "trash" && (
          <div key={tab} className="bezel-shell tab-panel-in mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core files-scroll flex min-h-0 flex-1 flex-col space-y-1.5 p-2">
              <div className="rise-in flex shrink-0 items-center justify-between px-3 pb-2 pt-2">
                <span className="text-[13px] text-mocha-secondary">{trash.length === 0 ? "Trash is empty" : `${trash.length} deleted file${trash.length === 1 ? "" : "s"}`}</span>
                {trash.length > 0 && (
                  <button onClick={() => api.clearTrash().then(() => refreshTrash()).catch((e) => fail(e, "Empty failed"))} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-200">Empty trash</button>
                )}
              </div>
              {trashLoading && <div className="flex flex-col gap-2 px-2 py-2"><div className="skeleton-shimmer h-14 rounded-xl" /><div className="skeleton-shimmer h-14 rounded-xl" style={{ animationDelay: "120ms" }} /></div>}
              {trash.map((t, i) => (
                <div key={t.id} style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }} className="file-row-in card-hover flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.original_name}</div>
                    <div className="mt-1 font-mono text-[11px] text-mocha-muted">{formatBytes(t.size)} {"·"} {t.path} {"·"} {t.deleted_at ? formatDate(t.deleted_at) : ""}</div>
                  </div>
                  <button onClick={() => api.deleteTrashItem(t.id).then(() => refreshTrash()).catch((e) => fail(e, "Delete failed"))} className="glass-button rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-200">Delete</button>
                </div>
              ))}
              {trash.length === 0 && !trashLoading && (
                <div className="empty-in flex flex-1 flex-col items-center justify-center px-6 py-10 text-center font-serif text-xl italic text-mocha-secondary">Nothing in trash</div>
              )}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div key={tab} className="bezel-shell tab-panel-in mt-5 flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="bezel-core quiet-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
              <div className="rise-in font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Sync behavior</div>
              <div className="rise-in" style={{ animationDelay: "60ms" }}>
              <SettingRow
                title="Drain in-flight on pause"
                desc="On: finish current files, then pause. Off: cancel them."
                checked={(settings?.pauseMode || "drain") === "drain"}
                onChange={(v) => updateSettings({ pauseMode: v ? "drain" : "cancel" })}
              />
              </div>
              <div className="rise-in" style={{ animationDelay: "110ms" }}>
              <SettingRow
                title="Remote wins conflicts"
                desc="On: download overwrites local. Off: skip on conflict."
                checked={settings?.conflictPolicy === "remote-wins"}
                onChange={(v) => updateSettings({ conflictPolicy: v ? "remote-wins" : "skip" })}
              />
              </div>
              {menuSupported && (
                <div className="rise-in" style={{ animationDelay: "210ms" }}>
                <SettingRow
                  title="Quick Share context menu"
                  desc="Windows right-click entry that uploads the selected file and copies a share link."
                  checked={!!settings?.contextMenu}
                  onChange={(v) => updateSettings({ contextMenu: v })}
                />
                </div>
              )}
              {startupSupported && (
                <div className="rise-in" style={{ animationDelay: "260ms" }}>
                <SettingRow
                  title="Launch at startup"
                  desc="Start Mocha Desktop in the tray when you sign in."
                  checked={!!settings?.launchAtStartup}
                  onChange={(v) => updateSettings({ launchAtStartup: v })}
                />
                </div>
              )}
              <div className="rise-in mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted" style={{ animationDelay: "300ms" }}>Updates</div>
              <div className="rise-in flex flex-wrap items-center justify-between gap-2" style={{ animationDelay: "340ms" }}>
                <span className="font-mono text-[11px] text-mocha-secondary">{appVersion ? `Version ${appVersion}` : "Version unknown"}</span>
                <button onClick={() => void manualUpdateCheck()} className="glass-button btn-ghost rounded-full px-4 py-2 text-xs">Check for updates</button>
              </div>
              <div className="rise-in mt-2 font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted" style={{ animationDelay: "380ms" }}>Global ignore patterns (one per line)</div>
              <textarea value={settingsDraft} onChange={(e) => setSettingsDraft(e.target.value)} rows={6} placeholder={".git/\nnode_modules/\n.DS_Store\n*.tmp"} className="field rise-in mt-2 w-full shrink-0 rounded-2xl px-4 py-3 font-mono text-xs" style={{ animationDelay: "420ms" }} />
              <div className="rise-in" style={{ animationDelay: "460ms" }}>
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
              <div className="rise-in font-serif text-lg italic">{modal.kind === "mkdir" ? "New folder" : modal.kind === "renameFile" ? "Rename file" : modal.kind === "renameFolder" ? "Rename folder" : modal.kind.startsWith("move") ? "Move to path" : "Rename"}</div>
              {(modal.kind === "moveFile" || modal.kind === "moveFolder") && <p className="rise-in font-mono text-[11px] text-mocha-muted" style={{ animationDelay: "60ms" }}>Destination folder path, e.g. /photos/</p>}
              <input value={modalValue} onChange={(e) => setModalValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitModal(close); }} autoFocus placeholder={modal.kind === "mkdir" ? "Folder name" : "Name"} className="field rise-in w-full rounded-2xl px-4 py-3 text-sm" style={{ animationDelay: "110ms" }} />
              <div className="rise-in flex gap-2" style={{ animationDelay: "160ms" }}>
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
              <div className="rise-in flex items-center justify-between gap-3">
                <div className="truncate font-serif text-lg italic">{archiveFile.original_name}</div>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Close</button>
              </div>
              <div className="quiet-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {archiveLoading && <div className="flex flex-col gap-2 py-2"><div className="skeleton-shimmer h-12 rounded-xl" /><div className="skeleton-shimmer h-12 rounded-xl" /></div>}
                {!archiveLoading && archiveEntries.map((en, i) => (
                  <div key={en.path} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }} className="file-row-in card-hover flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{en.path}</div>
                      <div className="font-mono text-[11px] text-mocha-muted">{en.isDirectory ? "folder" : formatBytes(en.fileSize)}</div>
                    </div>
                    {!en.isDirectory && (
                      <button onClick={() => api.extractArchive(archiveFile.id, en.path, en.fileName).then((d) => notify("Extracted " + d, "success")).catch((e) => fail(e, "Extract failed"))} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Save</button>
                    )}
                  </div>
                ))}
                {!archiveLoading && archiveEntries.length === 0 && (
                  <div className="empty-in py-6 text-center font-serif text-lg italic text-mocha-muted">No entries found</div>
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
              <div className="rise-in font-serif text-lg italic">File already exists</div>
              <p className="rise-in break-all font-mono text-[11px] text-mocha-muted" style={{ animationDelay: "60ms" }}>{overwrite.dest}</p>
              <div className="rise-in flex gap-2" style={{ animationDelay: "120ms" }}>
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
              <div className="rise-in font-serif text-lg italic">Ignore rules</div>
              <p className="rise-in break-all font-mono text-[11px] text-mocha-muted" style={{ animationDelay: "60ms" }}>{ignoreEditor}</p>
              <textarea value={ignoreDraft} onChange={(e) => setIgnoreDraft(e.target.value)} rows={5} placeholder={"*.log\nbuild/"} className="field rise-in w-full rounded-2xl px-4 py-3 font-mono text-xs" style={{ animationDelay: "110ms" }} />
              <div className="rise-in flex gap-2" style={{ animationDelay: "160ms" }}>
                <button onClick={() => void saveIgnoreEditor(close)} disabled={ignoreBusy} className="glass-button btn-gold flex-1 rounded-full py-2 text-sm font-semibold disabled:opacity-60">{ignoreBusy ? "Saving" : "Save"}</button>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {wizardOpen && (
        <ModalShell label="Add sync" shellClassName="w-full max-w-lg" onClose={() => setWizardOpen(false)}>
          {(close) => (
            <div className="bezel-core flex max-h-[70dvh] flex-col p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate font-serif text-lg italic">Add sync</div>
                <span className="shrink-0 font-mono text-[11px] text-mocha-muted">Step {wizardStep} of {wizardSteps.length}</span>
                <button onClick={close} className="glass-button btn-ghost rounded-full px-3 py-1.5 text-xs">Close</button>
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                {wizardSteps.map((s, i) => (
                  <span key={s} className={`h-1 flex-1 rounded-full transition-all duration-700 ease ${i + 1 <= wizardStep ? "bg-mocha-gold" : "bg-white/10"}`} />
                ))}
              </div>
              <div className="quiet-scroll mt-3 max-h-[320px] min-h-[320px] flex-1 space-y-2 overflow-y-auto">
                <div key={wizardStep} className={wizardStepDir >= 0 ? "welcome-step welcome-from-right" : "welcome-step welcome-from-left"}>
                {wizardStage === "source" && (
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Where do you start</div>
                    <button onClick={() => pickWizardSource("local")} className={`block w-full rounded-xl border px-4 py-3 text-left transition-all duration-300 ${wizardSource === "local" ? "border-mocha-gold/40 bg-mocha-gold/10" : "border-white/5 bg-white/[0.02] hover:border-white/10"}`}>
                      <div className="text-sm font-medium">This PC</div>
                      <div className="mt-0.5 text-[13px] text-mocha-muted">Start with a folder on this computer</div>
                    </button>
                    <button onClick={() => pickWizardSource("remote")} className={`block w-full rounded-xl border px-4 py-3 text-left transition-all duration-300 ${wizardSource === "remote" ? "border-mocha-gold/40 bg-mocha-gold/10" : "border-white/5 bg-white/[0.02] hover:border-white/10"}`}>
                      <div className="text-sm font-medium">Mocha</div>
                      <div className="mt-0.5 text-[13px] text-mocha-muted">Start with files already in Mocha</div>
                    </button>
                  </div>
                )}
                {wizardStage === "folder" && (
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Pick a folder</div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input value={wizardRemotePath} onChange={(e) => setWizardRemotePath(e.target.value)} placeholder="/Photos/" className="field w-full rounded-2xl px-4 py-2 text-sm" />
                        <button onClick={() => void loadWizardRemote()} disabled={wizardRemoteLoading} className="glass-button btn-gold shrink-0 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60">{wizardRemoteLoading ? "Loading" : "Load"}</button>
                      </div>
                      <div className="font-mono text-[11px] text-mocha-muted">{wizardRemoteFiles.length === 0 ? "Browse Mocha, then load a path to see files." : `${wizardRemoteFiles.length} files found in Mocha.`}</div>
                    </div>
                  </div>
                )}
                {wizardStage === "direction" && (
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Which way should files go</div>
                    {[
                      { value: "upload-only", title: "Send to Mocha", desc: "Files on this PC upload to Mocha" },
                      { value: "download-only", title: "Get from Mocha", desc: "Files in Mocha download to this PC" },
                      { value: "mirror", title: "Keep both in sync", desc: "Changes on either side sync both ways" },
                    ].map((o) => (
                      <button key={o.value} onClick={() => setWizardDirection(o.value)} className={`block w-full rounded-xl border px-4 py-3 text-left transition-all duration-300 ${wizardDirection === o.value ? "border-mocha-gold/40 bg-mocha-gold/10" : "border-white/5 bg-white/[0.02] hover:border-white/10"}`}>
                        <div className="text-sm font-medium">{o.title}</div>
                        <div className="mt-0.5 text-[13px] text-mocha-muted">{o.desc}</div>
                      </button>
                    ))}
                  </div>
                )}
                {wizardStage === "keep" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Keep on this PC</span>
                    </div>
                    <label className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                      <input type="checkbox" checked={wizardKeepLocal} onChange={(e) => setWizardKeepLocal(e.target.checked)} className="h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">Keep on this PC</span>
                        <span className="mt-0.5 block text-[13px] text-mocha-muted">All files in the folder stay here and sync.</span>
                      </span>
                    </label>
                  </div>
                )}
                {wizardStage === "files" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Keep on this PC</span>
                      {wizardRemoteFiles.length > 0 && (
                        <button onClick={toggleAllWizardRemote} className="glass-button btn-ghost rounded-full px-3 py-1 text-[11px]">Toggle all</button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {wizardRemoteFiles.map((rf) => (
                        <label key={rf.rel} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5">
                          <input type="checkbox" checked={wizardRemoteChecked.has(rf.rel)} onChange={() => toggleWizardRemoteCheck(rf.rel)} className="h-4 w-4" />
                          <span className="min-w-0 flex-1 truncate text-sm">{rf.rel}</span>
                          <span className="shrink-0 font-mono text-[11px] text-mocha-muted">{formatBytes(rf.size)}</span>
                        </label>
                      ))}
                      {wizardRemoteFiles.length === 0 && (
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-[13px] text-mocha-muted">
                          No files loaded yet.
                          <button onClick={() => void loadWizardRemote()} disabled={wizardRemoteLoading || wizardRemotePath.trim().length === 0} className="glass-button btn-ghost ml-2 rounded-full px-3 py-1 text-xs disabled:opacity-50">{wizardRemoteLoading ? "Loading" : "Load now"}</button>
                        </div>
                      )}
                      {wizardRemoteFiles.length > 0 && (
                        <div className="font-mono text-[11px] text-mocha-muted">{wizardRemoteChecked.size} of {wizardRemoteFiles.length} kept on this PC</div>
                      )}
                    </div>
                  </div>
                )}
                {wizardStage === "review" && (
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-mocha-muted">Review and start</div>
                    <div className="space-y-1 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-mocha-muted">Local path</span>
                        <span className="truncate font-mono text-[12px]">Picked with system dialog</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-mocha-muted">Mocha path</span>
                        <span className="truncate font-mono text-[12px]">{wizardSource === "remote" ? (wizardRemotePath.trim() || "/") : "New folder in Mocha"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-mocha-muted">Direction</span>
                        <span className="truncate text-[13px]">{wizardDirectionLabel(wizardDirection)} <span className="font-mono text-[11px] text-mocha-muted">({wizardDirection})</span></span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-mocha-muted">Files</span>
                        <span className="truncate font-mono text-[12px]">{wizardSource === "remote" ? `${wizardRemoteChecked.size} of ${wizardRemoteFiles.length} kept on this PC` : wizardKeepLocal ? "All files, kept on this PC" : "All files"}</span>
                      </div>
                    </div>
                    <div className="text-[13px] text-mocha-muted">Start sync opens the system dialog to pick the folder on this PC.</div>
                  </div>
                )}
                </div>
              </div>
              <div className="mt-3 flex shrink-0 items-center justify-between gap-2">
                <button onClick={() => { setWizardStepDir(-1); setWizardStep((s) => Math.max(1, s - 1)); }} disabled={wizardStep === 1 || wizardBusy} className="glass-button btn-ghost rounded-full px-4 py-2 text-sm disabled:opacity-50">Back</button>
                {wizardStep < wizardSteps.length ? (
                  <button onClick={() => void (async () => { if (wizardSource === "remote" && wizardStage === "folder" && wizardRemoteFiles.length === 0) await loadWizardRemote(); setWizardStepDir(1); setWizardStep((s) => Math.min(wizardSteps.length, s + 1)); })()} disabled={!wizardCanNext() || wizardBusy} className="glass-button btn-gold rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-mocha-secondary">Continue</button>
                ) : (
                  <button onClick={() => void startWizardSync(close)} disabled={wizardBusy || !wizardCanNext()} className="glass-button btn-gold rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-mocha-secondary">{wizardBusy ? "Starting" : "Start sync"}</button>
                )}
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

      <ToastStack notices={notices} onDismiss={dismissNotice} />
    </div>
  );
}
