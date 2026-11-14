package config

import (
	"strings"
	"testing"
	"time"
)

func TestContentSettings(t *testing.T) {
	c, err := LoadFrom(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.SchedulerInterval != time.Minute || c.MediaMaxDimension != 2560 {
		t.Fatalf("defaults: interval=%v dim=%d", c.SchedulerInterval, c.MediaMaxDimension)
	}
	c, err = LoadFrom(env(map[string]string{"SCHEDULER_INTERVAL": "5s", "MEDIA_MAX_DIMENSION": "1600"}))
	if err != nil || c.SchedulerInterval != 5*time.Second || c.MediaMaxDimension != 1600 {
		t.Fatalf("parse: %+v %v", c, err)
	}
	for k, v := range map[string]string{"SCHEDULER_INTERVAL": "4s", "MEDIA_MAX_DIMENSION": "100"} {
		if _, err := LoadFrom(env(map[string]string{k: v})); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("%s=%s accepted: %v", k, v, err)
		}
	}
}
