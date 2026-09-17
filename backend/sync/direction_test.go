package sync

import "testing"

func TestDirectionGateSkipsPull(t *testing.T) {
	m := NewManager(t.TempDir(), nil)
	m.SetBidirectional(false, "skip")
	got := m.shouldPull("upload-only")
	if got {
		t.Fatalf("upload-only should not pull")
	}
	if !m.shouldPush("upload-only") {
		t.Fatalf("upload-only should push")
	}
}
