package api

import "testing"

func TestHeartbeatRevoked(t *testing.T) {
  revoked, _ := parseHeartbeatBody([]byte(`{"revoked":true}`))
  if !revoked {
    t.Fatalf("should be revoked")
  }
  revoked, _ = parseHeartbeatBody([]byte(`{"revoked":false,"computer":{"id":"1"}}`))
  if revoked {
    t.Fatalf("should not be revoked")
  }
  revoked, _ = parseHeartbeatBody([]byte(`{}`))
  if revoked {
    t.Fatalf("missing flag means allowed")
  }
}
