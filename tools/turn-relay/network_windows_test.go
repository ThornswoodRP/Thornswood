//go:build windows

package main

import (
	"context"
	"golang.org/x/sys/windows"
	"net"
	"syscall"
	"testing"
)

func TestExclusiveLeaseCannotBeSharedByReuseEnabledSocket(t *testing.T) {
	owner, e := listenUDP4("127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	defer owner.Close()
	reuse := net.ListenConfig{Control: func(_, _ string, c syscall.RawConn) error {
		var e error
		if x := c.Control(func(fd uintptr) {
			e = windows.SetsockoptInt(windows.Handle(fd), windows.SOL_SOCKET, windows.SO_REUSEADDR, 1)
		}); x != nil {
			return x
		}
		return e
	}}
	other, e := reuse.ListenPacket(context.Background(), "udp4", owner.LocalAddr().String())
	if e == nil {
		other.Close()
		t.Fatal("reuse-enabled unrelated socket shared an active relay lease")
	}
}
