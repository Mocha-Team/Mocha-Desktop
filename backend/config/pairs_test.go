package config

import "testing"

func TestMigratePairsKeepsRemoteBase(t *testing.T) {
	s := Store{SyncFolders: []string{`C:\pics`}}
	out := MigratePairs(s)
	if len(out.Pairs) != 1 {
		t.Fatalf("pairs = %d", len(out.Pairs))
	}
	if out.Pairs[0].Direction != Direction("upload-only") {
		t.Fatalf("direction = %s", out.Pairs[0].Direction)
	}
	if out.Pairs[0].LocalPath == "" {
		t.Fatalf("local empty")
	}
}

func TestValidatePairRejectsNested(t *testing.T) {
	a := Pair{ID: "a", LocalPath: `C:\pics`, RemotePath: "/Computers/pc/pics/", Direction: Direction("mirror")}
	b := Pair{ID: "b", LocalPath: `C:\pics\raw`, RemotePath: "/Photos/", Direction: Direction("mirror")}
	if ValidatePair(a) != nil {
		t.Fatalf("a should pass")
	}
	if ValidatePairs([]Pair{a, b}) == nil {
		t.Fatalf("nested should fail")
	}
}
