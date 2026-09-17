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

func TestValidatePairsAcceptsSiblings(t *testing.T) {
	a := Pair{ID: "a", LocalPath: `C:\pics`, RemotePath: "/Computers/pc/pics/", Direction: Direction("mirror")}
	b := Pair{ID: "b", LocalPath: `C:\music`, RemotePath: "/Computers/pc/music/", Direction: Direction("mirror")}
	if err := ValidatePairs([]Pair{a, b}); err != nil {
		t.Fatalf("siblings should pass: %v", err)
	}
}

func TestMigratePairsOutputValidates(t *testing.T) {
	s := Store{SyncFolders: []string{`C:\pics`, `C:\music`}}
	out := MigratePairs(s)
	if err := ValidatePairs(out.Pairs); err != nil {
		t.Fatalf("migrated should validate: %v", err)
	}
}

func TestValidatePairsRejectsDuplicateCaseInsensitive(t *testing.T) {
	a := Pair{ID: "a", LocalPath: `C:\pics`, RemotePath: "/Computers/pc/pics/", Direction: Direction("mirror")}
	b := Pair{ID: "b", LocalPath: `C:\PICS`, RemotePath: "/Photos/", Direction: Direction("mirror")}
	if ValidatePairs([]Pair{a, b}) == nil {
		t.Fatalf("duplicate should fail")
	}
}

func TestValidatePairRejectsBadDirection(t *testing.T) {
	p := Pair{ID: "a", LocalPath: `C:\pics`, RemotePath: "/Photos/", Direction: Direction("sideways")}
	if ValidatePair(p) == nil {
		t.Fatalf("bad direction should fail")
	}
}
