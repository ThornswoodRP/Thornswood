#!/usr/bin/env node
'use strict';
/*
  listen.js

  A port on this machine's loopback where every connection is carried to the
  box's sshd through the bridge, one connect.js each (#2753). Only
  Setup-CloudSsh.ps1 uses it, for one thing: ssh-keyscan cannot run a
  ProxyCommand, so it is pointed here to ask the box for its host keys, which
  then meet the pin in scripts/vps/vps.json the same way Setup-SshKey.ps1's
  do. ssh itself never comes through here; it runs connect.js directly.

      node listen.js                  prints the port it took, then serves

  It listens on 127.0.0.1 only, on a port the system picks, and stops when its
  standard input closes or it is killed, so it outlives nothing that started
  it. connect.js reads its settings from the environment, which each one
  inherits from here.
*/
const net = require('net');
const path = require('path');
const cp = require('child_process');

const CONNECT = path.join(__dirname, 'connect.js');

const open = new Set();
const server = net.createServer((sock) => {
  open.add(sock);
  sock.on('close', () => open.delete(sock));
  const c = cp.spawn(process.execPath, [CONNECT], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  sock.on('error', () => {});
  c.stdin.on('error', () => {});
  sock.pipe(c.stdin);
  c.stdout.pipe(sock);
  c.on('exit', () => sock.destroy());
  // However the connection ended, connect.js is told its input is done, and
  // closes its WebSocket properly rather than being killed half way.
  sock.on('close', () => c.stdin.end());
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(server.address().port + '\n');
});

// When standard input ends, the port closes and every connection with it,
// which tells each connect.js its input is done; node ends once they have,
// with no call to its exit function, which can hang on Node 24 (#6036).
process.stdin.on('end', () => {
  server.close();
  for (const sock of open) sock.destroy();
});
process.stdin.resume();
