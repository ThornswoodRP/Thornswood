package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"github.com/pion/turn/v5"
	"golang.org/x/time/rate"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"time"
)

func freeBlock(t *testing.T) (int, int) {
	t.Helper()
	for try := 0; try < 64; try++ {
		var b [2]byte
		if _, e := rand.Read(b[:]); e != nil {
			t.Fatal(e)
		}
		first := 16000 + (int(b[0])*256+int(b[1]))%30000
		var held []*net.UDPConn
		ok := true
		for p := first; p < first+32; p++ {
			c, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: p})
			if e != nil {
				ok = false
				break
			}
			held = append(held, c)
		}
		for _, c := range held {
			_ = c.Close()
		}
		if ok {
			return first, first + 31
		}
	}
	t.Fatal("no owned test block")
	return 0, 0
}
func alloc(t *testing.T, g *allocator, user string) *guardedConn {
	t.Helper()
	c, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4", UserID: user, Realm: g.realm})
	if e != nil {
		t.Fatal(e)
	}
	return c.(*guardedConn)
}
func testAllocator(t *testing.T) *allocator {
	a, b := freeBlock(t)
	g := newAllocator(netip.MustParseAddr("127.0.0.1"), a, b, "fixture", &counters{})
	t.Cleanup(g.shutdown)
	return g
}
func TestPublicPeerPolicy(t *testing.T) {
	for _, s := range []string{"0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "fc00::1", "::ffff:127.0.0.1"} {
		if public4(netip.MustParseAddr(s)) {
			t.Errorf("forbidden peer accepted: %s", s)
		}
	}
	if !public4(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("public IPv4 refused")
	}
}
func TestActualBoundaryDropsSelfNonAllocationAndPreservesRelay(t *testing.T) {
	g := testAllocator(t)
	a := alloc(t, g, "one")
	b := alloc(t, g, "two")
	marker, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer marker.Close()
	if _, port, _ := address(marker.LocalAddr()); port >= g.min && port <= g.max {
		t.Fatal("marker overlaps reserved range")
	}
	if n, e := a.WriteTo([]byte("must not arrive"), marker.LocalAddr()); n != 15 || e != nil {
		t.Fatalf("drop contract: %d %v", n, e)
	}
	_ = marker.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
	buf := make([]byte, 128)
	if _, _, e = marker.ReadFrom(buf); e == nil {
		t.Fatal("same-host non-allocation UDP marker received forbidden data")
	}
	_, _ = marker.WriteTo([]byte("bad inbound"), a.LocalAddr())
	_, _ = b.WriteTo([]byte("valid inbound"), a.LocalAddr())
	_ = a.SetReadDeadline(time.Now().Add(time.Second))
	n, _, e := a.ReadFrom(buf)
	if e != nil || !bytes.Equal(buf[:n], []byte("valid inbound")) {
		t.Fatalf("allocated-peer input lost: %q %v", buf[:n], e)
	}
	_, _ = a.WriteTo([]byte("valid reverse"), b.LocalAddr())
	_ = b.SetReadDeadline(time.Now().Add(time.Second))
	n, _, e = b.ReadFrom(buf)
	if e != nil || !bytes.Equal(buf[:n], []byte("valid reverse")) {
		t.Fatal("relay reverse path lost", e)
	}
	if g.stats.self.Load() < 2 {
		t.Fatal("both directions of self guard were not exercised")
	}
}
func TestCloseRevokesDestinationBeforePortReuse(t *testing.T) {
	g := testAllocator(t)
	a := alloc(t, g, "a")
	b := alloc(t, g, "b")
	target := b.LocalAddr()
	_ = b.Close()
	_ = b.Close()
	ip, port, _ := address(target)
	marker, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IP(ip.AsSlice()), Port: port})
	if e != nil {
		t.Fatal(e)
	}
	defer marker.Close()
	_, _ = a.WriteTo([]byte("blocked reused service"), target)
	_ = marker.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
	buf := make([]byte, 64)
	if _, _, e = marker.ReadFrom(buf); e == nil {
		t.Fatal("non-relay service inherited a closed allocation's permission")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.users["b"] != 0 || len(g.active) != 1 {
		t.Fatal("closed allocation quota leaked")
	}
}
func TestAtomicUserAndGlobalQuota(t *testing.T) {
	g := testAllocator(t)
	var one []*guardedConn
	for i := 0; i < 8; i++ {
		one = append(one, alloc(t, g, "same"))
	}
	if _, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4", UserID: "same", Realm: g.realm}); e == nil {
		t.Fatal("per-credential quota exceeded")
	}
	for _, c := range one {
		_ = c.Close()
	}
	var mu sync.Mutex
	var active []net.PacketConn
	var wg sync.WaitGroup
	for i := 0; i < 96; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4", UserID: fmt.Sprint(i), Realm: g.realm})
			if e == nil {
				mu.Lock()
				active = append(active, c)
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if len(active) != 32 {
		t.Fatalf("capacity=%d, want32", len(active))
	}
	for _, c := range active {
		_ = c.Close()
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.active) != 0 || len(g.users) != 0 {
		t.Fatal("allocation lifecycle leaked state")
	}
}
func TestRequestedPortAndTransportCannotBypassPolicy(t *testing.T) {
	g := testAllocator(t)
	for _, c := range []turn.AllocateListenerConfig{{Network: "udp6", UserID: "u", Realm: g.realm}, {Network: "udp4", UserID: "u", Realm: g.realm, RequestedPort: g.max + 1}, {Network: "tcp4", UserID: "u", Realm: g.realm}, {Network: "udp4", UserID: "u", Realm: "other"}} {
		if _, _, e := g.AllocatePacketConn(c); e == nil {
			t.Fatal("invalid allocation policy accepted")
		}
	}
	if _, _, e := g.AllocateListener(turn.AllocateListenerConfig{}); e == nil {
		t.Fatal("TCP accepted")
	}
	if _, e := g.AllocateConn(turn.AllocateConnConfig{}); e == nil {
		t.Fatal("outbound TCP accepted")
	}
	probe, _, e := g.AllocatePacketConn(turn.AllocateListenerConfig{Network: "udp4"})
	if e != nil {
		t.Fatal(e)
	}
	_ = probe.Close()
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.active) != 0 || len(g.users) != 0 {
		t.Fatal("temporary probe quota leaked")
	}
}
func TestActualBandwidthDropDoesNotKillAllocation(t *testing.T) {
	g := testAllocator(t)
	a := alloc(t, g, "a")
	b := alloc(t, g, "b")
	a.limit = rate.NewLimiter(1, 1)
	_, _ = a.WriteTo([]byte("x"), b.LocalAddr())
	_, _ = a.WriteTo([]byte("y"), b.LocalAddr())
	_ = b.PacketConn.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 8)
	n, _, e := b.PacketConn.ReadFrom(buf)
	if e != nil || n != 1 || buf[0] != 'x' {
		t.Fatal("first packet lost")
	}
	_ = b.PacketConn.SetReadDeadline(time.Now().Add(50 * time.Millisecond))
	if _, _, e = b.PacketConn.ReadFrom(buf); e == nil {
		t.Fatal("bandwidth limit bypassed")
	}
	if a.closed.Load() || g.stats.throttled.Load() != 1 {
		t.Fatal("drop killed allocation or was not counted")
	}
}
func TestRESTMatchesExistingNumericExpiryIssuer(t *testing.T) {
	now := time.Unix(1800000000, 0)
	secret := []byte("fixture-key")
	user := strconv.FormatInt(now.Unix()+3600, 10)
	s := &counters{}
	auth := restAuth(secret, "fixture", func() time.Time { return now }, s)
	id, key, ok := auth(&turn.RequestAttributes{Username: user, Realm: "fixture"})
	if !ok || id != user {
		t.Fatal("valid expiry rejected")
	}
	h := hmac.New(sha1.New, secret)
	_, _ = h.Write([]byte(user))
	want := turn.GenerateAuthKey(user, "fixture", base64.StdEncoding.EncodeToString(h.Sum(nil)))
	if !hmac.Equal(key, want) {
		t.Fatal("HMAC mismatch")
	}
	for _, v := range []turn.RequestAttributes{{Username: "1799999999", Realm: "fixture"}, {Username: "1800009999", Realm: "fixture"}, {Username: user, Realm: "other"}, {Username: "+" + user, Realm: "fixture"}} {
		if _, _, ok = auth(&v); ok {
			t.Fatal("expired/future/malformed/wrong realm accepted")
		}
	}
}

func TestOversizedDatagramDoesNotEndAllocation(t *testing.T) {
	g := testAllocator(t)
	a := alloc(t, g, "a")
	b := alloc(t, g, "b")
	if _, e := b.PacketConn.WriteTo(make([]byte, 4096), a.LocalAddr()); e != nil {
		t.Fatal(e)
	}
	if _, e := b.PacketConn.WriteTo([]byte("normal"), a.LocalAddr()); e != nil {
		t.Fatal(e)
	}
	_ = a.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 1600)
	n, _, e := a.ReadFrom(buf)
	if e != nil || string(buf[:n]) != "normal" || g.stats.oversized.Load() != 1 {
		t.Fatal("oversize ended or truncated allocation", n, e)
	}
}
