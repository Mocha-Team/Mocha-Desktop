package sync

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"mocha-desktop/backend/api"
	"mocha-desktop/backend/config"
)

func TestResolveKeepBothKeepsLoser(t *testing.T) {
	m := NewManager(t.TempDir(), nil)
	id := "p1"
	m.conflicts = map[string][]Conflict{id: {{PairID: id, Rel: "a.txt"}}}
	if err := m.ResolveConflict(id, "a.txt", "keep-both"); err != nil {
		t.Fatalf("resolve = %v", err)
	}
	if len(m.ListConflicts(id)) != 0 {
		t.Fatalf("conflict should clear")
	}
}

func TestPinCloudSkipsDownload(t *testing.T) {
	m := NewManager(t.TempDir(), nil)
	m.pins = map[string]map[string]string{"p1": {"a.jpg": "cloud"}}
	if m.shouldDownload("p1", "a.jpg") {
		t.Fatalf("cloud pin should skip")
	}
}

func TestPumpAndPullGates(t *testing.T) {
	m := NewManager(t.TempDir(), nil)
	if !m.shouldPush("upload-only") || m.shouldPull("upload-only") {
		t.Fatalf("upload-only gate wrong")
	}
	if m.shouldPush("download-only") || !m.shouldPull("download-only") {
		t.Fatalf("download-only gate wrong")
	}
	if !m.shouldPush("mirror") || !m.shouldPull("mirror") {
		t.Fatalf("mirror gate wrong")
	}
	if m.shouldDownload("p1", "missing.jpg") != true {
		t.Fatalf("missing pin should download")
	}
	if err := m.SetFilePin("p1", "b.jpg", "keep"); err != nil {
		t.Fatalf("set pin = %v", err)
	}
	if !m.shouldDownload("p1", "b.jpg") {
		t.Fatalf("keep pin should download")
	}
	if m.GetFilePins("p1")["b.jpg"] != "keep" {
		t.Fatalf("pin not stored")
	}
}

func TestAddWithPairKeepsExistingRoot(t *testing.T) {
	local := t.TempDir()
	m := NewManager(t.TempDir(), nil)
	defer m.Remove(local)
	first := config.Pair{ID: "first", LocalPath: local, RemotePath: "", Direction: config.Direction("upload-only"), PinDefault: "keep"}
	st, err := m.AddWithPair(first)
	if err != nil {
		t.Fatalf("first add = %v", err)
	}
	if st.PairID != "first" {
		t.Fatalf("pair = %s", st.PairID)
	}
	second := config.Pair{ID: "second", LocalPath: local, RemotePath: "/Computers/pc/pics/", Direction: config.Direction("download-only"), PinDefault: "keep"}
	st2, err := m.AddWithPair(second)
	if err != nil {
		t.Fatalf("second add = %v", err)
	}
	if st2.PairID != "first" {
		t.Fatalf("existing root reassigned pair = %s", st2.PairID)
	}
	if st2.Direction != "upload-only" {
		t.Fatalf("existing root reassigned direction = %s", st2.Direction)
	}
}

func TestListRemoteForAttachIncludesEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"files":[{"id":"e1","original_name":"empty.txt","file_name":"empty.txt","size":0,"path":"/remote/"},{"id":"f1","original_name":"full.txt","file_name":"full.txt","size":5,"path":"/remote/"}],"folders":[],"hasMore":false}`))
	}))
	defer srv.Close()
	m := NewManager(t.TempDir(), nil)
	m.SetClient(api.New(srv.URL, "k"))
	out, err := m.ListRemoteForAttach("remote")
	if err != nil {
		t.Fatalf("list = %v", err)
	}
	seen := map[string]bool{}
	for _, f := range out {
		seen[f.Rel] = true
	}
	if !seen["empty.txt"] {
		t.Fatalf("empty file missing from picker")
	}
	if !seen["full.txt"] {
		t.Fatalf("full file missing from picker")
	}
}

func TestAttachRemoteSurfacesListError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer srv.Close()
	state := t.TempDir()
	local := filepath.Join(t.TempDir(), "sub")
	m := NewManager(state, nil)
	defer m.Remove(local)
	m.SetClient(api.New(srv.URL, "k"))
	if _, err := m.AttachRemote("remote", local, "mirror", nil); err == nil {
		t.Fatalf("list fail should surface error")
	}
}

func TestPullSkipsCloudPin(t *testing.T) {
	presignedHits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/files/fid1/presigned" {
			presignedHits++
			_, _ = w.Write([]byte(`{"url":"http://127.0.0.1/"}`))
			return
		}
		_, _ = w.Write([]byte(`{"files":[{"id":"fid1","original_name":"a.txt","file_name":"a.txt","size":4,"path":"/base/"}],"folders":[],"hasMore":false}`))
	}))
	defer srv.Close()
	local := t.TempDir()
	m := NewManager(t.TempDir(), nil)
	defer m.Remove(local)
	if _, err := m.Add(local); err != nil {
		t.Fatalf("add = %v", err)
	}
	clean := filepath.Clean(local)
	m.mu.Lock()
	job := m.roots[clean]
	job.remoteBase = "base"
	job.pairID = "p1"
	if m.pins == nil {
		m.pins = map[string]map[string]string{}
	}
	m.pins["p1"] = map[string]string{"a.txt": "cloud"}
	m.mu.Unlock()
	m.SetClient(api.New(srv.URL, "k"))
	if err := m.pullRemote(job, m.client, "skip"); err != nil {
		t.Fatalf("pull = %v", err)
	}
	if presignedHits != 0 {
		t.Fatalf("cloud pin should skip download hits = %d", presignedHits)
	}
	if _, err := os.Stat(filepath.Join(local, "a.txt")); !os.IsNotExist(err) {
		t.Fatalf("cloud pin file should not exist")
	}
}
