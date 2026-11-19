// Package main runs the operator-only UDP TURN relay. No game/client code.
package main

import (
	"crypto/hmac"
	"crypto/sha1" // TURN REST compatibility, not a password hash.
	"encoding/base64"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/turn/v5"
	"golang.org/x/time/rate"
)

var errPolicy = errors.New("relay policy refused")
var forbidden = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/3"),
}

func public4(a netip.Addr) bool {
	a = a.Unmap()
	if !a.Is4() || !a.IsGlobalUnicast() {
		return false
	}
	for _, p := range forbidden {
		if p.Contains(a) {
			return false
		}
	}
	return true
}
func address(a net.Addr) (netip.Addr, int, bool) {
	u, ok := a.(*net.UDPAddr)
	if !ok || u == nil || u.Zone != "" || u.Port < 1 || u.Port > 65535 {
		return netip.Addr{}, 0, false
	}
	ip, ok := netip.AddrFromSlice(u.IP)
	if !ok {
		return netip.Addr{}, 0, false
	}
	return ip.Unmap(), u.Port, true
}

type counters struct{ private, self, throttled, rejected, created, oversized atomic.Uint64 }
type allocator struct {
	mu             sync.Mutex
	own            netip.Addr
	min, max, next int
	realm          string
	users          map[string]int
	active         map[int]*guardedConn
	closed         bool
	global         *rate.Limiter
	stats          *counters
}

func newAllocator(own netip.Addr, min, max int, realm string, s *counters) *allocator {
	return &allocator{own: own.Unmap(), min: min, max: max, realm: realm, users: map[string]int{}, active: map[int]*guardedConn{}, global: rate.NewLimiter(2097152, 2097152), stats: s}
}
func (g *allocator) Validate() error {
	if !g.own.Is4() || g.min < 1024 || g.max >= 49152 || g.max-g.min != 31 || g.realm == "" {
		return errPolicy
	}
	return nil
}
func (g *allocator) quota(user, realm string, _ net.Addr) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return !g.closed && realm == g.realm && g.users[user] < 8 && len(g.active) < 32
}
func (g *allocator) permission(_ net.Addr, ip net.IP) bool {
	a, ok := netip.AddrFromSlice(ip)
	return ok && (a.Unmap() == g.own || public4(a))
}
func (g *allocator) AllocatePacketConn(c turn.AllocateListenerConfig) (net.PacketConn, net.Addr, error) {
	if c.Network != "udp4" || c.RequestedPort != 0 && (c.RequestedPort < g.min || c.RequestedPort > g.max) {
		return nil, nil, errPolicy
	}
	// Pion's bounded EVEN-PORT probe has empty identity and closes immediately.
	probe := c.UserID == "" && c.Realm == "" && c.RequestedPort == 0
	if !probe && (c.UserID == "" || c.Realm != g.realm) {
		return nil, nil, errPolicy
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed || g.users[c.UserID] >= 8 || len(g.active) >= 32 {
		return nil, nil, errPolicy
	}
	attempts := g.max - g.min + 1
	if c.RequestedPort != 0 {
		attempts = 1
	}
	for n := 0; n < attempts; n++ {
		port := c.RequestedPort
		if port == 0 {
			port = g.min + g.next%(g.max-g.min+1)
			g.next++
		}
		if g.active[port] != nil {
			continue
		}
		udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IP(g.own.AsSlice()), Port: port})
		if err != nil {
			continue
		}
		wrapped := &guardedConn{PacketConn: udp, g: g, port: port, user: c.UserID, limit: rate.NewLimiter(65536, 65536)}
		wrapped.receive = make([]byte, 65535)
		g.active[port] = wrapped
		g.users[c.UserID]++
		g.stats.created.Add(1)
		return wrapped, &net.UDPAddr{IP: net.IP(g.own.AsSlice()), Port: port}, nil
	}
	return nil, nil, errPolicy
}
func (g *allocator) AllocateListener(turn.AllocateListenerConfig) (net.Listener, net.Addr, error) {
	return nil, nil, errPolicy
}
func (g *allocator) AllocateConn(turn.AllocateConnConfig) (net.Conn, error) { return nil, errPolicy }
func (g *allocator) shutdown() {
	g.mu.Lock()
	g.closed = true
	all := make([]*guardedConn, 0, len(g.active))
	for _, c := range g.active {
		all = append(all, c)
	}
	g.mu.Unlock()
	for _, c := range all {
		_ = c.Close()
	}
}

type guardedConn struct {
	net.PacketConn
	g       *allocator
	port    int
	user    string
	limit   *rate.Limiter
	closed  atomic.Bool
	once    sync.Once
	writeMu sync.Mutex
	readMu  sync.Mutex
	receive []byte
}

func (c *guardedConn) permitted(a net.Addr) (bool, bool) {
	ip, port, ok := address(a)
	if !ok {
		return false, false
	}
	if ip == c.g.own {
		c.g.mu.Lock()
		defer c.g.mu.Unlock()
		dst := c.g.active[port]
		return dst != nil && !dst.closed.Load(), true
	}
	return public4(ip), false
}
func (c *guardedConn) budget(n int) bool {
	now := time.Now()
	return c.limit.AllowN(now, n) && c.g.global.AllowN(now, n)
}
func (c *guardedConn) ReadFrom(p []byte) (int, net.Addr, error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()
	for {
		if c.closed.Load() {
			return 0, nil, net.ErrClosed
		}
		// A full UDP buffer prevents a Windows WSAEMSGSIZE from terminating the
		// allocation when Pion supplies its smaller application receive buffer.
		n, a, err := c.PacketConn.ReadFrom(c.receive)
		if err != nil {
			return 0, a, err
		}
		if n > len(p) {
			c.g.stats.oversized.Add(1)
			continue
		}
		allowed, self := c.permitted(a)
		if !allowed {
			if self {
				c.g.stats.self.Add(1)
			} else {
				c.g.stats.private.Add(1)
			}
			continue
		}
		if !c.budget(n) {
			c.g.stats.throttled.Add(1)
			continue
		}
		copy(p, c.receive[:n])
		return n, a, nil
	}
}
func (c *guardedConn) WriteTo(p []byte, a net.Addr) (int, error) {
	if c.closed.Load() {
		return 0, net.ErrClosed
	}
	ip, port, ok := address(a)
	if !ok || ip != c.g.own && !public4(ip) {
		c.g.stats.private.Add(1)
		return len(p), nil
	}
	if !c.budget(len(p)) {
		c.g.stats.throttled.Add(1)
		return len(p), nil
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.closed.Load() {
		return 0, net.ErrClosed
	}
	if ip == c.g.own {
		// Keep a destination lease alive across local SendTo: it cannot be closed
		// and replaced by an unrelated local service between validation and use.
		c.g.mu.Lock()
		defer c.g.mu.Unlock()
		dst := c.g.active[port]
		if dst == nil || dst.closed.Load() {
			c.g.stats.self.Add(1)
			return len(p), nil
		}
	}
	if err := c.PacketConn.SetWriteDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		return 0, err
	}
	return c.PacketConn.WriteTo(p, a)
}
func (c *guardedConn) Close() error {
	var err error
	c.once.Do(func() {
		c.closed.Store(true)
		c.g.mu.Lock()
		defer c.g.mu.Unlock()
		err = c.PacketConn.Close()
		if c.g.active[c.port] == c {
			delete(c.g.active, c.port)
			c.g.users[c.user]--
			if c.g.users[c.user] == 0 {
				delete(c.g.users, c.user)
			}
		}
	})
	return err
}

func restAuth(secret []byte, realm string, now func() time.Time, s *counters) turn.AuthHandler {
	return func(a *turn.RequestAttributes) (string, []byte, bool) {
		expiry, err := strconv.ParseInt(a.Username, 10, 64)
		n := now().Unix()
		if len(a.Username) != 10 || err != nil || a.Username != strconv.FormatInt(expiry, 10) || expiry <= n || expiry > n+3660 || a.Realm != realm {
			s.rejected.Add(1)
			return "", nil, false
		}
		mac := hmac.New(sha1.New, secret)
		_, _ = mac.Write([]byte(a.Username))
		password := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		return a.Username, turn.GenerateAuthKey(a.Username, realm, password), true
	}
}
