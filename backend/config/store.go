package config

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Settings struct {
	PauseMode          string   `json:"pauseMode,omitempty"`
	GlobalIgnores      []string `json:"globalIgnores,omitempty"`
	ConflictPolicy     string   `json:"conflictPolicy,omitempty"`
	BidirectionalSync  bool     `json:"bidirectionalSync,omitempty"`
	FilesView          string   `json:"filesView,omitempty"`
	ContextMenuEnabled bool     `json:"contextMenu,omitempty"`
	LaunchAtStartup    bool     `json:"launchAtStartup,omitempty"`
}

type FolderSettings struct {
	Ignores []string `json:"ignores,omitempty"`
	Paused  bool     `json:"paused,omitempty"`
}

type Direction string

type Pair struct {
	ID         string    `json:"id"`
	LocalPath  string    `json:"localPath"`
	RemotePath string    `json:"remotePath"`
	Direction  Direction `json:"direction"`
	PinDefault string    `json:"pinDefault"`
}

type Store struct {
	AppURL         string                    `json:"appUrl"`
	ApiURL         string                    `json:"apiUrl"`
	SyncFolder     string                    `json:"syncFolder,omitempty"`
	SyncFolders    []string                  `json:"syncFolders"`
	Pairs          []Pair                    `json:"pairs,omitempty"`
	Settings       Settings                  `json:"settings,omitempty"`
	FolderSettings map[string]FolderSettings `json:"folderSettings,omitempty"`
}

func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	d := filepath.Join(base, "mocha-desktop")
	if err := os.MkdirAll(d, 0o700); err != nil {
		return "", err
	}
	return d, nil
}

func path() (string, error) {
	d, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "config.json"), nil
}

func Load() (Store, error) {
	var s Store
	p, err := path()
	if err != nil {
		return s, err
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return s, err
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return Store{}, err
	}
	if len(s.SyncFolders) == 0 && strings.TrimSpace(s.SyncFolder) != "" {
		s.SyncFolders = []string{s.SyncFolder}
		s.SyncFolder = ""
	}
	if s.SyncFolders == nil {
		s.SyncFolders = []string{}
	}
	if s.FolderSettings == nil {
		s.FolderSettings = map[string]FolderSettings{}
	}
	if s.Pairs == nil {
		s.Pairs = []Pair{}
	}
	s = MigratePairs(s)
	if s.Settings.PauseMode != "cancel" {
		s.Settings.PauseMode = "drain"
	}
	if s.Settings.ConflictPolicy == "" {
		s.Settings.ConflictPolicy = "skip"
	}
	return s, nil
}

func Save(s Store) error {
	p, err := path()
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0o600)
}

func MigratePairs(s Store) Store {
	if len(s.Pairs) > 0 {
		return s
	}
	for _, p := range s.SyncFolders {
		clean := filepath.Clean(p)
		s.Pairs = append(s.Pairs, Pair{
			ID:         newPairID(clean),
			LocalPath:  clean,
			RemotePath: migrateRemotePath(clean),
			Direction:  Direction("upload-only"),
			PinDefault: "keep",
		})
	}
	return s
}

func ValidatePair(p Pair) error {
	if strings.TrimSpace(p.LocalPath) == "" {
		return fmt.Errorf("local path required")
	}
	if p.Direction != Direction("upload-only") && p.Direction != Direction("download-only") && p.Direction != Direction("mirror") {
		return fmt.Errorf("direction required")
	}
	if strings.TrimSpace(p.RemotePath) == "" && p.Direction != Direction("upload-only") {
		return fmt.Errorf("remote path required")
	}
	return nil
}

func ValidatePairs(pairs []Pair) error {
	seen := map[string]bool{}
	seenRemote := map[string]bool{}
	for _, p := range pairs {
		if err := ValidatePair(p); err != nil {
			return err
		}
		clean := filepath.Clean(p.LocalPath)
		key := strings.ToLower(clean)
		for q := range seen {
			if key == q {
				return fmt.Errorf("duplicate folder")
			}
			rel, err := filepath.Rel(q, key)
			if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				return fmt.Errorf("folder overlaps")
			}
			rel2, err2 := filepath.Rel(key, q)
			if err2 == nil && rel2 != "." && rel2 != ".." && !strings.HasPrefix(rel2, ".."+string(filepath.Separator)) {
				return fmt.Errorf("folder overlaps")
			}
		}
		seen[key] = true
		rb := strings.ToLower(strings.Trim(strings.TrimSpace(p.RemotePath), "/"))
		if rb != "" {
			if seenRemote[rb] {
				return fmt.Errorf("duplicate remote")
			}
			seenRemote[rb] = true
		}
	}
	return nil
}

func newPairID(clean string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err == nil {
		return "pair-" + hex.EncodeToString(b[:])
	}
	h := sha1.Sum([]byte(clean))
	return "pair-" + hex.EncodeToString(h[:])[:12]
}

func NewPairID() string {
	return newPairID("")
}

func migrateRemotePath(clean string) string {
	if base := remoteBaseFromState(clean); base != "" {
		return "/" + strings.Trim(base, "/") + "/"
	}
	host, _ := os.Hostname()
	comp := sanitizeSegment(host, 60)
	if comp == "" {
		comp = "unknown"
	}
	name := sanitizeSegment(filepath.Base(clean), 80)
	if name == "" {
		name = "Sync"
	}
	return "/Computers/" + comp + "/" + name + "/"
}

func remoteBaseFromState(clean string) string {
	d, err := Dir()
	if err != nil {
		return ""
	}
	h := sha1.Sum([]byte(clean))
	name := "sync-" + hex.EncodeToString(h[:])[:16] + ".json"
	raw, err := os.ReadFile(filepath.Join(d, name))
	if err != nil {
		return ""
	}
	var ps struct {
		RemoteBase string `json:"remoteBase"`
	}
	if err := json.Unmarshal(raw, &ps); err != nil {
		return ""
	}
	return strings.TrimSpace(ps.RemoteBase)
}

func sanitizeSegment(value string, maxLen int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > maxLen {
		runes = runes[:maxLen]
	}
	cleaned := strings.Trim(strings.Trim(string(runes), "."), " ")
	for _, r := range []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"} {
		cleaned = strings.ReplaceAll(cleaned, r, "-")
	}
	return strings.TrimSpace(cleaned)
}

func ApiBase(s Store) string {
	base := strings.TrimSpace(s.ApiURL)
	if base == "" {
		base = strings.TrimSpace(s.AppURL)
	}
	base = strings.TrimRight(base, "/")
	if base == "" {
		return ""
	}
	if strings.HasSuffix(base, "/api") {
		return base
	}
	return base + "/api"
}
