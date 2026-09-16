package startup

import (
	"os"
	goruntime "runtime"
)

const HiddenArg = "--hidden"

func Supported() bool {
	switch goruntime.GOOS {
	case "windows", "linux", "darwin":
		return true
	default:
		return false
	}
}

func StartedHidden() bool {
	for _, arg := range os.Args[1:] {
		if arg == HiddenArg {
			return true
		}
	}
	return false
}
