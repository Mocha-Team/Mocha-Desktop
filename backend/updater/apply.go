package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func WritableDir(path string) bool {
	dir := filepath.Dir(strings.TrimSpace(path))
	if dir == "" || dir == "." {
		return false
	}
	probe, err := os.CreateTemp(dir, ".write-test-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return true
}

func ReplaceExecutable(currentExe, newFile string) error {
	currentExe = strings.TrimSpace(currentExe)
	newFile = strings.TrimSpace(newFile)
	if currentExe == "" || newFile == "" {
		return fmt.Errorf("current and replacement paths required")
	}
	raw, err := os.ReadFile(newFile)
	if err != nil {
		return err
	}
	dir := filepath.Dir(currentExe)
	tmp, err := os.CreateTemp(dir, ".update-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	done := false
	defer func() {
		_ = tmp.Close()
		if !done {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := tmp.Write(raw); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o755); err != nil {
		return err
	}
	if err := os.Rename(tmpName, currentExe); err != nil {
		return err
	}
	done = true
	return nil
}

func OpenPath(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("path required")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
}
