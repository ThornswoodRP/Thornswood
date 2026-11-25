//go:build !windows

package main

import "net"

// The production package is Windows-only. Portable loopback tests still
// exercise the common guard and protocol; production startup refuses here.
func subscribeIPv4(func()) (func() error, error)        { return nil, errPolicy }
func listenUDP4(address string) (net.PacketConn, error) { return net.ListenPacket("udp4", address) }
