package sync

import "testing"

func TestDiffWithHashIgnoresSameSizeSameHash(t *testing.T) {
	old := Snapshot{"a.jpg": FileState{Size: 4, ModTime: 10, Hash: "h1"}}
	next := Snapshot{"a.jpg": FileState{Size: 4, ModTime: 20, Hash: "h1"}}
	_, modified := DiffWithHash(old, next)
	if len(modified) != 0 {
		t.Fatalf("modified = %v", modified)
	}
}

func TestBothChangedNeedsPrompt(t *testing.T) {
	base := FileState{Size: 4, ModTime: 10, Hash: "h1"}
	local := FileState{Size: 5, ModTime: 30, Hash: "h2"}
	remote := FileState{Size: 6, ModTime: 40, Hash: "h3"}
	if !BothChanged(local, remote, base) {
		t.Fatalf("should prompt")
	}
}
