package ratelimit

import (
	"sync"
	"testing"
	"time"
)

func TestBurstThenDenyThenRefill(t *testing.T) {
	l := New(5, 10*time.Minute)
	now := time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow("ip:1", now); !ok {
			t.Fatalf("request %d denied", i+1)
		}
	}
	ok, wait := l.Allow("ip:1", now)
	if ok {
		t.Fatal("6th request allowed")
	}
	// one token per 2 minutes
	if wait < 119*time.Second || wait > 121*time.Second {
		t.Fatalf("retry after = %v", wait)
	}
	// denied attempts must not consume tokens (cancelled reservation)
	for i := 0; i < 10; i++ {
		l.Allow("ip:1", now)
	}
	if ok, _ := l.Allow("ip:1", now.Add(2*time.Minute+time.Second)); !ok {
		t.Fatal("token should have refilled after 2m")
	}
	if ok, _ := l.Allow("ip:1", now.Add(2*time.Minute+2*time.Second)); ok {
		t.Fatal("only one token should have refilled")
	}
}

func TestKeysAreIndependent(t *testing.T) {
	l := New(1, time.Minute)
	now := time.Now()
	if ok, _ := l.Allow("a", now); !ok {
		t.Fatal()
	}
	if ok, _ := l.Allow("a", now); ok {
		t.Fatal("a should be limited")
	}
	if ok, _ := l.Allow("b", now); !ok {
		t.Fatal("b must not share a's bucket")
	}
}

func TestCleanup(t *testing.T) {
	l := New(3, time.Minute)
	now := time.Now()
	l.Allow("old", now)
	l.Allow("new", now.Add(50*time.Second))
	if n := l.Cleanup(now.Add(90 * time.Second)); n != 1 || l.Len() != 1 {
		t.Fatalf("cleanup removed %d, %d left", n, l.Len())
	}
}

func TestConcurrentAllow(t *testing.T) {
	l := New(100, time.Hour)
	now := time.Now()
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ok, _ := l.Allow("k", now); ok {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if allowed != 100 {
		t.Fatalf("allowed %d, want 100", allowed)
	}
}

func TestJanitorStops(t *testing.T) {
	l := New(1, time.Millisecond)
	l.StartJanitor(time.Millisecond)
	l.Allow("x", time.Now().Add(-time.Second))
	deadline := time.Now().Add(time.Second)
	for l.Len() != 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	l.Stop()
	l.Stop() // idempotent
	if l.Len() != 0 {
		t.Fatal("janitor did not clean up")
	}
}
