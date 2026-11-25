package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v5"
	"golang.org/x/time/rate"
)

var sourceCommit = "unrecorded"
var buildVersion = "development"

type configuration struct {
	Schema        int    `json:"schema"`
	Role          string `json:"role"`
	ListenAddress string `json:"listenAddress"`
	ListenPort    int    `json:"listenPort"`
	MinPort       int    `json:"minPort"`
	MaxPort       int    `json:"maxPort"`
	Realm         string `json:"realm"`
	KeyFile       string `json:"keyFile"`
}

func parseConfiguration(raw []byte) (configuration, error) {
	var c configuration
	if len(raw) > 16384 {
		return c, errPolicy
	}
	// encoding/json otherwise permits duplicate keys and case-insensitive field
	// aliases. The operator contract requires exactly these eight names once.
	shape := json.NewDecoder(bytes.NewReader(raw))
	opening, e := shape.Token()
	if e != nil || opening != json.Delim('{') {
		return c, errPolicy
	}
	seen := map[string]bool{}
	for shape.More() {
		name, e := shape.Token()
		key, ok := name.(string)
		if e != nil || !ok || seen[key] {
			return c, errPolicy
		}
		seen[key] = true
		var value json.RawMessage
		if shape.Decode(&value) != nil {
			return c, errPolicy
		}
	}
	for _, key := range []string{"schema", "role", "listenAddress", "listenPort", "minPort", "maxPort", "realm", "keyFile"} {
		if !seen[key] {
			return c, errPolicy
		}
	}
	if len(seen) != 8 {
		return c, errPolicy
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return c, errPolicy
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return c, errPolicy
	}
	ip, err := netip.ParseAddr(c.ListenAddress)
	if err != nil || !ip.Is4() || !public4(ip) || ip.String() != c.ListenAddress || c.Schema != 1 || !filepath.IsAbs(c.KeyFile) {
		return c, errPolicy
	}
	port, min := 3478, 42000
	if c.Role == "main" {
		port = 3479
		min = 42032
	} else if c.Role != "dev" {
		return c, errPolicy
	}
	if c.ListenPort != port || c.MinPort != min || c.MaxPort != min+31 || c.Realm != "turn-"+c.Role+".thornswood.net" {
		return c, errPolicy
	}
	return c, nil
}

func readBounded(path string, limit int64) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, errPolicy
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errPolicy
	}
	b, e := io.ReadAll(io.LimitReader(f, limit+1))
	if e != nil || int64(len(b)) > limit {
		return nil, errPolicy
	}
	return b, nil
}

// Fixed hash buckets bound unauthenticated ingress memory under spoofed-IP
// floods. Collisions share a limit rather than allocating attacker-owned state.
// They are deliberately independent of TURN's authenticated credential quota.
type ingressConn struct {
	net.PacketConn
	mu       sync.Mutex
	buffer   []byte
	buckets  [4096]*rate.Limiter
	global   *rate.Limiter
	outbound *rate.Limiter
	stats    *counters
	failed   chan struct{}
}

func newIngress(c net.PacketConn, s *counters) *ingressConn {
	return &ingressConn{PacketConn: c, buffer: make([]byte, 65535), global: rate.NewLimiter(8000, 8000), outbound: rate.NewLimiter(2097152, 2097152), stats: s, failed: make(chan struct{}, 1)}
}
func (c *ingressConn) ReadFrom(p []byte) (int, net.Addr, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for {
		n, a, e := c.PacketConn.ReadFrom(c.buffer)
		if e != nil {
			select {
			case c.failed <- struct{}{}:
			default:
			}
			return 0, a, e
		}
		if n > len(p) {
			c.stats.oversized.Add(1)
			continue
		}
		ip, _, ok := address(a)
		if !ok {
			c.stats.rejected.Add(1)
			continue
		}
		h := uint32(2166136261)
		for _, b := range ip.AsSlice() {
			h = (h ^ uint32(b)) * 16777619
		}
		slot := h % 4096
		if c.buckets[slot] == nil {
			c.buckets[slot] = rate.NewLimiter(1000, 1000)
		}
		now := time.Now()
		if !c.global.AllowN(now, 1) || !c.buckets[slot].AllowN(now, 1) {
			c.stats.throttled.Add(1)
			continue
		}
		copy(p, c.buffer[:n])
		return n, a, nil
	}
}
func (c *ingressConn) WriteTo(p []byte, a net.Addr) (int, error) {
	if !c.outbound.AllowN(time.Now(), len(p)) {
		c.stats.throttled.Add(1)
		return len(p), nil
	}
	return c.PacketConn.WriteTo(p, a)
}

func serve(c configuration) error {
	secret, e := readBounded(c.KeyFile, 65)
	if e != nil {
		return errPolicy
	}
	if len(secret) == 65 && secret[64] == '\n' {
		secret = secret[:64]
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).Match(secret) {
		return errPolicy
	}
	defer clear(secret)
	stats := &counters{}
	watch, e := newAddressWatch(localIPv4, subscribeIPv4)
	if e != nil {
		return errPolicy
	}
	defer watch.Close()
	allocator := newAllocator(netip.MustParseAddr(c.ListenAddress), c.MinPort, c.MaxPort, c.Realm, stats)
	allocator.localIPs = watch.current
	defer allocator.shutdown()
	listener, e := listenUDP4((&net.UDPAddr{IP: net.ParseIP(c.ListenAddress), Port: c.ListenPort}).String())
	if e != nil {
		return errPolicy
	}
	defer listener.Close()
	// Upstream logs can contain remote addresses/usernames. Suppress them rather
	// than serializing untrusted fields; publish aggregate counters only.
	logger := logging.NewDefaultLoggerFactory()
	logger.DefaultLogLevel = logging.LogLevelDisabled
	ingress := newIngress(listener, stats)
	server, e := turn.NewServer(turn.ServerConfig{Realm: c.Realm, AuthHandler: restAuth(secret, c.Realm, time.Now, stats), QuotaHandler: allocator.quota,
		LoggerFactory: logger, AllocationLifetime: 10 * time.Minute, StrictAddressFamily: true, InboundMTU: 4096,
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: ingress, RelayAddressGenerator: allocator, PermissionHandler: allocator.permission}}})
	if e != nil {
		return errPolicy
	}
	defer server.Close()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	defer signal.Stop(stop)
	fmt.Println(`{"event":"relay-ready","schema":1}`)
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return nil
		case <-ingress.failed:
			return errPolicy
		case <-watch.changed:
			fmt.Println(`{"event":"relay-interface-inventory-changed","action":"stopped"}`)
			return errPolicy
		case <-tick.C:
			allocator.mu.Lock()
			active := len(allocator.active)
			allocator.mu.Unlock()
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"event": "relay-counts", "active": active, "created": stats.created.Load(), "rejected": stats.rejected.Load(), "privateDrops": stats.private.Load(), "selfDrops": stats.self.Load(), "throttled": stats.throttled.Load(), "oversized": stats.oversized.Load()})
		}
	}
}

func run(args []string) error {
	if len(args) == 1 && args[0] == "-version" {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"product": "Thornswood TURN", "schema": 1, "source": sourceCommit, "version": buildVersion})
	}
	if len(args) != 2 || args[0] != "-config" || !filepath.IsAbs(args[1]) {
		return errPolicy
	}
	raw, e := readBounded(args[1], 16384)
	if e != nil {
		return errPolicy
	}
	c, e := parseConfiguration(raw)
	if e != nil {
		return errPolicy
	}
	return serve(c)
}
func main() {
	if run(os.Args[1:]) != nil {
		fmt.Fprintln(os.Stderr, "relay refused startup or stopped unexpectedly")
		os.Exit(1)
	}
}
