package config

import "testing"

func TestEnsureDeviceIDStable(t *testing.T) {
  s := Store{}
  first := s.EnsureDeviceID()
  if first == "" {
    t.Fatalf("id empty")
  }
  second := s.EnsureDeviceID()
  if first != second {
    t.Fatalf("id rotated without request")
  }
}

func TestNewDeviceIDUnique(t *testing.T) {
	if NewOpaqueID("dev-") == NewOpaqueID("dev-") {
		t.Fatalf("ids collide")
	}
}
