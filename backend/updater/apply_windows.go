//go:build windows

package updater

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func LaunchInstaller(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("installer path required")
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	dir, err := windows.UTF16PtrFromString(filepath.Dir(path))
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, nil, dir, windows.SW_SHOWNORMAL)
}
