package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"github.com/pion/logging"
	"github.com/pion/turn/v5"
	"net"
	"strconv"
	"testing"
	"time"
)

func TestRealTURNAuthAndBidirectionalMediaKeepSameHostGuard(t *testing.T) {
	g := testAllocator(t)
	listener, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer listener.Close()
	factory := logging.NewDefaultLoggerFactory()
	factory.DefaultLogLevel = logging.LogLevelDisabled
	secret := []byte("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	server, e := turn.NewServer(turn.ServerConfig{Realm: g.realm, AuthHandler: restAuth(secret, g.realm, time.Now, g.stats), QuotaHandler: g.quota, LoggerFactory: factory, InboundMTU: 4096, StrictAddressFamily: true,
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: newIngress(listener, g.stats), RelayAddressGenerator: g, PermissionHandler: g.permission}}})
	if e != nil {
		t.Fatal(e)
	}
	defer server.Close()
	username := strconv.FormatInt(time.Now().Unix()+3600, 10)
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write([]byte(username))
	password := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	connect := func(user, pass string) (*turn.Client, net.PacketConn) {
		socket, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { _ = socket.Close() })
		c, e := turn.NewClient(&turn.ClientConfig{Conn: socket, TURNServerAddr: listener.LocalAddr().String(), Username: user, Password: pass, Realm: g.realm, LoggerFactory: factory, RTO: 10 * time.Millisecond})
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(c.Close)
		if e = c.Listen(); e != nil {
			t.Fatal(e)
		}
		r, e := c.Allocate()
		if e != nil {
			return c, nil
		}
		t.Cleanup(func() { _ = r.Close() })
		return c, r
	}
	_, bad := connect(username, "incorrect")
	if bad != nil {
		t.Fatal("wrong HMAC allocated")
	}
	_, expired := connect(strconv.FormatInt(time.Now().Unix()-1, 10), password)
	if expired != nil {
		t.Fatal("expired allocated")
	}
	_, a := connect(username, password)
	_, b := connect(username, password)
	if a == nil || b == nil {
		t.Fatal("valid REST credentials failed")
	}
	// Prime each permission using the real TURN client's authenticated protocol.
	if _, e = a.WriteTo([]byte("a to b"), b.LocalAddr()); e != nil {
		t.Fatal(e)
	}
	if _, e = b.WriteTo([]byte("b to a"), a.LocalAddr()); e != nil {
		t.Fatal(e)
	}
	read := func(c net.PacketConn, want string) {
		t.Helper()
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 64)
		n, _, e := c.ReadFrom(buf)
		if e != nil || string(buf[:n]) != want {
			t.Fatalf("real TURN payload %q want %q (%v)", buf[:n], want, e)
		}
	}
	read(a, "b to a")
	if _, e = a.WriteTo([]byte("reverse preserved"), b.LocalAddr()); e != nil {
		t.Fatal(e)
	}
	read(b, "reverse preserved")
	marker, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer marker.Close()
	if _, e = a.WriteTo([]byte("must not reach host service"), marker.LocalAddr()); e != nil {
		t.Fatal(e)
	}
	_ = marker.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	buf := make([]byte, 64)
	if _, _, e = marker.ReadFrom(buf); e == nil {
		t.Fatal("authenticated TURN forwarded to same-host non-allocation service")
	}
	if g.stats.self.Load() == 0 {
		t.Fatal("actual TURN did not exercise data-boundary guard")
	}
}
