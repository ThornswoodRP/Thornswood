package main

import (
	"encoding/json"
	"golang.org/x/time/rate"
	"net"
	"path/filepath"
	"testing"
	"time"
)

func configFixture(t *testing.T) configuration {
	t.Helper()
	return configuration{Schema: 1, Role: "dev", ListenAddress: "8.8.8.8", ListenPort: 3478, MinPort: 42000, MaxPort: 42031, Realm: "turn-dev.thornswood.net", KeyFile: filepath.Join(t.TempDir(), "key.txt")}
}
func TestStrictConfigurationNeverAdmitsLoopbackTestSeam(t *testing.T) {
	c := configFixture(t)
	raw, _ := json.Marshal(c)
	if _, e := parseConfiguration(raw); e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*configuration){func(c *configuration) { c.ListenAddress = "127.0.0.1" }, func(c *configuration) { c.ListenAddress = "::ffff:8.8.8.8" }, func(c *configuration) { c.ListenPort = 3479 }, func(c *configuration) { c.MaxPort++ }, func(c *configuration) { c.Role = "unknown" }, func(c *configuration) { c.Realm = "other" }, func(c *configuration) { c.KeyFile = "relative.txt" }} {
		bad := c
		change(&bad)
		raw, _ = json.Marshal(bad)
		if _, e := parseConfiguration(raw); e == nil {
			t.Fatal("unsafe config accepted", bad)
		}
	}
	raw, _ = json.Marshal(c)
	for _, bad := range [][]byte{append(raw, []byte(` {}`)...), []byte(`{"unknown":true}`), make([]byte, 16385)} {
		if _, e := parseConfiguration(bad); e == nil {
			t.Fatal("malformed config accepted")
		}
	}
	c.Role = "main"
	c.ListenPort = 3479
	c.MinPort = 42032
	c.MaxPort = 42063
	c.Realm = "turn-main.thornswood.net"
	raw, _ = json.Marshal(c)
	if _, e := parseConfiguration(raw); e != nil {
		t.Fatal("Main staging config rejected", e)
	}
}
func TestIngressOversizeAndThrottleAreDropsNotReadErrors(t *testing.T) {
	receiver, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer receiver.Close()
	sender, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer sender.Close()
	s := &counters{}
	wrapped := newIngress(receiver, s)
	_, _ = sender.WriteTo(make([]byte, 8192), receiver.LocalAddr())
	_, _ = sender.WriteTo([]byte("normal"), receiver.LocalAddr())
	_ = receiver.SetReadDeadline(time.Now().Add(time.Second))
	buf := make([]byte, 4096)
	n, _, e := wrapped.ReadFrom(buf)
	if e != nil || string(buf[:n]) != "normal" || s.oversized.Load() != 1 {
		t.Fatal("listener killed by oversized input", e)
	}
	wrapped.outbound = rate.NewLimiter(0, 1)
	_, _ = wrapped.WriteTo([]byte("xx"), sender.LocalAddr())
	_ = sender.SetReadDeadline(time.Now().Add(30 * time.Millisecond))
	if _, _, e = sender.ReadFrom(buf); e == nil || s.throttled.Load() != 1 {
		t.Fatal("listener output bound bypassed")
	}
	if len(wrapped.buckets) != 4096 {
		t.Fatal("ingress memory no longer fixed")
	}
}
