export function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const w = window as unknown as { go?: { main?: { App?: Record<string, (...a: unknown[]) => Promise<T>> } } };
  const fn = w.go?.main?.App?.[method];
  if (!fn) {
    return Promise.reject(new Error("backend not ready: " + method));
  }
  return fn(...args);
}

export interface Status {
  configured: boolean;
  hasKey: boolean;
  appUrl: string;
  apiUrl: string;
  syncFolders: string[];
}

export interface FileItem {
  id: string;
  original_name: string;
  file_name: string;
  size: number;
  mime_type: string;
  path: string;
  created_at: string;
}

export interface ListResponse {
  files: FileItem[];
  folders: string[];
  path: string;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface TrashItem {
  id: string;
  original_name: string;
  file_name: string;
  size: number;
  path: string;
  deleted_at: string;
}

export interface ArchiveEntry {
  path: string;
  fileName: string;
  fileSize: number;
  compressedSize: number;
  isDirectory: boolean;
}

export interface AppSettings {
  pauseMode?: string;
  globalIgnores?: string[];
  conflictPolicy?: string;
  bidirectionalSync?: boolean;
  filesView?: string;
  contextMenu?: boolean;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: string;
  usedBytes: number;
  maxStorageBytes: number;
  storagePercent: number;
  uploadsCount: number;
  sharesCount: number;
}

export interface StorageInfo {
  usedBytes: number;
  availableBytes: number;
  maxStorageBytes: number;
  storagePercent: number;
}

export interface Share {
  token: string;
  file_id?: string | null;
  original_name?: string | null;
  folder_path?: string | null;
  folder_name?: string | null;
  is_active: boolean;
  expires_at?: string | null;
  max_downloads?: number | null;
  download_count: number;
  password_protected: boolean;
  is_permanent_link: boolean;
  created_at: string;
}

export interface TransferProgress {
  jobId: string;
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
  speedBps: number;
  status: string;
  error?: string;
}

export interface SyncFolder {
  path: string;
  remotePath: string;
  files: number;
  pending: number;
  status: string;
  lastSync: number;
  error?: string;
  current?: string;
  progress?: number;
  queued: string[];
  paused?: boolean;
}

export function isArchiveFile(f: Pick<FileItem, "original_name">): boolean {
  const ext = fileExtension(f.original_name);
  return ext === "zip" || ext === "rar" || ext === "7z" || ext === "cbz" || ext === "cbr";
}

export interface RemoveSyncResult {
  deleted: number;
  skipped: number;
  failed: number;
}

export interface RemovePreviewFile {
  rel: string;
  name: string;
  dir: string;
  size: number;
  matched: boolean;
}

export interface RemoveSyncPreview {
  files: RemovePreviewFile[];
  total: number;
  matched: number;
  unmatched: number;
  truncated: boolean;
  remoteBase: string;
  remotePath: string;
}

export interface PreviewURL {
  url: string;
}

const VIDEO_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "webm", "ogv", "ogg", "mkv", "avi", "wmv", "flv", "m3u8", "ts", "mts", "3gp",
]);

const PLAYABLE_VIDEO = new Set([
  "mp4", "m4v", "mov", "webm", "ogv", "ogg", "m3u8", "3gp",
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "svg", "avif", "heic", "heif",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "flac", "aac", "m4a", "ogg", "oga", "opus", "weba", "wma", "aiff", "aif",
]);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function hasMediaExt(f: Pick<FileItem, "mime_type" | "original_name">, prefix: string, exts: Set<string>): boolean {
  return f.mime_type.toLowerCase().startsWith(prefix) || exts.has(fileExtension(f.original_name));
}

export function isVideoFile(f: Pick<FileItem, "mime_type" | "original_name">): boolean {
  return hasMediaExt(f, "video/", VIDEO_EXTENSIONS);
}

export function isImageFile(f: Pick<FileItem, "mime_type" | "original_name">): boolean {
  return hasMediaExt(f, "image/", IMAGE_EXTENSIONS);
}

export function isAudioFile(f: Pick<FileItem, "mime_type" | "original_name">): boolean {
  return hasMediaExt(f, "audio/", AUDIO_EXTENSIONS);
}

export function isPreviewable(f: Pick<FileItem, "mime_type" | "original_name">): boolean {
  if (isImageFile(f) || isAudioFile(f)) return true;
  if (!isVideoFile(f)) return false;
  const ext = fileExtension(f.original_name);
  if (ext && !PLAYABLE_VIDEO.has(ext)) return false;
  return true;
}

export function parseLines(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function formatDate(value: string | number): string {
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatTime(value: string | number): string {
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bps: number): string {
  if (!bps) return "";
  return `${formatBytes(bps)}/s`;
}

export function folderName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

// ponytail: UA sniff, Wails exposes no sync GOOS in frontend
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);
}

export const api = {
  status: () => invoke<Status>("GetStatus"),
  saveConnection: (appUrl: string, key: string) => invoke<void>("SaveConnection", appUrl, key),
  signOut: () => invoke<void>("SignOut"),
  profile: () => invoke<Profile>("GetProfile"),
  storage: () => invoke<StorageInfo>("GetStorage"),
  list: (path: string, limit: number, cursor: string, q: string) => invoke<ListResponse>("ListFiles", path, limit, cursor, q),
  remove: (id: string) => invoke<void>("DeleteFile", id),
  createFolder: (path: string, name: string) => invoke<void>("CreateFolder", path, name),
  renameFile: (id: string, newName: string) => invoke<void>("RenameFile", id, newName),
  renameFolder: (path: string, oldName: string, newName: string) => invoke<void>("RenameFolder", path, oldName, newName),
  moveFile: (id: string, toPath: string) => invoke<void>("MoveFile", id, toPath),
  moveFolder: (folderPath: string, toPath: string) => invoke<void>("MoveFolder", folderPath, toPath),
  trash: () => invoke<TrashItem[]>("GetTrash"),
  deleteTrashItem: (id: string) => invoke<void>("DeleteTrashItem", id),
  clearTrash: () => invoke<void>("ClearTrash"),
  listArchive: (id: string) => invoke<ArchiveEntry[]>("ListArchive", id),
  bulkDownload: (fileIds: string[], folderPaths: string[]) => invoke<string>("BulkDownloadTo", fileIds, folderPaths),
  extractArchive: (id: string, entryPath: string, fileName: string) => invoke<string>("ExtractArchiveEntry", id, entryPath, fileName),
  downloadToPath: (id: string, dest: string, overwrite: boolean) => invoke<string>("DownloadToPath", id, dest, overwrite),
  cancelTransfer: (jobId: string) => invoke<void>("CancelTransfer", jobId),
  getSettings: () => invoke<AppSettings>("GetSettings"),
  saveSettings: (s: AppSettings) => invoke<void>("SaveSettings", s),
  setSyncPaused: (path: string, paused: boolean) => invoke<void>("SetSyncPaused", path, paused),
  getFolderIgnores: (path: string) => invoke<string[]>("GetFolderIgnores", path),
  saveFolderIgnores: (path: string, patterns: string[]) => invoke<void>("SaveFolderIgnores", path, patterns),
  shares: () => invoke<Share[]>("ListShares"),
  createShare: (fileId: string, expiresHours: number | null, maxDownloads: number | null, password: string) => invoke<Share>("CreateShare", fileId, expiresHours, maxDownloads, password),
  deleteShare: (token: string) => invoke<void>("DeleteShare", token),
  pickUpload: (remotePath: string) => invoke<string[]>("UploadPickedFiles", remotePath),
  download: (id: string, name: string) => invoke<string>("DownloadTo", id, name),
  previewUrl: (id: string) => invoke<PreviewURL>("GetPreviewURL", id),
  supportsContextMenu: () => invoke<boolean>("SupportsContextMenu"),
  syncFolders: () => invoke<SyncFolder[]>("GetSyncFolders"),
  addSyncFolder: () => invoke<SyncFolder>("AddSyncFolder"),
  removeSyncFolder: (path: string) => invoke<void>("RemoveSyncFolder", path),
  previewRemoveSyncFolder: (path: string) => invoke<RemoveSyncPreview>("PreviewRemoveSyncFolder", path),
  removeSyncFolderAndFiles: (path: string) => invoke<RemoveSyncResult>("RemoveSyncFolderAndFiles", path),
  rescanSync: () => invoke<void>("RescanSync"),
  showMain: () => invoke<void>("ShowMain"),
  closeWindow: () => invoke<void>("CloseWindow"),
};
