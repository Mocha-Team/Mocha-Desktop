package config

import (
	"encoding/json"
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

type Store struct {
	AppURL         string                    `json:"appUrl"`
	ApiURL         string                    `json:"apiUrl"`
	SyncFolder     string                    `json:"syncFolder,omitempty"`
	SyncFolders    []string                  `json:"syncFolders"`
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
