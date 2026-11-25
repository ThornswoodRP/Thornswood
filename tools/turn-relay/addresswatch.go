package main

import (
	"net/netip"
	"sync"
	"sync/atomic"
)

// The OS callback suspends forwarding immediately. A worker compares only
// public IPv4 aliases; unchanged/lifetime-only/private-interface notifications
// resume the same inventory without restarting a healthy relay.
type addressWatch struct {
	epoch       atomic.Uint64
	verified    atomic.Uint64
	invalid     atomic.Bool
	wake        chan struct{}
	changed     chan struct{}
	stop        chan struct{}
	done        chan struct{}
	once        sync.Once
	addresses   []netip.Addr
	unsubscribe func() error
	query       func() ([]netip.Addr, error)
}

func publicInventory(all []netip.Addr) map[netip.Addr]bool {
	out := map[netip.Addr]bool{}
	for _, a := range all {
		a = a.Unmap()
		if public4(a) {
			out[a] = true
		}
	}
	return out
}
func sameInventory(a, b []netip.Addr) bool {
	x, y := publicInventory(a), publicInventory(b)
	if len(x) != len(y) {
		return false
	}
	for ip := range x {
		if !y[ip] {
			return false
		}
	}
	return true
}
func newAddressWatch(query func() ([]netip.Addr, error), subscribe func(func()) (func() error, error)) (*addressWatch, error) {
	w := &addressWatch{wake: make(chan struct{}, 1), changed: make(chan struct{}), stop: make(chan struct{}), done: make(chan struct{}), query: query}
	w.epoch.Store(1)
	unsub, e := subscribe(func() {
		w.epoch.Add(1)
		select {
		case w.wake <- struct{}{}:
		default:
		}
	})
	if e != nil {
		return nil, e
	}
	w.unsubscribe = unsub
	// Subscribe BEFORE enumerating. A concurrent notification invalidates this
	// sample and forces a new bounded startup sample, never an old published map.
	for attempt := 0; attempt < 8; attempt++ {
		version := w.epoch.Load()
		all, e := query()
		if e != nil {
			_ = unsub()
			return nil, e
		}
		if version != w.epoch.Load() {
			continue
		}
		w.addresses = all
		w.verified.Store(version)
		go w.run()
		return w, nil
	}
	_ = unsub()
	return nil, errPolicy
}
func (w *addressWatch) current() ([]netip.Addr, error) {
	if w.invalid.Load() || w.verified.Load() != w.epoch.Load() {
		return nil, errPolicy
	}
	return w.addresses, nil
}
func (w *addressWatch) run() {
	defer close(w.done)
	for {
		select {
		case <-w.stop:
			return
		case <-w.wake:
			version := w.epoch.Load()
			all, e := w.query()
			if e != nil || !sameInventory(w.addresses, all) {
				w.invalid.Store(true)
				close(w.changed)
				return
			}
			// If another event arrived during enumeration, leave forwarding suspended
			// until its queued notification gets a fresh sample.
			if version == w.epoch.Load() {
				w.verified.Store(version)
			}
		}
	}
}
func (w *addressWatch) Close() { w.once.Do(func() { _ = w.unsubscribe(); close(w.stop); <-w.done }) }
