package sync

import (
	"context"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

var DefaultIgnores = []string{
	".git/",
	"node_modules/",
	".DS_Store",
	"Thumbs.db",
	"~$*",
	"*.tmp",
	"*.mocha-tmp",
	"*.part",
	"*.mocha-part",
}

func MatchIgnore(rel string, patterns []string) bool {
	rel = filepath.ToSlash(rel)
	fold := goruntime.GOOS != "linux"
	lower := rel
	if fold {
		lower = strings.ToLower(rel)
	}
	base := lower
	if i := strings.LastIndex(lower, "/"); i >= 0 {
		base = lower[i+1:]
	}
	for _, p := range patterns {
		raw := strings.TrimSpace(p)
		if raw == "" {
			continue
		}
		pat := raw
		if fold {
			pat = strings.ToLower(raw)
		}
		if strings.HasSuffix(pat, "/") {
			dir := strings.TrimSuffix(pat, "/")
			if lower == dir || strings.HasPrefix(lower, dir+"/") || strings.Contains(lower, "/"+dir+"/") || strings.HasSuffix(lower, "/"+dir) || base == dir {
				return true
			}
			continue
		}
		if strings.Contains(pat, "/") {
			if ok, _ := path.Match(pat, lower); ok {
				return true
			}
			continue
		}
		if ok, _ := path.Match(pat, base); ok {
			return true
		}
		if base == pat || lower == pat {
			return true
		}
	}
	return false
}

func FilterSnapshot(s Snapshot, patterns []string) {
	for rel := range s {
		if MatchIgnore(rel, patterns) {
			delete(s, rel)
		}
	}
}

type FileState struct {
	Size          int64  `json:"size"`
	ModTime       int64  `json:"modTime"`
	Hash          string `json:"hash,omitempty"`
	RemoteID      string `json:"remoteId,omitempty"`
	RemoteModTime int64  `json:"remoteModTime,omitempty"`
}

type Snapshot map[string]FileState

type Event struct {
	Type string `json:"type"`
	Path string `json:"path"`
	Time int64  `json:"time"`
}

type Watcher struct {
	mu       sync.Mutex
	w        *fsnotify.Watcher
	root     string
	out      chan Event
	cancel   context.CancelFunc
	debounce map[string]time.Time
	ignores  []string
}

func (s *Watcher) SetIgnores(patterns []string) {
	s.mu.Lock()
	s.ignores = patterns
	s.mu.Unlock()
}

func (s *Watcher) Ignores() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string{}, s.ignores...)
}

func LoadSyncState(stateFile string) (Snapshot, string, bool) {
	s := Snapshot{}
	raw, err := os.ReadFile(stateFile)
	if err != nil {
		return s, "", false
	}
	var ps persistedSyncState
	if err := json.Unmarshal(raw, &ps); err != nil {
		return s, "", true
	}
	if ps.Files == nil {
		ps.Files = Snapshot{}
	}
	return ps.Files, ps.RemoteBase, true
}

type persistedSyncState struct {
	RemoteBase string   `json:"remoteBase,omitempty"`
	Files      Snapshot `json:"files"`
}

func SaveSyncState(stateFile string, s Snapshot, remoteBase string) {
	if s == nil {
		s = Snapshot{}
	}
	raw, _ := json.MarshalIndent(persistedSyncState{RemoteBase: remoteBase, Files: s}, "", "  ")
	tmp := stateFile + ".mocha-tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return
	}
	if f, err := os.OpenFile(tmp, os.O_WRONLY, 0o600); err == nil {
		_ = f.Sync()
		_ = f.Close()
	}
	_ = os.Rename(tmp, stateFile)
	if d, err := os.Open(filepath.Dir(stateFile)); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

func ScanWithIgnores(root string, patterns []string) (Snapshot, error) {
	s := Snapshot{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		rel, rerr := filepath.Rel(root, p)
		if rerr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if len(patterns) > 0 && MatchIgnore(rel, patterns) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		s[rel] = FileState{Size: info.Size(), ModTime: info.ModTime().UnixNano()}
		return nil
	})
	return s, err
}

func Diff(old, next Snapshot) (added, modified []string) {
	added = []string{}
	modified = []string{}
	for k, v := range next {
		o, ok := old[k]
		if !ok {
			added = append(added, k)
			continue
		}
		if o.Size != v.Size || o.ModTime != v.ModTime {
			modified = append(modified, k)
		}
	}
	return added, modified
}

func DiffWithHash(old, next Snapshot) (added, modified []string) {
	added = []string{}
	modified = []string{}
	for k, v := range next {
		o, ok := old[k]
		if !ok {
			added = append(added, k)
			continue
		}
		if o.Size != v.Size || o.Hash != v.Hash {
			if o.Hash == "" && v.Hash == "" && o.ModTime == v.ModTime && o.Size == v.Size {
				continue
			}
			modified = append(modified, k)
		}
	}
	return added, modified
}

func BothChanged(local, remote, base FileState) bool {
	localChanged := local.Size != base.Size || local.Hash != base.Hash
	remoteChanged := remote.Size != base.Size || remote.Hash != base.Hash
	return localChanged && remoteChanged
}

func NewWithIgnores(root string, patterns []string) (*Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{w: w, root: root, out: make(chan Event, 4096), debounce: map[string]time.Time{}, ignores: patterns}, nil
}

func (s *Watcher) Events() <-chan Event { return s.out }

func (s *Watcher) Start(ctx context.Context) error {
	if s.root == "" {
		return nil
	}
	if err := os.MkdirAll(s.root, 0o755); err != nil {
		return err
	}
	ignores := s.Ignores()
	var dirs []string
	_ = filepath.WalkDir(s.root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		if p != s.root {
			if rel, rerr := filepath.Rel(s.root, p); rerr == nil {
				if MatchIgnore(filepath.ToSlash(rel)+"/", ignores) {
					return filepath.SkipDir
				}
			}
		}
		dirs = append(dirs, p)
		return nil
	})
	for _, d := range dirs {
		if err := s.w.Add(d); err != nil {
			_ = s.w.Close()
			return err
		}
	}
	c, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	go s.loop(c)
	return nil
}

func (s *Watcher) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	_ = s.w.Close()
}

func (s *Watcher) loop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-s.w.Events:
			if !ok {
				return
			}
			if strings.HasSuffix(ev.Name, ".mocha-tmp") || strings.HasSuffix(ev.Name, ".mocha-part") {
				continue
			}
			info, err := os.Stat(ev.Name)
			if err == nil && info.IsDir() {
				_ = s.w.Add(ev.Name)
				continue
			}
			rel, err := filepath.Rel(s.root, ev.Name)
			if err != nil {
				continue
			}
			rel = filepath.ToSlash(rel)
			if MatchIgnore(rel, s.Ignores()) {
				continue
			}
			now := time.Now()
			s.mu.Lock()
			last, ok := s.debounce[rel]
			if ok && now.Sub(last) < 500*time.Millisecond {
				s.mu.Unlock()
				continue
			}
			s.debounce[rel] = now
			s.mu.Unlock()
			typ := "changed"
			if ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
				typ = "deleted"
			} else if ev.Op&fsnotify.Create != 0 {
				typ = "added"
			}
			select {
			case s.out <- Event{Type: typ, Path: rel, Time: now.Unix()}:
			case <-ctx.Done():
				return
			}
		case <-s.w.Errors:
		}
	}
}
