package config

import (
	"strings"
	"testing"
)

func TestIndexNowKey(t *testing.T) {
	c, err := LoadFrom(env(map[string]string{"INDEXNOW_KEY": "a1b2c3d4-e5f6"}))
	if err != nil || c.IndexNowKey != "a1b2c3d4-e5f6" {
		t.Fatalf("valid key: %+v %v", c, err)
	}
	for _, k := range []string{"short", "has space 12345", "under_score_123", strings.Repeat("a", 129)} {
		if _, err := LoadFrom(env(map[string]string{"INDEXNOW_KEY": k})); err == nil ||
			!strings.Contains(err.Error(), "INDEXNOW_KEY") {
			t.Errorf("INDEXNOW_KEY=%q accepted: %v", k, err)
		}
	}
}
