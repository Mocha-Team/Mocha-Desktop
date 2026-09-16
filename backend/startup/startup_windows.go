//go:build windows

package startup

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
const runValueName = "Mocha Desktop"

func Enable() error {
	exe, err := os.Executable()
	if err != nil || strings.TrimSpace(exe) == "" {
		return err
	}
	exe = filepath.Clean(exe)
	if strings.Contains(exe, " ") && !strings.HasPrefix(exe, `"`) {
		exe = `"` + exe + `"`
	}
	cmd := exe + " " + HiddenArg
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue(runValueName, cmd)
}

func Disable() error {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return nil
	}
	defer key.Close()
	_ = key.DeleteValue(runValueName)
	return nil
}
