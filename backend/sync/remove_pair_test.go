package sync

import (
	"os"
	"path/filepath"
	"testing"

	"mocha-desktop/backend/api"
	"mocha-desktop/backend/config"
)

func TestRemovePairKeepsStateUnlessDeleteRemote(t *testing.T) {
	state := t.TempDir()
	local := t.TempDir()
	m := NewManager(state, nil)
	p := config.Pair{ID: "pair-7", LocalPath: local, RemotePath: "", Direction: config.Direction("upload-only"), PinDefault: "keep"}
	st, err := m.AddWithPair(p)
	if err != nil {
		t.Fatalf("add = %v", err)
	}
	if st.PairID != "pair-7" {
		t.Fatalf("pair = %s", st.PairID)
	}
	m.mu.Lock()
	job := m.roots[filepath.Clean(local)]
	stateFile := job.stateFile
	m.mu.Unlock()
	SaveSyncState(stateFile, Snapshot{}, job.remoteBase)
	if _, err := os.Stat(stateFile); err != nil {
		t.Fatalf("state missing = %v", err)
	}
	if _, err := m.RemovePair("pair-7", false); err != nil {
		t.Fatalf("remove keep = %v", err)
	}
	if _, err := os.Stat(stateFile); err != nil {
		t.Fatalf("state should remain without deleteRemote = %v", err)
	}
	st2, err := m.AddWithPair(p)
	if err != nil {
		t.Fatalf("re-add = %v", err)
	}
	_ = st2
	m.mu.Lock()
	job2 := m.roots[filepath.Clean(local)]
	stateFile2 := job2.stateFile
	m.mu.Unlock()
	SaveSyncState(stateFile2, Snapshot{}, job2.remoteBase)
	m.SetClient(api.New("http://127.0.0.1", "k"))
	if _, err := m.RemovePair("pair-7", true); err != nil {
		t.Fatalf("remove delete = %v", err)
	}
	if _, err := os.Stat(stateFile2); !os.IsNotExist(err) {
		t.Fatalf("state should delete with deleteRemote")
	}
}
