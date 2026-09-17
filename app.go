package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"mocha-desktop/backend/api"
	"mocha-desktop/backend/auth"
	"mocha-desktop/backend/config"
	"mocha-desktop/backend/contextmenu"
	"mocha-desktop/backend/startup"
	mosync "mocha-desktop/backend/sync"
	"mocha-desktop/backend/transfers"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	cfg        config.Store
	apiKey     string
	client     *api.Client
	syncMgr    *mosync.Manager
	viewMu     sync.Mutex
	view       string
	xferMu     sync.Mutex
	xferCancel map[string]context.CancelFunc
}

func NewApp() *App {
	return &App{xferCancel: map[string]context.CancelFunc{}}
}

func (a *App) trackTransfer(jobID string, cancel context.CancelFunc) {
	if jobID == "" || cancel == nil {
		return
	}
	a.xferMu.Lock()
	if a.xferCancel == nil {
		a.xferCancel = map[string]context.CancelFunc{}
	}
	a.xferCancel[jobID] = cancel
	a.xferMu.Unlock()
}

func (a *App) untrackTransfer(jobID string) {
	if jobID == "" {
		return
	}
	a.xferMu.Lock()
	delete(a.xferCancel, jobID)
	a.xferMu.Unlock()
}

func (a *App) CancelTransfer(jobID string) error {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return fmt.Errorf("job id required")
	}
	a.xferMu.Lock()
	cancel, ok := a.xferCancel[jobID]
	a.xferMu.Unlock()
	if !ok {
		if a.syncMgr != nil && a.syncMgr.CancelJob(jobID) {
			return nil
		}
		return fmt.Errorf("transfer not found")
	}
	cancel()
	return nil
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.view = viewMain
	if startup.StartedHidden() {
		a.view = viewHidden
	}
	cfg, _ := config.Load()
	if cfg.ApiURL == "" {
		cfg.ApiURL = DefaultAPIURL
		_ = config.Save(cfg)
	}
	a.cfg = cfg
	if a.cfg.Settings.ContextMenuEnabled && contextmenu.Supported() {
		_ = contextmenu.Enable()
	}
	if !contextmenu.Supported() {
		a.cfg.Settings.ContextMenuEnabled = false
	}
	if !startup.Supported() {
		a.cfg.Settings.LaunchAtStartup = false
	} else if a.cfg.Settings.LaunchAtStartup {
		_ = startup.Enable()
	}
	if key, err := auth.LoadKey(); err == nil {
		a.apiKey = key
	}
	a.rebuildClient()
	stateDir, _ := config.Dir()
	if stateDir == "" {
		stateDir = "."
	}
	a.syncMgr = mosync.NewManager(stateDir, func(name string, payload any) { a.emit(name, payload) })
	a.syncMgr.SetClient(a.client)
	a.syncMgr.SetPauseMode(a.cfg.Settings.PauseMode)
	a.syncMgr.SetGlobalIgnores(a.cfg.Settings.GlobalIgnores)
	a.syncMgr.SetBidirectional(a.cfg.Settings.BidirectionalSync, a.cfg.Settings.ConflictPolicy)
	for _, root := range a.cfg.SyncFolders {
		_, _ = a.addSyncRoot(root)
	}
	for p, fs := range a.cfg.FolderSettings {
		clean := filepath.Clean(p)
		if len(fs.Ignores) > 0 {
			a.syncMgr.SetFolderIgnores(clean, fs.Ignores)
		}
		if fs.Paused {
			a.syncMgr.SetPaused(clean, true)
		}
	}
	go a.startTray()
	go a.heartbeatLoop()
}

const desktopAppVersion = "1.0.0"

func (a *App) heartbeatLoop() {
	time.Sleep(10 * time.Second)
	a.sendHeartbeat()
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		a.sendHeartbeat()
	}
}

func (a *App) sendHeartbeat() {
	if a.client == nil || a.apiKey == "" || a.syncMgr == nil {
		return
	}
	host, err := os.Hostname()
	if err != nil || strings.TrimSpace(host) == "" {
		host = "unknown"
	}
	folders := make([]api.SyncHeartbeatFolder, 0)
	for _, f := range a.syncMgr.List() {
		folders = append(folders, api.SyncHeartbeatFolder{
			PairID:     f.PairID,
			LocalPath:  f.Path,
			RemotePath: f.RemotePath,
			Direction:  f.Direction,
			Status:     f.Status,
			Files:      f.Files,
			Pending:    f.Pending,
			LastSync:   f.LastSync,
		})
	}
	_ = a.client.HeartbeatComputer(host, goruntime.GOOS, desktopAppVersion, folders)
}

const DefaultAPIURL = "https://api.mocha.my"

func (a *App) rebuildClient() {
	base := config.ApiBase(a.cfg)
	a.client = api.New(base, a.apiKey)
	if a.syncMgr != nil {
		a.syncMgr.SetClient(a.client)
	}
}

func (a *App) emit(name string, payload any) {
	runtime.EventsEmit(a.ctx, name, payload)
}

type Status struct {
	Configured  bool     `json:"configured"`
	HasKey      bool     `json:"hasKey"`
	AppURL      string   `json:"appUrl"`
	ApiURL      string   `json:"apiUrl"`
	SyncFolders []string `json:"syncFolders"`
}

func (a *App) GetStatus() Status {
	folders := a.cfg.SyncFolders
	if folders == nil {
		folders = []string{}
	}
	return Status{
		Configured:  a.cfg.AppURL != "" && a.apiKey != "",
		HasKey:      a.apiKey != "",
		AppURL:      a.cfg.AppURL,
		ApiURL:      a.cfg.ApiURL,
		SyncFolders: folders,
	}
}

func (a *App) SaveConnection(appURL, apiKey string) error {
	appURL = strings.TrimSpace(strings.TrimRight(appURL, "/"))
	apiKey = strings.TrimSpace(apiKey)
	if appURL == "" {
		return fmt.Errorf("app URL required")
	}
	if apiKey == "" {
		return fmt.Errorf("API key required")
	}
	if !strings.HasPrefix(apiKey, "mocha_") {
		return fmt.Errorf("key must start with mocha_")
	}
	a.cfg.AppURL = appURL
	a.cfg.ApiURL = DefaultAPIURL
	if err := config.Save(a.cfg); err != nil {
		return err
	}
	if err := auth.SaveKey(apiKey); err != nil {
		return err
	}
	a.apiKey = apiKey
	a.rebuildClient()
	if _, err := a.client.GetMe(); err != nil {
		return err
	}
	return nil
}

func (a *App) SignOut() error {
	_ = auth.ClearKey()
	a.apiKey = ""
	a.rebuildClient()
	return nil
}

func (a *App) GetProfile() (api.ProfileSummary, error) {
	return a.client.GetProfile()
}

func (a *App) GetStorage() (api.StorageAvailable, error) {
	return a.client.GetStorage()
}

func (a *App) ListFiles(path string, limit int, cursor, query string) (api.ListResponse, error) {
	if path == "" {
		path = "/"
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	return a.client.ListFiles(path, limit, cursor, query)
}

func (a *App) DeleteFile(idOrName string) error {
	return a.client.DeleteFile(idOrName)
}

func (a *App) ListShares() ([]api.Share, error) {
	return a.client.ListShares()
}

func (a *App) CreateShare(fileID string, expiresHours *int, maxDownloads *int, password string) (api.Share, error) {
	return a.client.CreateShareFile(fileID, expiresHours, maxDownloads, password)
}

func (a *App) DeleteShare(token string) error {
	return a.client.DeleteShare(token)
}

func samePath(a, b string) bool {
	ca := filepath.Clean(a)
	cb := filepath.Clean(b)
	if goruntime.GOOS == "linux" {
		return ca == cb
	}
	return strings.EqualFold(ca, cb)
}

func validName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name required")
	}
	if name == "." || name == ".." {
		return fmt.Errorf("name reserved")
	}
	if strings.Contains(name, "/") || strings.ContainsRune(name, 0) {
		return fmt.Errorf("name cannot contain slashes")
	}
	if goruntime.GOOS == "windows" {
		if strings.Contains(name, "\\") {
			return fmt.Errorf("name cannot contain slashes")
		}
		for _, r := range []string{":", "*", "?", "\"", "<", ">", "|"} {
			if strings.Contains(name, r) {
				return fmt.Errorf("name contains reserved character %s", r)
			}
		}
		if strings.HasSuffix(name, " ") || strings.HasSuffix(name, ".") {
			return fmt.Errorf("name cannot end with space or dot")
		}
	}
	return nil
}

func (a *App) SupportsContextMenu() bool {
	return contextmenu.Supported()
}

func (a *App) SupportsLaunchAtStartup() bool {
	return startup.Supported()
}

func (a *App) UploadPickedFiles(remotePath string) ([]string, error) {
	picked, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Upload to Mocha",
		CanCreateDirectories: true,
	})
	if err != nil {
		return nil, err
	}
	if len(picked) == 0 {
		return []string{}, nil
	}
	type fileTask struct {
		file   transfers.BatchFile
		ctx    context.Context
		cancel context.CancelFunc
	}
	tasks := make([]fileTask, 0, len(picked))
	for _, p := range picked {
		jobID := transfers.NewJobID("")
		f := transfers.BatchFile{LocalPath: p, RemotePath: remotePath, JobID: jobID}
		ctx, cancel := context.WithCancel(a.ctx)
		a.trackTransfer(jobID, cancel)
		tasks = append(tasks, fileTask{file: f, ctx: ctx, cancel: cancel})
	}
	emit := a.emit
	concurrency := transfers.DefaultFileConcurrency
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(tasks) {
		concurrency = len(tasks)
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	results := make([]transfers.BatchResult, len(tasks))
	for i, t := range tasks {
		wg.Add(1)
		go func(i int, t fileTask) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			fileID, err := transfers.UploadFileWithID(t.ctx, a.client, t.file.LocalPath, t.file.RemotePath, t.file.JobID, emit)
			results[i] = transfers.BatchResult{JobID: t.file.JobID, LocalPath: t.file.LocalPath, FileID: fileID, Err: err}
		}(i, t)
	}
	wg.Wait()
	for _, t := range tasks {
		a.untrackTransfer(t.file.JobID)
		t.cancel()
	}
	jobs := make([]string, 0, len(results))
	var failed []string
	for _, r := range results {
		if r.Err != nil {
			if r.Err == context.Canceled || strings.Contains(strings.ToLower(r.Err.Error()), "cancel") {
				failed = append(failed, filepath.Base(r.LocalPath)+": cancelled")
				continue
			}
			failed = append(failed, filepath.Base(r.LocalPath)+": "+r.Err.Error())
			continue
		}
		jobs = append(jobs, r.FileID)
	}
	if len(failed) > 0 {
		return jobs, fmt.Errorf("%d of %d uploads failed: %s", len(failed), len(results), strings.Join(failed, "; "))
	}
	return jobs, nil
}

func (a *App) runDownload(fileID, dest string) (string, error) {
	jobID := transfers.NewJobID("dl-")
	ctx, cancel := context.WithCancel(a.ctx)
	a.trackTransfer(jobID, cancel)
	defer func() {
		a.untrackTransfer(jobID)
		cancel()
	}()
	if err := transfers.DownloadFileWithID(ctx, a.client, fileID, dest, "attachment", jobID, a.emit); err != nil {
		return "", err
	}
	return dest, nil
}

func (a *App) DownloadToPath(fileID, dest string, overwrite bool) (string, error) {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return "", fmt.Errorf("destination required")
	}
	if !overwrite {
		if st, err := os.Stat(dest); err == nil && !st.IsDir() {
			return "", transfers.ErrDestExists
		}
	}
	return a.runDownload(fileID, dest)
}

func (a *App) DownloadTo(fileID, fileName string) (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Save to folder", CanCreateDirectories: true})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", fmt.Errorf("no folder selected")
	}
	dest := filepath.Join(dir, fileName)
	if st, err := os.Stat(dest); err == nil && !st.IsDir() {
		return "", fmt.Errorf("exists:%s", dest)
	}
	return a.runDownload(fileID, dest)
}

func (a *App) CreateFolder(path, name string) error {
	if err := validName(name); err != nil {
		return err
	}
	return a.client.CreateFolder(path, strings.TrimSpace(name))
}

func (a *App) RenameFile(idOrName, newName string) error {
	if err := validName(newName); err != nil {
		return err
	}
	return a.client.RenameFile(idOrName, strings.TrimSpace(newName))
}

func (a *App) RenameFolder(path, oldName, newName string) error {
	if err := validName(newName); err != nil {
		return err
	}
	return a.client.RenameFolder(path, oldName, strings.TrimSpace(newName))
}

func (a *App) MoveFile(fileID, toPath string) error {
	return a.client.MoveFile(fileID, toPath)
}

func (a *App) MoveFolder(folderPath, toPath string) error {
	return a.client.MoveFolder(folderPath, toPath)
}

func (a *App) GetTrash() ([]api.TrashItem, error) {
	return a.client.GetTrash()
}

func (a *App) DeleteTrashItem(id string) error {
	return a.client.DeleteTrash(id, false)
}

func (a *App) ClearTrash() error {
	return a.client.DeleteTrash("", true)
}

func (a *App) ListArchive(fileID string) ([]api.ArchiveEntry, error) {
	return a.client.ListArchive(fileID)
}

func (a *App) BulkDownloadTo(fileIDs, folderPaths []string) (string, error) {
	if len(fileIDs) == 0 && len(folderPaths) == 0 {
		return "", fmt.Errorf("nothing selected")
	}
	dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Save zip as", DefaultFilename: "mocha-download.zip", Filters: []runtime.FileFilter{{DisplayName: "Zip archive (*.zip)", Pattern: "*.zip"}}})
	if err != nil {
		return "", err
	}
	if dest == "" {
		return "", fmt.Errorf("no file selected")
	}
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if err := a.client.BulkDownloadStream(fileIDs, folderPaths, out); err != nil {
		return "", err
	}
	return dest, nil
}

func (a *App) ExtractArchiveEntry(fileID, entryPath, fileName string) (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Extract to folder", CanCreateDirectories: true})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", fmt.Errorf("no folder selected")
	}
	if fileName == "" {
		fileName = filepath.Base(entryPath)
	}
	dest := filepath.Join(dir, fileName)
	out, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if err := a.client.ExtractArchiveStream(fileID, entryPath, out); err != nil {
		return "", err
	}
	return dest, nil
}

type PreviewURL struct {
	URL string `json:"url"`
}

func (a *App) GetPreviewURL(fileID string) (PreviewURL, error) {
	if a.client == nil {
		return PreviewURL{}, fmt.Errorf("not connected")
	}
	fileID = strings.TrimSpace(fileID)
	if fileID == "" {
		return PreviewURL{}, fmt.Errorf("file id required")
	}
	directURL, err := a.client.PresignedDownload(fileID, "inline")
	if err != nil {
		return PreviewURL{}, err
	}
	return PreviewURL{URL: directURL}, nil
}

func (a *App) addSyncRoot(path string) (mosync.FolderState, error) {
	if a.syncMgr == nil {
		return mosync.FolderState{}, fmt.Errorf("sync not ready")
	}
	clean := filepath.Clean(path)
	st, err := a.syncMgr.Add(clean)
	if err != nil {
		return mosync.FolderState{}, err
	}
	for _, p := range a.cfg.SyncFolders {
		if samePath(p, clean) {
			return st, nil
		}
	}
	a.cfg.SyncFolders = append(a.cfg.SyncFolders, clean)
	if err := config.Save(a.cfg); err != nil {
		return st, err
	}
	return st, nil
}

func (a *App) GetSyncFolders() []mosync.FolderState {
	if a.syncMgr == nil {
		return []mosync.FolderState{}
	}
	return a.syncMgr.List()
}

func (a *App) AddSyncFolder() (mosync.FolderState, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Watch folder", CanCreateDirectories: true})
	if err != nil {
		return mosync.FolderState{}, err
	}
	if dir == "" {
		return mosync.FolderState{}, fmt.Errorf("no folder selected")
	}
	st, err := a.addSyncRoot(dir)
	if err == nil {
		go a.sendHeartbeat()
	}
	return st, err
}

func (a *App) AddSyncFolderLocal() (mosync.FolderState, error) {
	if a.syncMgr == nil {
		return mosync.FolderState{}, fmt.Errorf("sync not ready")
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Watch folder", CanCreateDirectories: true})
	if err != nil {
		return mosync.FolderState{}, err
	}
	if dir == "" {
		return mosync.FolderState{}, fmt.Errorf("no folder selected")
	}
	clean := filepath.Clean(dir)
	p := config.Pair{ID: strings.ToLower(clean), LocalPath: clean, RemotePath: "", Direction: config.Direction("upload-only"), PinDefault: "keep"}
	st, err := a.syncMgr.AddWithPair(p)
	if err != nil {
		return st, err
	}
	a.rememberPair(p, st)
	go a.sendHeartbeat()
	return st, nil
}

func (a *App) AddSyncFolderRemote(remotePath string, checked []string) (mosync.FolderState, error) {
	if a.syncMgr == nil {
		return mosync.FolderState{}, fmt.Errorf("sync not ready")
	}
	if strings.TrimSpace(remotePath) == "" {
		return mosync.FolderState{}, fmt.Errorf("remote path required")
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Attach to folder", CanCreateDirectories: true})
	if err != nil {
		return mosync.FolderState{}, err
	}
	if dir == "" {
		return mosync.FolderState{}, fmt.Errorf("no folder selected")
	}
	st, err := a.syncMgr.AttachRemote(remotePath, dir, "mirror", checked)
	if err != nil {
		return st, err
	}
	clean := filepath.Clean(dir)
	p := config.Pair{ID: strings.ToLower(clean), LocalPath: clean, RemotePath: remotePath, Direction: config.Direction("mirror"), PinDefault: "keep"}
	a.rememberPair(p, st)
	go a.sendHeartbeat()
	return st, nil
}

func (a *App) ListRemoteForAttach(remotePath string) ([]mosync.RemotePickFile, error) {
	if a.syncMgr == nil {
		return nil, fmt.Errorf("sync not ready")
	}
	return a.syncMgr.ListRemoteForAttach(remotePath)
}

func (a *App) SetPairDirection(pairID, direction string) error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	if err := a.syncMgr.SetDirection(pairID, direction); err != nil {
		return err
	}
	for i, p := range a.cfg.Pairs {
		if p.ID == pairID {
			a.cfg.Pairs[i].Direction = config.Direction(direction)
		}
	}
	_ = config.Save(a.cfg)
	go a.sendHeartbeat()
	return nil
}

func (a *App) ListConflicts(pairID string) []mosync.Conflict {
	if a.syncMgr == nil {
		return []mosync.Conflict{}
	}
	return a.syncMgr.ListConflicts(pairID)
}

func (a *App) ResolveConflict(pairID, rel, choice string) error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	return a.syncMgr.ResolveConflict(pairID, rel, choice)
}

func (a *App) SetFilePin(pairID, rel, pin string) error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	return a.syncMgr.SetFilePin(pairID, rel, pin)
}

func (a *App) GetFilePins(pairID string) map[string]string {
	if a.syncMgr == nil {
		return map[string]string{}
	}
	return a.syncMgr.GetFilePins(pairID)
}

func (a *App) rememberPair(p config.Pair, st mosync.FolderState) {
	clean := st.Path
	if clean == "" {
		clean = filepath.Clean(p.LocalPath)
	}
	found := false
	for _, q := range a.cfg.SyncFolders {
		if samePath(q, clean) {
			found = true
			break
		}
	}
	if !found {
		a.cfg.SyncFolders = append(a.cfg.SyncFolders, clean)
	}
	id := p.ID
	if id == "" {
		id = st.PairID
	}
	if id == "" {
		id = strings.ToLower(clean)
	}
	exists := false
	for _, q := range a.cfg.Pairs {
		if q.ID == id || samePath(q.LocalPath, clean) {
			exists = true
			break
		}
	}
	if !exists {
		if p.ID == "" {
			p.ID = id
		}
		if p.LocalPath == "" {
			p.LocalPath = clean
		}
		a.cfg.Pairs = append(a.cfg.Pairs, p)
	}
	_ = config.Save(a.cfg)
}

func (a *App) pruneSyncConfig(clean string) error {
	kept := make([]string, 0, len(a.cfg.SyncFolders))
	for _, p := range a.cfg.SyncFolders {
		if !samePath(p, clean) {
			kept = append(kept, p)
		}
	}
	a.cfg.SyncFolders = kept
	for k := range a.cfg.FolderSettings {
		if samePath(k, clean) {
			delete(a.cfg.FolderSettings, k)
		}
	}
	return config.Save(a.cfg)
}

func (a *App) RemoveSyncFolder(path string) error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	clean := filepath.Clean(path)
	a.syncMgr.Remove(clean)
	if err := a.pruneSyncConfig(clean); err != nil {
		return err
	}
	go a.sendHeartbeat()
	return nil
}

func (a *App) PreviewRemoveSyncFolder(path string) (mosync.RemoveSyncPreview, error) {
	if a.syncMgr == nil {
		return mosync.RemoveSyncPreview{}, fmt.Errorf("sync not ready")
	}
	return a.syncMgr.PreviewRemove(filepath.Clean(path))
}

func (a *App) RemoveSyncFolderAndFiles(path string) (mosync.RemoveSyncResult, error) {
	if a.syncMgr == nil {
		return mosync.RemoveSyncResult{}, fmt.Errorf("sync not ready")
	}
	clean := filepath.Clean(path)
	result, err := a.syncMgr.RemoveWithOptions(clean, true)
	if err != nil {
		return result, err
	}
	if err := a.pruneSyncConfig(clean); err != nil {
		return result, err
	}
	go a.sendHeartbeat()
	return result, nil
}

func (a *App) RescanSync() error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	a.syncMgr.RescanAll()
	return nil
}

func (a *App) TogglePauseAll() error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	folders := a.syncMgr.List()
	if len(folders) == 0 {
		return fmt.Errorf("no folders watched")
	}
	pause := false
	for _, f := range folders {
		if !f.Paused && f.Status != "paused" {
			pause = true
			break
		}
	}
	for _, f := range folders {
		_ = a.SetSyncPaused(f.Path, pause)
	}
	return nil
}

func (a *App) applySyncSettings() {
	if a.syncMgr == nil {
		return
	}
	a.syncMgr.SetPauseMode(a.cfg.Settings.PauseMode)
	a.syncMgr.SetGlobalIgnores(a.cfg.Settings.GlobalIgnores)
	a.syncMgr.SetBidirectional(a.cfg.Settings.BidirectionalSync, a.cfg.Settings.ConflictPolicy)
	for p, fs := range a.cfg.FolderSettings {
		clean := filepath.Clean(p)
		a.syncMgr.SetFolderIgnores(clean, fs.Ignores)
		if fs.Paused {
			a.syncMgr.SetPaused(clean, true)
		}
	}
}

func (a *App) GetSettings() config.Settings {
	return a.cfg.Settings
}

func (a *App) SaveSettings(s config.Settings) error {
	s.PauseMode = strings.TrimSpace(strings.ToLower(s.PauseMode))
	if s.PauseMode != "cancel" {
		s.PauseMode = "drain"
	}
	s.ConflictPolicy = strings.TrimSpace(strings.ToLower(s.ConflictPolicy))
	if s.ConflictPolicy != "local-wins" {
		s.ConflictPolicy = "skip"
	}
	if s.FilesView != "grid" {
		s.FilesView = ""
	}
	cleaned := make([]string, 0, len(s.GlobalIgnores))
	for _, p := range s.GlobalIgnores {
		if t := strings.TrimSpace(p); t != "" {
			cleaned = append(cleaned, t)
		}
	}
	s.GlobalIgnores = cleaned
	if s.ContextMenuEnabled && !contextmenu.Supported() {
		s.ContextMenuEnabled = false
	}
	if s.LaunchAtStartup && !startup.Supported() {
		s.LaunchAtStartup = false
	}
	contextMenuChanged := s.ContextMenuEnabled != a.cfg.Settings.ContextMenuEnabled
	startupChanged := s.LaunchAtStartup != a.cfg.Settings.LaunchAtStartup
	a.cfg.Settings = s
	if err := config.Save(a.cfg); err != nil {
		return err
	}
	if contextMenuChanged {
		if s.ContextMenuEnabled {
			if err := contextmenu.Enable(); err != nil {
				return err
			}
		} else if err := contextmenu.Disable(); err != nil {
			return err
		}
	}
	if startupChanged {
		if s.LaunchAtStartup {
			if err := startup.Enable(); err != nil {
				return err
			}
		} else if err := startup.Disable(); err != nil {
			return err
		}
	}
	a.applySyncSettings()
	return nil
}

func (a *App) SetSyncPaused(path string, paused bool) error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	clean := filepath.Clean(path)
	a.syncMgr.SetPaused(clean, paused)
	if a.cfg.FolderSettings == nil {
		a.cfg.FolderSettings = map[string]config.FolderSettings{}
	}
	fs := a.cfg.FolderSettings[clean]
	fs.Paused = paused
	a.cfg.FolderSettings[clean] = fs
	_ = config.Save(a.cfg)
	go a.sendHeartbeat()
	return nil
}

func (a *App) GetFolderIgnores(path string) []string {
	clean := filepath.Clean(path)
	if fs, ok := a.cfg.FolderSettings[clean]; ok && fs.Ignores != nil {
		return fs.Ignores
	}
	return []string{}
}

func (a *App) SaveFolderIgnores(path string, patterns []string) error {
	if a.syncMgr == nil {
		return fmt.Errorf("sync not ready")
	}
	clean := filepath.Clean(path)
	cleaned := make([]string, 0, len(patterns))
	for _, p := range patterns {
		if t := strings.TrimSpace(p); t != "" {
			cleaned = append(cleaned, t)
		}
	}
	a.syncMgr.SetFolderIgnores(clean, cleaned)
	if a.cfg.FolderSettings == nil {
		a.cfg.FolderSettings = map[string]config.FolderSettings{}
	}
	fs := a.cfg.FolderSettings[clean]
	fs.Ignores = cleaned
	a.cfg.FolderSettings[clean] = fs
	return config.Save(a.cfg)
}
