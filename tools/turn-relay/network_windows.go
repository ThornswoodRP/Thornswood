//go:build windows

package main

import (
	"context"
	"golang.org/x/sys/windows"
	"net"
	"syscall"
)

func subscribeIPv4(callback func()) (func() error, error) {
	thunk := windows.NewCallback(func(_, _, _ uintptr) uintptr { callback(); return 0 })
	var handle windows.Handle
	if e := windows.NotifyUnicastIpAddressChange(windows.AF_INET, thunk, nil, false, &handle); e != nil {
		return nil, e
	}
	return func() error { return windows.CancelMibChangeNotify2(handle) }, nil
}
func listenUDP4(address string) (net.PacketConn, error) {
	cfg := net.ListenConfig{Control: func(_, _ string, c syscall.RawConn) error {
		var socketError error
		e := c.Control(func(fd uintptr) {
			socketError = windows.SetsockoptInt(windows.Handle(fd), windows.SOL_SOCKET, ^windows.SO_REUSEADDR, 1)
		})
		if e != nil {
			return e
		}
		return socketError
	}}
	return cfg.ListenPacket(context.Background(), "udp4", address)
}
