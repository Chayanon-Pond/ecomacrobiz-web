// Package ratelimit is an in-memory keyed token-bucket limiter with idle
// entry cleanup. State is per process: with several API replicas each one
// enforces its own budget (acceptable for this site's traffic).
package ratelimit

import (
	"math"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type entry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

type Limiter struct {
	mu      sync.Mutex
	entries map[string]*entry
	limit   rate.Limit
	burst   int
	idle    time.Duration
	stop    chan struct{}
	once    sync.Once
}

// New allows `events` per `per` for each key, as a burst that refills evenly.
func New(events int, per time.Duration) *Limiter {
	return &Limiter{
		entries: map[string]*entry{},
		limit:   rate.Limit(float64(events) / per.Seconds()),
		burst:   events,
		idle:    per, // a key idle for a whole window has a full bucket again
		stop:    make(chan struct{}),
	}
}

// Allow consumes one token for key at now. When denied it returns how long
// until a token is available.
func (l *Limiter) Allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(l.limit, l.burst)}
		l.entries[key] = e
	}
	e.lastSeen = now
	r := e.lim.ReserveN(now, 1)
	if !r.OK() {
		return false, time.Duration(math.MaxInt64)
	}
	if d := r.DelayFrom(now); d > 0 {
		r.CancelAt(now)
		return false, d
	}
	return true, 0
}

// Cleanup removes keys idle for longer than one window.
func (l *Limiter) Cleanup(now time.Time) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for k, e := range l.entries {
		if now.Sub(e.lastSeen) > l.idle {
			delete(l.entries, k)
			n++
		}
	}
	return n
}

func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.entries)
}

// StartJanitor runs Cleanup every interval until Stop.
func (l *Limiter) StartJanitor(interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case now := <-t.C:
				l.Cleanup(now)
			case <-l.stop:
				return
			}
		}
	}()
}

func (l *Limiter) Stop() { l.once.Do(func() { close(l.stop) }) }
