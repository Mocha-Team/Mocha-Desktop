//go:build !windows

package updater

func LaunchInstaller(path string) error {
	return OpenPath(path)
}
