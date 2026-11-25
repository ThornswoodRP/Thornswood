package main

import (
	"errors"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func waitWatch(t *testing.T, predicate func() bool) {
	t.Helper()
	limit := time.After(time.Second)
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		if predicate() {
			return
		}
		select {
		case <-limit:
			t.Fatal("watch state not observed")
		case <-tick.C:
		}
	}
}
func TestStartupNotificationCannotPublishStaleInventory(t *testing.T) {
	old := []netip.Addr{netip.MustParseAddr("8.8.8.8")}
	fresh := append(append([]netip.Addr{}, old...), netip.MustParseAddr("1.1.1.1"))
	var notify func()
	var calls atomic.Int32
	var closed atomic.Int32
	w, e := newAddressWatch(func() ([]netip.Addr, error) {
		if calls.Add(1) == 1 {
			notify()
			return old, nil
		}
		return fresh, nil
	}, func(f func()) (func() error, error) {
		notify = f
		return func() error { closed.Add(1); return nil }, nil
	})
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	got, e := w.current()
	if e != nil || !sameInventory(got, fresh) || calls.Load() < 2 {
		t.Fatal("startup race published old inventory", e)
	}
	w.Close()
	if closed.Load() != 1 {
		t.Fatal("native notification subscription leaked")
	}
}
func TestUnchangedAndPrivateNotificationDoesNotRestartHealthyRelay(t *testing.T) {
	var notify func()
	var changed atomic.Bool
	w, e := newAddressWatch(func() ([]netip.Addr, error) {
		private := "10.0.0.1"
		if changed.Load() {
			private = "10.0.0.2"
		}
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr(private)}, nil
	}, func(f func()) (func() error, error) { notify = f; return func() error { return nil }, nil })
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	changed.Store(true)
	notify()
	waitWatch(t, func() bool { _, e := w.current(); return e == nil })
	select {
	case <-w.changed:
		t.Fatal("inactive/private notification caused restart")
	default:
	}
}
func TestAddedPublicAliasSuspendsAndStopsWithoutStaleCache(t *testing.T) {
	var notify func()
	var changed atomic.Bool
	entered := make(chan struct{})
	release := make(chan struct{})
	var released atomic.Bool
	defer func() {
		if released.CompareAndSwap(false, true) {
			close(release)
		}
	}()
	w, e := newAddressWatch(func() ([]netip.Addr, error) {
		all := []netip.Addr{netip.MustParseAddr("8.8.8.8")}
		if changed.Load() {
			close(entered)
			<-release
			all = append(all, netip.MustParseAddr("1.1.1.1"))
		}
		return all, nil
	}, func(f func()) (func() error, error) { notify = f; return func() error { return nil }, nil })
	if e != nil {
		t.Fatal(e)
	}
	changed.Store(true)
	notify()
	<-entered
	if _, e := w.current(); e == nil {
		t.Fatal("forwarding admitted while alias change was unverified")
	}
	released.Store(true)
	close(release)
	select {
	case <-w.changed:
	case <-time.After(time.Second):
		t.Fatal("new alias did not stop relay")
	}
	if _, e := w.current(); e == nil {
		t.Fatal("invalidated inventory resumed")
	}
	w.Close()
}
func TestAddressQueryFailureIsTerminalAndStartupIsBounded(t *testing.T) {
	var notify func()
	var failed atomic.Bool
	w, e := newAddressWatch(func() ([]netip.Addr, error) {
		if failed.Load() {
			return nil, errors.New("inert query failure")
		}
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}, func(f func()) (func() error, error) { notify = f; return func() error { return nil }, nil })
	if e != nil {
		t.Fatal(e)
	}
	defer w.Close()
	failed.Store(true)
	notify()
	select {
	case <-w.changed:
	case <-time.After(time.Second):
		t.Fatal("query failure did not stop relay")
	}
	var calls atomic.Int32
	var unsub atomic.Int32
	_, e = newAddressWatch(func() ([]netip.Addr, error) { calls.Add(1); notify(); return nil, nil }, func(f func()) (func() error, error) {
		notify = f
		return func() error { unsub.Add(1); return nil }, nil
	})
	if e == nil || calls.Load() != 8 || unsub.Load() != 1 {
		t.Fatal("unstable startup unbounded or leaked subscription")
	}
}
