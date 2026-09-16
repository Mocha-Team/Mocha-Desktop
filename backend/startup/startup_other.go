//go:build !windows

package startup

import (
	"errors"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
)

func autostartPath() (string, error) {
	switch goruntime.GOOS {
	case "linux":
		base, err := os.UserConfigDir()
		if err != nil || strings.TrimSpace(base) == "" {
			home, herr := os.UserHomeDir()
			if herr != nil {
				return "", err
			}
			base = filepath.Join(home, ".config")
		}
		return filepath.Join(base, "autostart", "mocha-desktop.desktop"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "LaunchAgents", "com.mocha.desktop.plist"), nil
	default:
		return "", errors.New("launch at startup not supported on this platform")
	}
}

func Enable() error {
	exe, err := os.Executable()
	if err != nil || strings.TrimSpace(exe) == "" {
		return err
	}
	exe = filepath.Clean(exe)
	path, err := autostartPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if goruntime.GOOS == "darwin" {
		plist := `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
			`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` + "\n" +
			`<plist version="1.0">` + "\n" +
			`<dict>` + "\n" +
			"  <key>Label</key><string>com.mocha.desktop</string>\n" +
			"  <key>ProgramArguments</key>\n" +
			"  <array>\n" +
			"    <string>" + exe + "</string>\n" +
			"    <string>" + HiddenArg + "</string>\n" +
			"  </array>\n" +
			"  <key>RunAtLoad</key><true/>\n" +
			"</dict>\n" +
			"</plist>\n"
		return os.WriteFile(path, []byte(plist), 0o644)
	}
	quoted := exe
	if strings.Contains(exe, " ") && !strings.HasPrefix(exe, `"`) {
		quoted = `"` + exe + `"`
	}
	entry := "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=Mocha Desktop\n" +
		"Exec=" + quoted + " " + HiddenArg + "\n" +
		"Hidden=false\n" +
		"NoDisplay=false\n" +
		"X-GNOME-Autostart-enabled=true\n"
	return os.WriteFile(path, []byte(entry), 0o644)
}

func Disable() error {
	path, err := autostartPath()
	if err != nil {
		return nil
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
