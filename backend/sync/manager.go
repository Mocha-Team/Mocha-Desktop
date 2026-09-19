package sync

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	goruntime "runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"mocha-desktop/backend/api"
	"mocha-desktop/backend/config"
	"mocha-desktop/backend/transfers"
)

type FolderState struct {
	Path       string   `json:"path"`
	RemotePath string   `json:"remotePath"`
	PairID     string   `json:"pairId"`
	Direction  string   `json:"direction"`
	Files      int      `json:"files"`
	Pending    int      `json:"pending"`
	Status     string   `json:"status"`
	LastSync   int64    `json:"lastSync"`
	Error      string   `json:"error,omitempty"`
	Current    string   `json:"current,omitempty"`
	Progress   float64  `json:"progress,omitempty"`
	Queued     []string `json:"queued"`
	Paused     bool     `json:"paused,omitempty"`
}

type Conflict struct {
	PairID     string `json:"pairId"`
	Rel        string `json:"rel"`
	LocalSize  int64  `json:"localSize"`
	RemoteSize int64  `json:"remoteSize"`
}

type RemotePickFile struct {
	Rel  string `json:"rel"`
	Size int64  `json:"size"`
}

type Manager struct {
	mu             sync.Mutex
	roots          map[string]*rootJob
	emit           func(event string, payload any)
	client         *api.Client
	stateDir       string
	pauseMode      string
	globalIgnores  []string
	conflictPolicy string
	conflicts      map[string][]Conflict
	pins           map[string]map[string]string
}

type rootJob struct {
	path                 string
	remoteBase           string
	pairID               string
	direction            string
	ctx                  context.Context
	stateFile            string
	state                Snapshot
	queue                []string
	inFlight             int
	queued               map[string]bool
	sizes                map[string]int64
	attempts             map[string]int
	status               FolderState
	watcher              *Watcher
	cancel               context.CancelFunc
	jobID                string
	activeJobs           map[string]string
	activeCancel         map[string]context.CancelFunc
	lastPush             time.Time
	pumpMu               sync.Mutex
	paused               bool
	ignores              []string
	folderIgnorePatterns []string
	opCancel             context.CancelFunc
	lastRemotePoll       time.Time
	remoteFails          int
	remoteBackoffUntil   time.Time
	downloading          map[string]bool
	deletedAt            map[string]time.Time
}

func pinsFile(stateDir string) string {
	return filepath.Join(stateDir, "pins.json")
}

func loadPinsFile(stateDir string) map[string]map[string]string {
	out := map[string]map[string]string{}
	if stateDir == "" {
		return out
	}
	raw, err := os.ReadFile(pinsFile(stateDir))
	if err != nil {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	if out == nil {
		out = map[string]map[string]string{}
	}
	return out
}

func savePinsFile(stateDir string, pins map[string]map[string]string) {
	if stateDir == "" {
		return
	}
	raw, _ := json.Marshal(pins)
	writeFileAtomic(pinsFile(stateDir), raw)
}

func (m *Manager) persistPins() {
	m.mu.Lock()
	pins := make(map[string]map[string]string, len(m.pins))
	for pairID, files := range m.pins {
		cp := make(map[string]string, len(files))
		for rel, pin := range files {
			cp[rel] = pin
		}
		pins[pairID] = cp
	}
	m.mu.Unlock()
	savePinsFile(m.stateDir, pins)
}

func normalizeRemoteBase(p string) string {
	return strings.ToLower(strings.Trim(strings.TrimSpace(p), "/"))
}

func (m *Manager) addConflict(pairID, rel string, localSize, remoteSize int64) {
	if pairID == "" || rel == "" {
		return
	}
	for _, c := range m.conflicts[pairID] {
		if c.Rel == rel {
			return
		}
	}
	m.conflicts[pairID] = append(m.conflicts[pairID], Conflict{PairID: pairID, Rel: rel, LocalSize: localSize, RemoteSize: remoteSize})
}

func NewManager(stateDir string, emit func(event string, payload any)) *Manager {
	return &Manager{roots: map[string]*rootJob{}, emit: emit, stateDir: stateDir, conflicts: map[string][]Conflict{}, pins: loadPinsFile(stateDir)}
}

func (m *Manager) shouldPush(direction string) bool {
	return direction == "upload-only" || direction == "mirror"
}

func (m *Manager) shouldPull(direction string) bool {
	return direction == "download-only" || direction == "mirror"
}

func (m *Manager) AddWithPair(p config.Pair) (FolderState, error) {
	if err := config.ValidatePair(p); err != nil {
		return FolderState{}, err
	}
	clean := filepath.Clean(p.LocalPath)
	direction := string(p.Direction)
	if direction == "" {
		direction = "upload-only"
	}
	remoteBase := strings.Trim(strings.TrimSpace(p.RemotePath), "/")
	m.mu.Lock()
	for _, job := range m.roots {
		if remoteBase != "" && normalizeRemoteBase(job.remoteBase) == normalizeRemoteBase(remoteBase) && !sameRoot(job.path, clean) {
			m.mu.Unlock()
			return FolderState{}, fmt.Errorf("duplicate remote")
		}
	}
	_, exists := m.roots[clean]
	m.mu.Unlock()
	st, err := m.Add(clean)
	if err != nil {
		return st, err
	}
	m.mu.Lock()
	job, ok := m.roots[clean]
	if !ok {
		m.mu.Unlock()
		return st, nil
	}
	if exists {
		st = job.status
		m.mu.Unlock()
		return st, nil
	}
	job.pairID = p.ID
	if job.pairID == "" {
		job.pairID = config.NewOpaqueID("pair-")
	}
	job.direction = direction
	if remoteBase != "" {
		job.remoteBase = remoteBase
		job.status.RemotePath = remotePathForBase(remoteBase)
	}
	job.status.PairID = job.pairID
	job.status.Direction = job.direction
	if m.conflicts == nil {
		m.conflicts = map[string][]Conflict{}
	}
	if m.pins == nil {
		m.pins = map[string]map[string]string{}
	}
	if _, ok := m.pins[job.pairID]; !ok {
		m.pins[job.pairID] = map[string]string{}
	}
	st = job.status
	m.mu.Unlock()
	m.broadcast()
	if m.shouldPull(direction) {
		go m.pullNow(clean)
	}
	return st, nil
}

func sameRoot(a, b string) bool {
	if goruntime.GOOS == "linux" {
		return a == b
	}
	return strings.EqualFold(a, b)
}

func (m *Manager) AttachRemote(remotePath, localPath, direction string, checked []string) (FolderState, error) {
	base := strings.Trim(strings.TrimSpace(remotePath), "/")
	if base == "" {
		return FolderState{}, fmt.Errorf("remote path required")
	}
	clean := filepath.Clean(strings.TrimSpace(localPath))
	if clean == "" || clean == "." {
		return FolderState{}, fmt.Errorf("local path required")
	}
	if direction == "" {
		direction = "mirror"
	}
	if direction != "upload-only" && direction != "download-only" && direction != "mirror" {
		return FolderState{}, fmt.Errorf("direction required")
	}
	if err := os.MkdirAll(clean, 0o755); err != nil {
		return FolderState{}, err
	}
	if entries, err := os.ReadDir(clean); err == nil && len(entries) > 0 {
		return FolderState{}, fmt.Errorf("folder not empty")
	}
	p := config.Pair{
		ID:         config.NewOpaqueID("pair-"),
		LocalPath:  clean,
		RemotePath: "/" + base + "/",
		Direction:  config.Direction(direction),
		PinDefault: "keep",
	}
	st, err := m.AddWithPair(p)
	if err != nil {
		return st, err
	}
	m.mu.Lock()
	job, ok := m.roots[clean]
	client := m.client
	pairID := ""
	if ok {
		pairID = job.pairID
	}
	m.mu.Unlock()
	if !ok || pairID == "" {
		return st, nil
	}
	keep := map[string]bool{}
	for _, rel := range checked {
		r := filepath.ToSlash(strings.Trim(strings.TrimSpace(rel), "/"))
		if r != "" {
			keep[r] = true
		}
	}
	if client == nil || client.APIKey == "" || client.BaseURL == "" {
		return st, nil
	}
	tree, err := m.listRemoteTree(client, base)
	if err != nil {
		m.Remove(clean)
		return FolderState{}, err
	}
	m.mu.Lock()
	if m.pins == nil {
		m.pins = map[string]map[string]string{}
	}
	if m.pins[pairID] == nil {
		m.pins[pairID] = map[string]string{}
	}
	for rel := range tree {
		r := filepath.ToSlash(rel)
		if !keep[r] {
			m.pins[pairID][r] = "cloud"
		}
	}
	m.mu.Unlock()
	m.persistPins()
	return st, nil
}

func (m *Manager) SetDirection(pairID, direction string) error {
	if direction != "upload-only" && direction != "download-only" && direction != "mirror" {
		return fmt.Errorf("direction required")
	}
	m.mu.Lock()
	var path string
	for _, job := range m.roots {
		if job.pairID == pairID {
			job.direction = direction
			job.status.Direction = direction
			path = job.path
			break
		}
	}
	m.mu.Unlock()
	if path == "" {
		return fmt.Errorf("pair not found")
	}
	m.broadcast()
	go m.rescan(path)
	return nil
}

func (m *Manager) ListConflicts(pairID string) []Conflict {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Conflict{}, m.conflicts[pairID]...)
}

func (m *Manager) ResolveConflict(pairID, rel, choice string) error {
	if choice != "keep-local" && choice != "keep-remote" && choice != "keep-both" {
		return fmt.Errorf("choice required")
	}
	m.mu.Lock()
	list := m.conflicts[pairID]
	found := false
	for _, c := range list {
		if c.Rel == rel {
			found = true
			break
		}
	}
	if !found {
		m.mu.Unlock()
		return fmt.Errorf("conflict not found")
	}
	var rootPath string
	for _, job := range m.roots {
		if job.pairID == pairID {
			rootPath = job.path
			break
		}
	}
	m.mu.Unlock()
	if choice == "keep-both" && rootPath != "" && rel != "" {
		src := filepath.Join(rootPath, filepath.FromSlash(filepath.ToSlash(strings.Trim(strings.TrimSpace(rel), "/"))))
		if info, err := os.Stat(src); err == nil && !info.IsDir() {
			ext := filepath.Ext(filepath.Base(rel))
			stem := strings.TrimSuffix(rel, ext)
			dstRel := stem + ".conflict-" + time.Now().Format("20060102-150405") + ext
			dst := filepath.Join(rootPath, filepath.FromSlash(dstRel))
			if raw, err := os.ReadFile(src); err == nil {
				_ = os.MkdirAll(filepath.Dir(dst), 0o755)
				_ = os.WriteFile(dst, raw, 0o644)
			}
		}
	}
	m.mu.Lock()
	kept := make([]Conflict, 0, len(m.conflicts[pairID]))
	for _, c := range m.conflicts[pairID] {
		if c.Rel == rel {
			continue
		}
		kept = append(kept, c)
	}
	m.conflicts[pairID] = kept
	m.mu.Unlock()
	return nil
}

func (m *Manager) shouldDownload(pairID, rel string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pins == nil {
		return true
	}
	if m.pins[pairID] == nil {
		return true
	}
	return m.pins[pairID][rel] != "cloud"
}

func (m *Manager) SetFilePin(pairID, rel, pin string) error {
	if pin != "keep" && pin != "cloud" {
		return fmt.Errorf("pin required")
	}
	m.mu.Lock()
	if m.pins == nil {
		m.pins = map[string]map[string]string{}
	}
	if m.pins[pairID] == nil {
		m.pins[pairID] = map[string]string{}
	}
	m.pins[pairID][rel] = pin
	m.mu.Unlock()
	m.persistPins()
	return nil
}

func (m *Manager) GetFilePins(pairID string) map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]string{}
	for k, v := range m.pins[pairID] {
		out[k] = v
	}
	return out
}

func (m *Manager) ListRemoteForAttach(remotePath string) ([]RemotePickFile, error) {
	base := strings.Trim(strings.TrimSpace(remotePath), "/")
	if base == "" {
		return nil, fmt.Errorf("remote path required")
	}
	m.mu.Lock()
	client := m.client
	m.mu.Unlock()
	if client == nil || client.APIKey == "" || client.BaseURL == "" {
		return nil, fmt.Errorf("not connected")
	}
	tree, err := m.listRemoteTree(client, base)
	if err != nil {
		return nil, err
	}
	out := make([]RemotePickFile, 0, len(tree))
	for rel, rf := range tree {
		out = append(out, RemotePickFile{Rel: filepath.ToSlash(rel), Size: rf.size})
	}
	slices.SortFunc(out, func(a, b RemotePickFile) int { return strings.Compare(a.Rel, b.Rel) })
	return out, nil
}

func (m *Manager) SetClient(c *api.Client) {
	m.mu.Lock()
	m.client = c
	m.mu.Unlock()
}

func (m *Manager) SetPauseMode(mode string) {
	if mode != "cancel" {
		mode = "drain"
	}
	m.mu.Lock()
	m.pauseMode = mode
	m.mu.Unlock()
}

func (m *Manager) SetGlobalIgnores(patterns []string) {
	m.mu.Lock()
	m.globalIgnores = append([]string{}, patterns...)
	for _, job := range m.roots {
		job.ignores = mergeIgnores(m.globalIgnores, job.folderIgnorePatterns)
		if job.watcher != nil {
			job.watcher.SetIgnores(job.ignores)
		}
	}
	m.mu.Unlock()
}

func (m *Manager) SetConflictPolicy(policy string) {
	policy = strings.TrimSpace(strings.ToLower(policy))
	if policy == "local-wins" {
		policy = "remote-wins"
	}
	if policy != "remote-wins" {
		policy = "skip"
	}
	m.mu.Lock()
	m.conflictPolicy = policy
	m.mu.Unlock()
}

func mergeIgnores(lists ...[]string) []string {
	seen := map[string]bool{}
	var out []string
	for _, l := range lists {
		for _, p := range l {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}

func (m *Manager) SetFolderIgnores(path string, patterns []string) {
	clean := filepath.Clean(path)
	m.mu.Lock()
	job, ok := m.roots[clean]
	if !ok {
		m.mu.Unlock()
		return
	}
	job.folderIgnorePatterns = append([]string{}, patterns...)
	job.ignores = mergeIgnores(DefaultIgnores, m.globalIgnores, job.folderIgnorePatterns)
	if job.watcher != nil {
		job.watcher.SetIgnores(job.ignores)
	}
	for rel := range job.state {
		if MatchIgnore(rel, job.ignores) {
			delete(job.state, rel)
		}
	}
	st := maps.Clone(job.state)
	file := job.stateFile
	base := job.remoteBase
	m.mu.Unlock()
	SaveSyncState(file, st, base)
	go m.rescan(clean)
}

func (m *Manager) resolveRoot(idOrPath string) (string, bool) {
	if idOrPath == "" {
		return "", false
	}
	for p, job := range m.roots {
		if job.pairID != "" && job.pairID == idOrPath {
			return p, true
		}
	}
	clean := filepath.Clean(idOrPath)
	if _, ok := m.roots[clean]; ok {
		return clean, true
	}
	if goruntime.GOOS != "linux" {
		for p := range m.roots {
			if strings.EqualFold(p, clean) {
				return p, true
			}
		}
	}
	return "", false
}

func (m *Manager) SetPaused(path string, paused bool) {
	m.mu.Lock()
	clean, ok := m.resolveRoot(path)
	if !ok {
		m.mu.Unlock()
		return
	}
	job := m.roots[clean]
	job.paused = paused
	job.status.Paused = paused
	if paused {
		job.status.Status = "paused"
		if m.pauseMode == "cancel" && job.opCancel != nil {
			job.opCancel()
		}
	} else {
		if job.status.Status == "paused" {
			if len(job.queue) > 0 {
				job.status.Status = "syncing"
			} else {
				job.status.Status = "idle"
			}
		}
	}
	m.mu.Unlock()
	m.broadcast()
	if !paused {
		go m.rescan(clean)
	}
}

func (m *Manager) CancelJob(jobID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, job := range m.roots {
		if fn, ok := job.activeCancel[jobID]; ok {
			fn()
			return true
		}
	}
	return false
}

func inside(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (m *Manager) Add(path string) (FolderState, error) {
	clean := filepath.Clean(path)
	info, err := os.Stat(clean)
	if err != nil {
		return FolderState{}, err
	}
	if !info.IsDir() {
		return FolderState{}, fmt.Errorf("not a folder")
	}
	m.mu.Lock()
	if job, ok := m.roots[clean]; ok {
		st := job.status
		m.mu.Unlock()
		return st, nil
	}
	for p := range m.roots {
		if inside(clean, p) || inside(p, clean) {
			m.mu.Unlock()
			return FolderState{}, fmt.Errorf("folder overlaps an existing watched folder")
		}
	}
	stateFile := filepath.Join(m.stateDir, config.SyncStateName(clean))
	ignores := mergeIgnores(DefaultIgnores, m.globalIgnores)
	w, err := NewWithIgnores(clean, ignores)
	if err != nil {
		m.mu.Unlock()
		return FolderState{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	snap, base, hasState := LoadSyncState(stateFile)
	if !hasState || (base != SyncRootSegment && !strings.HasPrefix(base, SyncRootSegment+"/")) {
		snap = Snapshot{}
		base = m.uniqueRemoteBase(remoteBaseForFolder(clean, localComputerSegment()))
	}
	FilterSnapshot(snap, ignores)
	pairID := config.NewOpaqueID("pair-")
	job := &rootJob{
		path:         clean,
		remoteBase:   base,
		pairID:       pairID,
		direction:    "upload-only",
		ctx:          ctx,
		stateFile:    stateFile,
		state:        snap,
		queue:        []string{},
		queued:       map[string]bool{},
		sizes:        map[string]int64{},
		attempts:     map[string]int{},
		status:       FolderState{Path: clean, RemotePath: remotePathForBase(base), PairID: pairID, Direction: "upload-only", Status: "scanning"},
		watcher:      w,
		cancel:       cancel,
		activeJobs:   map[string]string{},
		activeCancel: map[string]context.CancelFunc{},
		ignores:      ignores,
		downloading:  map[string]bool{},
		deletedAt:    map[string]time.Time{},
	}
	m.roots[clean] = job
	if m.conflicts == nil {
		m.conflicts = map[string][]Conflict{}
	}
	if m.pins == nil {
		m.pins = map[string]map[string]string{}
	}
	if _, ok := m.pins[pairID]; !ok {
		m.pins[pairID] = map[string]string{}
	}
	m.mu.Unlock()
	if err := w.Start(ctx); err != nil {
		m.mu.Lock()
		delete(m.roots, clean)
		m.mu.Unlock()
		cancel()
		return FolderState{}, err
	}
	go m.serve(job)
	m.broadcast()
	return m.get(clean), nil
}

type RemoveSyncResult struct {
	Deleted int `json:"deleted"`
	Skipped int `json:"skipped"`
	Failed  int `json:"failed"`
}

type RemovePreviewFile struct {
	Rel     string `json:"rel"`
	Name    string `json:"name"`
	Dir     string `json:"dir"`
	Size    int64  `json:"size"`
	Matched bool   `json:"matched"`
}

type RemoveSyncPreview struct {
	Files      []RemovePreviewFile `json:"files"`
	Total      int                 `json:"total"`
	Matched    int                 `json:"matched"`
	Unmatched  int                 `json:"unmatched"`
	Truncated  bool                `json:"truncated"`
	RemoteBase string              `json:"remoteBase"`
	RemotePath string              `json:"remotePath"`
}

type removeTarget struct {
	id   string
	rel  string
	name string
	dir  string
	size int64
}

func collectRemoveTargets(snapshot Snapshot, remoteBase string) []removeTarget {
	targets := make([]removeTarget, 0, len(snapshot))
	for rel, st := range snapshot {
		targets = append(targets, removeTarget{
			id:   st.RemoteID,
			rel:  rel,
			name: filepath.Base(filepath.FromSlash(rel)),
			dir:  remoteDirFor(rel, remoteBase),
			size: st.Size,
		})
	}
	slices.SortFunc(targets, func(a, b removeTarget) int { return strings.Compare(a.rel, b.rel) })
	return targets
}

func (m *Manager) snapshotFor(path string) (Snapshot, string, error) {
	clean := filepath.Clean(path)
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.roots[clean]
	if !ok {
		return nil, "", fmt.Errorf("folder is not watched")
	}
	return maps.Clone(job.state), job.remoteBase, nil
}

func (m *Manager) PreviewRemove(path string) (RemoveSyncPreview, error) {
	var preview RemoveSyncPreview
	preview.Files = []RemovePreviewFile{}
	snapshot, remoteBase, err := m.snapshotFor(path)
	if err != nil {
		return preview, err
	}
	preview.RemoteBase = remoteBase
	preview.RemotePath = remotePathForBase(remoteBase)
	client := m.client
	if client == nil || client.APIKey == "" || client.BaseURL == "" {
		return preview, fmt.Errorf("not connected")
	}
	targets := collectRemoveTargets(snapshot, remoteBase)
	preview.Total = len(targets)
	resolvedIDs := make([]string, len(targets))
	sem := make(chan struct{}, 4)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i, t := range targets {
		if t.id != "" {
			resolvedIDs[i] = t.id
			continue
		}
		wg.Add(1)
		go func(i int, t removeTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			id, err := m.findRemoteID(client, t.dir, t.name, t.size)
			if err != nil {
				return
			}
			mu.Lock()
			resolvedIDs[i] = id
			mu.Unlock()
		}(i, t)
	}
	wg.Wait()
	const maxPreviewFiles = 100
	for i, t := range targets {
		matched := resolvedIDs[i] != ""
		if matched {
			preview.Matched++
		} else {
			preview.Unmatched++
		}
		if len(preview.Files) < maxPreviewFiles {
			preview.Files = append(preview.Files, RemovePreviewFile{
				Rel:     filepath.ToSlash(t.rel),
				Name:    t.name,
				Dir:     t.dir,
				Size:    t.size,
				Matched: matched,
			})
		} else {
			preview.Truncated = true
		}
	}
	return preview, nil
}

func (m *Manager) Remove(path string) {
	_, _ = m.RemoveWithOptions(path, false)
}

func (m *Manager) RemoveWithOptions(path string, deleteRemote bool) (RemoveSyncResult, error) {
	var result RemoveSyncResult
	clean := filepath.Clean(path)
	m.mu.Lock()
	job, ok := m.roots[clean]
	m.mu.Unlock()
	if !ok {
		return result, fmt.Errorf("folder is not watched")
	}
	job.cancel()
	if job.opCancel != nil {
		job.opCancel()
	}

	var cancelled []transfers.Progress
	var snapshot Snapshot
	var remoteBase string
	var stateFile string
	m.mu.Lock()
	if j, exists := m.roots[clean]; exists {
		snapshot = maps.Clone(j.state)
		remoteBase = j.remoteBase
		stateFile = j.stateFile
		for id, name := range j.activeJobs {
			cancelled = append(cancelled, transfers.Progress{JobID: id, FileName: name, Status: "cancelled"})
			if fn, ok := j.activeCancel[id]; ok {
				fn()
			}
		}
		if len(cancelled) == 0 && j.jobID != "" {
			cancelled = append(cancelled, transfers.Progress{JobID: j.jobID, FileName: j.status.Current, Status: "cancelled"})
		}
		delete(m.roots, clean)
	}
	m.mu.Unlock()

	if deleteRemote {
		client := m.client
		if client == nil || client.APIKey == "" || client.BaseURL == "" {
			job.watcher.Stop()
			if m.emit != nil {
				for _, p := range cancelled {
					m.emit("upload:progress", p)
				}
			}
			m.broadcast()
			return result, fmt.Errorf("not connected")
		}
		result = m.deleteRemoteCopies(client, snapshot, remoteBase)
	}
	job.watcher.Stop()
	if deleteRemote && stateFile != "" {
		_ = os.Remove(stateFile)
	}
	if m.emit != nil {
		for _, p := range cancelled {
			m.emit("upload:progress", p)
		}
	}
	m.broadcast()
	return result, nil
}

func (m *Manager) RemovePair(pairID string, deleteRemote bool) (RemoveSyncResult, error) {
	var result RemoveSyncResult
	m.mu.Lock()
	clean, ok := m.resolveRoot(pairID)
	m.mu.Unlock()
	if !ok {
		return result, fmt.Errorf("pair not found")
	}
	return m.RemoveWithOptions(clean, deleteRemote)
}

func (m *Manager) PreviewRemovePair(pairID string) (RemoveSyncPreview, error) {
	var preview RemoveSyncPreview
	preview.Files = []RemovePreviewFile{}
	m.mu.Lock()
	clean, ok := m.resolveRoot(pairID)
	m.mu.Unlock()
	if !ok {
		return preview, fmt.Errorf("pair not found")
	}
	return m.PreviewRemove(clean)
}

func (m *Manager) deleteRemoteCopies(client *api.Client, snapshot Snapshot, remoteBase string) RemoveSyncResult {
	var result RemoveSyncResult
	targets := collectRemoveTargets(snapshot, remoteBase)

	sem := make(chan struct{}, 4)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, t := range targets {
		wg.Add(1)
		go func(t removeTarget) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			id := t.id
			if id == "" {
				var err error
				id, err = m.findRemoteID(client, t.dir, t.name, t.size)
				if err != nil || id == "" {
					mu.Lock()
					result.Skipped++
					mu.Unlock()
					return
				}
			}
			if err := client.DeleteFile(id); err != nil {
				mu.Lock()
				result.Failed++
				mu.Unlock()
				return
			}
			mu.Lock()
			result.Deleted++
			mu.Unlock()
		}(t)
	}
	wg.Wait()
	return result
}

func (m *Manager) findRemoteID(client *api.Client, dir, name string, size int64) (string, error) {
	cursor := ""
	for pages := 0; pages < 5; pages++ {
		list, err := client.ListFiles(dir, 100, cursor, name)
		if err != nil {
			return "", err
		}
		for _, f := range list.Files {
			if f.OriginalName == name && f.Size == size && f.Path == dir {
				return f.ID, nil
			}
		}
		if !list.HasMore || list.NextCursor == nil || *list.NextCursor == "" {
			break
		}
		cursor = *list.NextCursor
	}
	return "", nil
}

func (m *Manager) List() []FolderState {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]FolderState, 0, len(m.roots))
	for _, job := range m.roots {
		st := job.status
		preview := make([]string, 0, len(job.queue))
		for i, rel := range job.queue {
			if i >= 20 {
				break
			}
			preview = append(preview, filepath.ToSlash(rel))
		}
		st.Queued = preview
		st.Pending = len(job.queue) + job.inFlight
		out = append(out, st)
	}
	slices.SortFunc(out, func(a, b FolderState) int { return strings.Compare(a.Path, b.Path) })
	return out
}

func (m *Manager) get(path string) FolderState {
	m.mu.Lock()
	defer m.mu.Unlock()
	if job, ok := m.roots[path]; ok {
		st := job.status
		st.Pending = len(job.queue) + job.inFlight
		return st
	}
	return FolderState{Path: path, Status: "idle"}
}

func (m *Manager) broadcast() {
	if m.emit == nil {
		return
	}
	m.emit("sync:status", m.List())
}

func (m *Manager) update(path string, fn func(*FolderState)) {
	m.mu.Lock()
	if job, ok := m.roots[path]; ok {
		job.status.Pending = len(job.queue) + job.inFlight
		fn(&job.status)
	}
	m.mu.Unlock()
	m.broadcast()
}

func (m *Manager) enqueue(path, rel string, size int64) {
	m.mu.Lock()
	job, ok := m.roots[path]
	if !ok {
		m.mu.Unlock()
		return
	}
	if MatchIgnore(rel, job.ignores) {
		m.mu.Unlock()
		return
	}
	job.sizes[rel] = size
	if !job.queued[rel] {
		job.queued[rel] = true
		job.queue = append(job.queue, rel)
		if job.status.Status == "idle" {
			job.status.Status = "syncing"
		}
	}
	m.mu.Unlock()
	m.broadcast()
}

func (m *Manager) RescanAll() {
	m.mu.Lock()
	paths := make([]string, 0, len(m.roots))
	for p := range m.roots {
		paths = append(paths, p)
	}
	m.mu.Unlock()
	for _, p := range paths {
		go m.rescan(p)
	}
}

func (m *Manager) Rescan(idOrPath string) error {
	m.mu.Lock()
	clean, ok := m.resolveRoot(idOrPath)
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("pair not found")
	}
	go m.rescan(clean)
	return nil
}

func (m *Manager) ClearError(idOrPath string) error {
	m.mu.Lock()
	clean, ok := m.resolveRoot(idOrPath)
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("pair not found")
	}
	job, exists := m.roots[clean]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("pair not found")
	}
	job.status.Error = ""
	if job.status.Status == "error" {
		if job.paused {
			job.status.Status = "paused"
		} else if len(job.queue) > 0 {
			job.status.Status = "syncing"
		} else {
			job.status.Status = "idle"
		}
	}
	m.mu.Unlock()
	m.broadcast()
	return nil
}

func (m *Manager) rescan(path string) {
	m.update(path, func(s *FolderState) {
		if s.Status == "idle" {
			s.Status = "scanning"
		}
		s.Error = ""
	})
	m.scanAndEnqueue(path)
	m.pullNow(path)
}

func (m *Manager) pullNow(path string) {
	m.mu.Lock()
	job, ok := m.roots[path]
	if !ok {
		m.mu.Unlock()
		return
	}
	if job.paused {
		m.mu.Unlock()
		return
	}
	if !m.shouldPull(job.direction) {
		m.mu.Unlock()
		return
	}
	client := m.client
	policy := m.conflictPolicy
	m.mu.Unlock()
	if client == nil || client.APIKey == "" || client.BaseURL == "" {
		return
	}
	if err := m.pullRemote(job, client, policy); err != nil {
		return
	}
	m.mu.Lock()
	if j, exists := m.roots[path]; exists {
		j.lastRemotePoll = time.Now()
		j.remoteFails = 0
		j.remoteBackoffUntil = time.Time{}
	}
	m.mu.Unlock()
}

func (m *Manager) scanAndEnqueue(path string) {
	m.mu.Lock()
	job, ok := m.roots[path]
	if !ok {
		m.mu.Unlock()
		return
	}
	ignores := append([]string{}, job.ignores...)
	direction := job.direction
	m.mu.Unlock()
	snap, err := ScanWithIgnores(path, ignores)
	if err != nil {
		m.update(path, func(s *FolderState) { s.Status = "error"; s.Error = err.Error() })
		return
	}
	m.mu.Lock()
	job, ok = m.roots[path]
	if !ok {
		m.mu.Unlock()
		return
	}
	job.status.Files = len(snap)
	if direction != "" && !m.shouldPush(direction) {
		job.queue = []string{}
		job.queued = map[string]bool{}
		m.mu.Unlock()
		m.update(path, func(s *FolderState) {
			if s.Paused {
				s.Status = "paused"
				return
			}
			if s.Status == "scanning" {
				s.Status = "idle"
			}
		})
		return
	}
	old := job.state
	push := m.shouldPush(direction)
	client := m.client
	removed := map[string]string{}
	for rel, st := range old {
		if _, ok := snap[rel]; !ok {
			if job.downloading[rel] {
				continue
			}
			if !push {
				delete(job.state, rel)
				delete(job.queued, rel)
				continue
			}
			if recentlyDeleted(job, rel) {
				delete(job.state, rel)
				delete(job.queued, rel)
				continue
			}
			removed[rel] = st.RemoteID
			job.deletedAt[rel] = time.Now()
			delete(job.state, rel)
			delete(job.queued, rel)
		}
	}
	if len(removed) > 0 {
		gone := make(map[string]bool, len(removed))
		for rel := range removed {
			gone[rel] = true
		}
		dropQueued(job, gone)
		job.status.Files = len(snap)
		dirtyState := maps.Clone(job.state)
		stateFile := job.stateFile
		base := job.remoteBase
		m.mu.Unlock()
		SaveSyncState(stateFile, dirtyState, base)
		m.broadcast()
		if push && client != nil && client.APIKey != "" && client.BaseURL != "" {
			for _, id := range removed {
				if id != "" {
					go deleteRemoteRetry(client, id)
				}
			}
		}
		m.mu.Lock()
		job, ok = m.roots[path]
		if !ok {
			m.mu.Unlock()
			return
		}
		m.mu.Unlock()
	} else {
		m.mu.Unlock()
	}
	added, modified := DiffWithHash(old, snap)
	pending := append(added, modified...)
	slices.SortStableFunc(pending, func(a, b string) int {
		return cmp.Compare(snap[a].Size, snap[b].Size)
	})
	for _, rel := range pending {
		m.mu.Lock()
		skip := false
		if j, exists := m.roots[path]; exists && j.downloading[rel] {
			skip = true
		}
		m.mu.Unlock()
		if skip {
			continue
		}
		m.enqueue(path, rel, snap[rel].Size)
	}
	m.update(path, func(s *FolderState) {
		if s.Paused {
			s.Status = "paused"
			return
		}
		if s.Pending > 0 {
			s.Status = "syncing"
		} else if s.Status == "scanning" {
			s.Status = "idle"
		}
	})
}

func (m *Manager) serve(job *rootJob) {
	m.update(job.path, func(s *FolderState) { s.Status = "scanning"; s.Error = "" })
	m.scanAndEnqueue(job.path)
	go m.pullNow(job.path)
	ticker := time.NewTicker(500 * time.Millisecond)
	remoteTicker := time.NewTicker(45 * time.Second)
	defer ticker.Stop()
	defer remoteTicker.Stop()
	for {
		select {
		case <-job.ctx.Done():
			return
		case ev, ok := <-job.watcher.Events():
			if !ok {
				return
			}
			m.handleEvent(job, ev)
		case <-ticker.C:
			m.mu.Lock()
			idle := len(job.queue) == 0 && job.status.Status == "idle"
			m.mu.Unlock()
			if idle {
				continue
			}
			go m.pump(job)
		case <-remoteTicker.C:
			go m.maybePullRemote(job)
		}
	}
}

func (m *Manager) handleEvent(job *rootJob, ev Event) {
	if MatchIgnore(ev.Path, job.ignores) {
		return
	}
	if ev.Type == "deleted" {
		m.mu.Lock()
		prev, tracked := job.state[ev.Path]
		if tracked {
			job.deletedAt[ev.Path] = time.Now()
		}
		delete(job.downloading, ev.Path)
		dropQueued(job, map[string]bool{ev.Path: true})
		delete(job.state, ev.Path)
		st := maps.Clone(job.state)
		file := job.stateFile
		base := job.remoteBase
		direction := job.direction
		client := m.client
		m.mu.Unlock()
		SaveSyncState(file, st, base)
		m.broadcast()
		if tracked && prev.RemoteID != "" && m.shouldPush(direction) && client != nil && client.APIKey != "" && client.BaseURL != "" {
			go func(id string) {
				if !deleteRemoteRetry(client, id) {
					m.update(job.path, func(s *FolderState) { s.Error = "remote cleanup failed, retrying" })
				}
			}(prev.RemoteID)
		}
		return
	}
	local := filepath.Join(job.path, filepath.FromSlash(ev.Path))
	info, err := os.Stat(local)
	if err != nil || info.IsDir() {
		return
	}
	m.mu.Lock()
	if job.downloading[ev.Path] {
		m.mu.Unlock()
		return
	}
	if st, ok := job.state[ev.Path]; ok && st.Size == info.Size() && st.ModTime == info.ModTime().UnixNano() {
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	m.enqueue(job.path, ev.Path, info.Size())
}

func (m *Manager) maybePullRemote(job *rootJob) {
	m.mu.Lock()
	_, ok := m.roots[job.path]
	policy := m.conflictPolicy
	client := m.client
	dir := job.direction
	m.mu.Unlock()
	if !ok || client == nil || client.APIKey == "" || client.BaseURL == "" {
		return
	}
	if !m.shouldPull(dir) {
		return
	}
	m.mu.Lock()
	paused := job.paused
	last := job.lastRemotePoll
	backoffUntil := job.remoteBackoffUntil
	idle := len(job.queue) == 0 && job.status.Status == "idle"
	m.mu.Unlock()
	interval := 30 * time.Second
	if idle {
		interval = 90 * time.Second
	}
	if paused || time.Since(last) < interval || time.Now().Before(backoffUntil) {
		return
	}
	if err := m.pullRemote(job, client, policy); err != nil {
		m.mu.Lock()
		if j, exists := m.roots[job.path]; exists {
			j.remoteFails++
			shift := j.remoteFails
			if shift > 4 {
				shift = 4
			}
			j.remoteBackoffUntil = time.Now().Add(time.Duration(30<<shift) * time.Second)
			if j.remoteBackoffUntil.Sub(time.Now()) > 5*time.Minute {
				j.remoteBackoffUntil = time.Now().Add(5 * time.Minute)
			}
		}
		m.mu.Unlock()
		return
	}
	m.mu.Lock()
	if j, exists := m.roots[job.path]; exists {
		j.lastRemotePoll = time.Now()
		j.remoteFails = 0
		j.remoteBackoffUntil = time.Time{}
	}
	m.mu.Unlock()
}

type remoteFile struct {
	id   string
	size int64
}

func (m *Manager) listRemoteTree(client *api.Client, base string) (map[string]remoteFile, error) {
	out := map[string]remoteFile{}
	root := remotePathForBase(base)
	queue := []string{root}
	seen := map[string]bool{root: true}
	for len(queue) > 0 {
		dir := queue[0]
		queue = queue[1:]
		cursor := ""
		for {
			list, err := client.ListFiles(dir, 500, cursor, "")
			if err != nil {
				return out, err
			}
			for _, f := range list.Files {
				name := f.OriginalName
				if name == "" {
					name = f.FileName
				}
				fdir := f.Path
				if fdir == "" {
					fdir = dir
				}
				if !strings.HasSuffix(fdir, "/") {
					fdir += "/"
				}
				rel := strings.TrimPrefix(fdir+name, root)
				rel = strings.TrimPrefix(rel, "/")
				if rel == "" {
					continue
				}
				if _, exists := out[rel]; !exists {
					out[rel] = remoteFile{id: f.ID, size: f.Size}
				}
			}
			for _, fo := range list.Folders {
				sub := strings.Trim(fo, "/")
				if sub == "" {
					continue
				}
				next := dir + sub + "/"
				if !seen[next] {
					seen[next] = true
					queue = append(queue, next)
				}
			}
			if !list.HasMore || list.NextCursor == nil || *list.NextCursor == "" {
				break
			}
			cursor = *list.NextCursor
		}
	}
	return out, nil
}

func (m *Manager) pullRemote(job *rootJob, client *api.Client, policy string) error {
	remote, err := m.listRemoteTree(client, job.remoteBase)
	if err != nil {
		return err
	}
	m.mu.Lock()
	state := maps.Clone(job.state)
	ignores := append([]string{}, job.ignores...)
	pairID := job.pairID
	m.mu.Unlock()
	for rel, rf := range remote {
		if MatchIgnore(rel, ignores) {
			continue
		}
		if !m.shouldDownload(pairID, rel) {
			continue
		}
		local := filepath.Join(job.path, filepath.FromSlash(rel))
		if st, ok := state[rel]; ok && st.Size == rf.size {
			if info, err := os.Stat(local); err == nil && !info.IsDir() && info.Size() == rf.size {
				continue
			}
		}
		needsDownload := false
		if info, err := os.Stat(local); err != nil {
			needsDownload = true
		} else if info.IsDir() {
			continue
		} else if info.Size() != rf.size {
			base, tracked := state[rel]
			if tracked {
				localState := FileState{Size: info.Size(), ModTime: info.ModTime().UnixNano(), Hash: base.Hash}
				remoteState := FileState{Size: rf.size, Hash: ""}
				if BothChanged(localState, remoteState, base) {
					m.mu.Lock()
					m.addConflict(pairID, rel, info.Size(), rf.size)
					m.mu.Unlock()
					if policy == "skip" {
						continue
					}
				}
			}
			if policy == "skip" && !tracked {
				m.mu.Lock()
				m.addConflict(pairID, rel, info.Size(), rf.size)
				m.mu.Unlock()
				continue
			}
			needsDownload = true
		}
		if !needsDownload {
			continue
		}
		m.mu.Lock()
		if j, exists := m.roots[job.path]; exists {
			if j.downloading[rel] {
				m.mu.Unlock()
				continue
			}
			if recentlyDeleted(j, rel) {
				m.mu.Unlock()
				continue
			}
			j.downloading[rel] = true
		} else {
			m.mu.Unlock()
			continue
		}
		m.mu.Unlock()
		if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
			m.clearDownloading(job.path, rel)
			continue
		}
		dlStart := time.Now()
		jobID := transfers.NewJobID("sync-dl-")
		fileCtx, cancel := context.WithCancel(job.ctx)
		m.mu.Lock()
		if j, exists := m.roots[job.path]; exists {
			if j.activeCancel == nil {
				j.activeCancel = map[string]context.CancelFunc{}
			}
			j.activeCancel[jobID] = cancel
		}
		m.mu.Unlock()
		derr := transfers.DownloadFileWithID(fileCtx, client, rf.id, local, "attachment", jobID, m.emit)
		cancel()
		m.mu.Lock()
		if j, exists := m.roots[job.path]; exists {
			delete(j.activeCancel, jobID)
		}
		m.mu.Unlock()
		if derr != nil {
			m.clearDownloading(job.path, rel)
			continue
		}
		if info, err := os.Stat(local); err == nil && !info.IsDir() {
			m.mu.Lock()
			if j, exists := m.roots[job.path]; exists {
				if at, ok := j.deletedAt[rel]; ok && at.After(dlStart.Add(-time.Second)) {
					delete(j.downloading, rel)
					m.mu.Unlock()
					_ = os.Remove(local)
					continue
				}
				prev := j.state[rel]
				prev.RemoteID = rf.id
				prev.Size = info.Size()
				prev.ModTime = info.ModTime().UnixNano()
				prev.RemoteModTime = info.ModTime().UnixNano()
				j.state[rel] = prev
				delete(j.downloading, rel)
				SaveSyncState(j.stateFile, j.state, j.remoteBase)
				j.status.LastSync = time.Now().Unix()
			}
			m.mu.Unlock()
		} else {
			m.clearDownloading(job.path, rel)
		}
	}
	m.broadcast()
	return nil
}

func remoteDirFor(rel, remoteBase string) string {
	dir := filepath.ToSlash(filepath.Dir(rel))
	parts := make([]string, 0, 2)
	if remoteBase != "" {
		parts = append(parts, remoteBase)
	}
	if dir != "." && dir != "/" && dir != "" {
		parts = append(parts, strings.Trim(dir, "/"))
	}
	if len(parts) == 0 {
		return "/"
	}
	return "/" + strings.Join(parts, "/") + "/"
}

func remotePathForBase(remoteBase string) string {
	if remoteBase == "" {
		return "/"
	}
	return "/" + remoteBase + "/"
}

const SyncRootSegment = "Computers"

const deleteTombstoneTTL = 2 * time.Minute

func recentlyDeleted(job *rootJob, rel string) bool {
	at, ok := job.deletedAt[rel]
	if !ok {
		return false
	}
	if time.Since(at) > deleteTombstoneTTL {
		delete(job.deletedAt, rel)
		return false
	}
	return true
}

func deleteRemoteRetry(client *api.Client, id string) bool {
	for attempt := 0; attempt < 3; attempt++ {
		if err := client.DeleteFile(id); err == nil {
			return true
		}
		time.Sleep(time.Duration(1<<attempt) * time.Second)
	}
	return false
}

func (m *Manager) clearDownloading(path, rel string) {
	m.mu.Lock()
	if j, exists := m.roots[path]; exists {
		delete(j.downloading, rel)
	}
	m.mu.Unlock()
}

func dropQueued(job *rootJob, gone map[string]bool) {
	for rel := range gone {
		delete(job.queued, rel)
		delete(job.sizes, rel)
	}
	filtered := job.queue[:0]
	for _, q := range job.queue {
		if !gone[q] {
			filtered = append(filtered, q)
		}
	}
	job.queue = filtered
}

const maxComputerSegmentLen = 60
const maxFolderSegmentLen = 80

func localComputerSegment() string {
	host, err := os.Hostname()
	if err != nil {
		host = ""
	}
	seg := config.SanitizeSegment(host, maxComputerSegmentLen)
	if seg == "" || seg == "." || seg == ".." {
		return "unknown"
	}
	return seg
}

func remoteBaseForFolder(localPath, computer string) string {
	base := config.SanitizeSegment(filepath.Base(localPath), maxFolderSegmentLen)
	if base == "" || base == "." || base == ".." {
		base = "Sync"
	}
	comp := config.SanitizeSegment(computer, maxComputerSegmentLen)
	if comp == "" || comp == "." || comp == ".." {
		comp = "unknown"
	}
	return SyncRootSegment + "/" + comp + "/" + base
}

func (m *Manager) uniqueRemoteBase(desired string) string {
	candidate := desired
	for i := 2; ; i++ {
		taken := false
		for _, job := range m.roots {
			if job.remoteBase == candidate {
				taken = true
				break
			}
		}
		if !taken {
			return candidate
		}
		candidate = fmt.Sprintf("%s-%d", desired, i)
	}
}

func (m *Manager) pump(job *rootJob) {
	if !job.pumpMu.TryLock() {
		return
	}
	defer job.pumpMu.Unlock()
	m.mu.Lock()
	if m.client == nil || m.client.APIKey == "" || m.client.BaseURL == "" {
		m.mu.Unlock()
		return
	}
	if job.paused {
		if job.status.Status != "paused" {
			job.status.Status = "paused"
			m.mu.Unlock()
			m.broadcast()
			return
		}
		m.mu.Unlock()
		return
	}
	if job.ctx.Err() != nil {
		m.mu.Unlock()
		return
	}
	if job.direction != "" && !m.shouldPush(job.direction) {
		job.queue = []string{}
		job.queued = map[string]bool{}
		if job.status.Status == "syncing" {
			job.status.Status = "idle"
			job.status.Current = ""
		}
		m.mu.Unlock()
		return
	}
	opCtx, opCancel := context.WithCancel(job.ctx)
	job.opCancel = opCancel
	defer func() {
		opCancel()
		m.mu.Lock()
		if j, exists := m.roots[job.path]; exists {
			j.opCancel = nil
		}
		m.mu.Unlock()
	}()
	if len(job.queue) == 0 {
		if job.status.Status == "syncing" {
			job.status.Status = "idle"
			job.status.Current = ""
			m.mu.Unlock()
			m.broadcast()
			return
		}
		m.mu.Unlock()
		return
	}
	batchSize := transfers.DefaultFileConcurrency
	if batchSize < 1 {
		batchSize = 1
	}
	small := 0
	for small < len(job.queue) && small < transfers.SmallFileConcurrency && job.sizes[job.queue[small]] < transfers.SmallFileThreshold {
		small++
	}
	if small > batchSize {
		batchSize = small
	}
	if len(job.queue) < batchSize {
		batchSize = len(job.queue)
	}
	rels := make([]string, batchSize)
	copy(rels, job.queue[:batchSize])
	job.queue = job.queue[batchSize:]
	for _, rel := range rels {
		delete(job.queued, rel)
	}
	job.inFlight += len(rels)
	job.status.Status = "syncing"
	if len(rels) == 1 {
		job.status.Current = filepath.Base(rels[0])
	} else {
		job.status.Current = fmt.Sprintf("%d files", len(rels))
	}
	job.status.Progress = 0
	client := m.client
	m.mu.Unlock()
	m.broadcast()

	type outcome struct {
		rel     string
		missing bool
		isDir   bool
		busy    bool
		modTime int64
		fileID  string
		err     error
	}
	outcomes := make([]outcome, len(rels))
	var progMu sync.Mutex
	prog := make(map[string]float64, len(rels))

	var wg sync.WaitGroup
	for i, rel := range rels {
		wg.Add(1)
		go func(i int, rel string) {
			defer wg.Done()
			m.mu.Lock()
			if j, exists := m.roots[job.path]; exists && j.downloading[rel] {
				m.mu.Unlock()
				outcomes[i] = outcome{rel: rel, busy: true}
				return
			}
			m.mu.Unlock()
			local := filepath.Join(job.path, filepath.FromSlash(rel))
			info, err := os.Stat(local)
			if err != nil {
				outcomes[i] = outcome{rel: rel, missing: true}
				return
			}
			if info.IsDir() {
				outcomes[i] = outcome{rel: rel, isDir: true}
				return
			}
			jobID := transfers.NewJobID("sync-")
			fileCtx, fileCancel := context.WithCancel(opCtx)
			m.mu.Lock()
			if j, exists := m.roots[job.path]; exists {
				if j.activeJobs == nil {
					j.activeJobs = map[string]string{}
				}
				if j.activeCancel == nil {
					j.activeCancel = map[string]context.CancelFunc{}
				}
				j.activeJobs[jobID] = filepath.Base(rel)
				j.activeCancel[jobID] = fileCancel
				j.jobID = jobID
			} else {
				fileCancel()
			}
			m.mu.Unlock()
			wrapped := func(event string, payload any) {
				push := false
				if event == "upload:progress" {
					if p, ok := payload.(transfers.Progress); ok {
						progMu.Lock()
						prog[jobID] = p.Percent
						var sum float64
						for _, v := range prog {
							sum += v
						}
						avg := sum / float64(len(rels))
						progMu.Unlock()
						m.mu.Lock()
						if j, exists := m.roots[job.path]; exists {
							j.status.Progress = avg
							if p.Status == "done" || p.Status == "error" || time.Since(j.lastPush) > 300*time.Millisecond {
								j.lastPush = time.Now()
								push = true
							}
						}
						m.mu.Unlock()
					}
				}
				if m.emit != nil {
					m.emit(event, payload)
				}
				if push {
					m.broadcast()
				}
			}
			fileID, uerr := transfers.UploadFileWithID(fileCtx, client, local, remoteDirFor(rel, job.remoteBase), jobID, wrapped)
			fileCancel()
			m.mu.Lock()
			if j, exists := m.roots[job.path]; exists {
				delete(j.activeJobs, jobID)
				delete(j.activeCancel, jobID)
				j.jobID = ""
			}
			m.mu.Unlock()
			outcomes[i] = outcome{rel: rel, fileID: fileID, err: uerr}
		}(i, rel)
	}
	wg.Wait()

	m.mu.Lock()
	j, ok := m.roots[job.path]
	if !ok {
		m.mu.Unlock()
		m.broadcast()
		return
	}
	j.inFlight -= len(rels)
	dirty := false
	var missingIDs []string
	for _, o := range outcomes {
		switch {
		case o.missing:
			delete(j.sizes, o.rel)
			if prev, exists := j.state[o.rel]; exists {
				if prev.RemoteID != "" {
					j.deletedAt[o.rel] = time.Now()
					if m.shouldPush(j.direction) {
						missingIDs = append(missingIDs, prev.RemoteID)
					}
				}
				delete(j.state, o.rel)
				dirty = true
			}
		case o.isDir:
		case o.busy:
			if !j.queued[o.rel] {
				j.queued[o.rel] = true
				j.queue = append(j.queue, o.rel)
			}
		case o.err != nil:
			if opCtx.Err() != nil || job.ctx.Err() != nil {
				if !j.queued[o.rel] {
					j.queued[o.rel] = true
					j.queue = append(j.queue, o.rel)
				}
				continue
			}
			j.attempts[o.rel]++
			if j.attempts[o.rel] >= 3 {
				delete(j.attempts, o.rel)
				delete(j.sizes, o.rel)
				j.status.Error = filepath.Base(o.rel) + ": " + o.err.Error()
			} else if !j.queued[o.rel] {
				j.queued[o.rel] = true
				j.queue = append(j.queue, o.rel)
			}
		default:
			delete(j.attempts, o.rel)
			delete(j.sizes, o.rel)
			if fi, serr := os.Stat(filepath.Join(job.path, filepath.FromSlash(o.rel))); serr == nil && !fi.IsDir() {
				st := FileState{Size: fi.Size(), ModTime: fi.ModTime().UnixNano(), RemoteModTime: fi.ModTime().UnixNano()}
				if prev, exists := j.state[o.rel]; exists {
					st.RemoteID = prev.RemoteID
					st.Hash = prev.Hash
				}
				if o.fileID != "" {
					st.RemoteID = o.fileID
				}
				j.state[o.rel] = st
				dirty = true
			}
			j.status.LastSync = time.Now().Unix()
			j.status.Error = ""
		}
	}
	if dirty {
		SaveSyncState(j.stateFile, j.state, j.remoteBase)
	}
	if j.paused {
		j.status.Status = "paused"
	} else if len(j.queue) == 0 {
		j.status.Status = "idle"
		j.status.Current = ""
		j.status.Progress = 0
	} else {
		j.status.Status = "syncing"
	}
	m.mu.Unlock()
	m.broadcast()
	if len(missingIDs) > 0 && client != nil && client.APIKey != "" && client.BaseURL != "" {
		for _, id := range missingIDs {
			go deleteRemoteRetry(client, id)
		}
	}
}
