'use strict';
/*
  test-2187-signin-addr.js

  #2187: the sign-in log took the FIRST X-Forwarded-For hop from any caller,
  so anybody reaching the site could write any address into signins.json.
  server.js now has one trusted-proxy boundary, requestAddr, that the sign-in
  log and the report limit (clientAddr) both use.

  A. requestAddr, lifted from the real server.js and run with and without
     THORNSWOOD_TRUSTED_PROXIES: direct callers, spoofing, loopback (Caddy),
     IPv4-mapped addresses, multi-hop headers, junk in the header.
  B. clientAddr still keys the report limit the way it did (IPv6 as its /64).
  C. The source: noteSignIn records requestAddr(req), and nothing else in
     server.js reads X-Forwarded-For; privacy.md says what the address is.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const net = require('net');
const siteFiles = require('../../tests/site-files');

const SRC = siteFiles.source().split('\r\n').join('\n');
const PRIV = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'data', 'site', 'privacy.md'), 'utf8');
let pass = 0, fail = 0;
function eq(what, got, want) {
  if (got === want) { pass++; console.log('PASS  ' + what + ' -> ' + JSON.stringify(got)); }
  else { fail++; console.log('FAIL  ' + what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
}
function yes(what, c) { eq(what, !!c, true); }

const start = SRC.indexOf('const TRUSTED_PROXIES');
const cStart = SRC.indexOf('function clientAddr(req)');
const end = SRC.indexOf('\n}\n', cStart) + 3;
yes('the boundary and clientAddr are in server.js', start > 0 && cStart > start && end > cStart);
function load(trusted) {
  const box = { net, process: { env: trusted === undefined ? {} : { THORNSWOOD_TRUSTED_PROXIES: trusted } }, String, Set, Math, Array, parseInt };
  vm.runInNewContext(SRC.slice(start, end) + '\nthis.requestAddr = requestAddr; this.clientAddr = clientAddr;', box);
  return box;
}
const req = (sock, xff) => ({ socket: { remoteAddress: sock }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

let L = load();
const r = L.requestAddr;
// Direct callers
eq('A1 direct caller, no header', r(req('203.0.113.7')), '203.0.113.7');
eq('A2 direct caller spoofing one hop is ignored', r(req('203.0.113.7', '1.2.3.4')), '203.0.113.7');
eq('A3 direct caller spoofing several hops is ignored', r(req('203.0.113.7', '1.2.3.4, 5.6.7.8')), '203.0.113.7');
eq('A4 direct IPv4-mapped caller is recorded plain', r(req('::ffff:203.0.113.7', '1.2.3.4')), '203.0.113.7');
eq('A5 direct IPv6 caller, header ignored', r(req('2001:db8::5', '1.2.3.4')), '2001:db8::5');
// Loopback is Caddy
eq('A6 loopback with Caddy header takes it', r(req('127.0.0.1', '198.51.100.9')), '198.51.100.9');
eq('A7 loopback multi-hop takes the LAST hop (what Caddy wrote)', r(req('127.0.0.1', '6.6.6.6, 198.51.100.9')), '198.51.100.9');
eq('A8 IPv4-mapped loopback counts as loopback', r(req('::ffff:127.0.0.1', '198.51.100.9')), '198.51.100.9');
eq('A9 IPv6 loopback counts as loopback', r(req('::1', '198.51.100.9')), '198.51.100.9');
eq('A10 an IPv4-mapped forwarded hop is recorded plain', r(req('127.0.0.1', '::ffff:198.51.100.9')), '198.51.100.9');
eq('A11 loopback with no header is loopback', r(req('127.0.0.1')), '127.0.0.1');
eq('A12 loopback with a junk last hop keeps the socket', r(req('127.0.0.1', '1.2.3.4, <script>')), '127.0.0.1');
eq('A13 loopback with an empty trailing hop takes the last real one', r(req('127.0.0.1', '9.9.9.9, ')), '9.9.9.9');
eq('A14 no socket at all is empty, not a header', r({ headers: { 'x-forwarded-for': '1.2.3.4' } }), '');
eq('A15 a non-loopback 127-lookalike is not trusted', r(req('1270.0.0.1'.slice(0, 0) + '128.0.0.1', '1.2.3.4')), '128.0.0.1');
// Configured proxies
L = load(' 10.0.0.5 , ::ffff:10.0.0.6 ');
eq('A16 a configured proxy is trusted', L.requestAddr(req('10.0.0.5', '6.6.6.6, 198.51.100.9')), '198.51.100.9');
eq('A17 a configured proxy given mapped, reached plain', L.requestAddr(req('10.0.0.6', '198.51.100.9')), '198.51.100.9');
eq('A18 a configured proxy reached mapped', L.requestAddr(req('::ffff:10.0.0.5', '198.51.100.9')), '198.51.100.9');
eq('A19 an unlisted neighbour is not', L.requestAddr(req('10.0.0.7', '198.51.100.9')), '10.0.0.7');

// B: the report key
L = load();
eq('B1 report key behind Caddy is the forwarded address', L.clientAddr(req('127.0.0.1', '198.51.100.9')), '198.51.100.9');
eq('B2 report key for an IPv6 sender is its /64', L.clientAddr(req('127.0.0.1', '2001:db8:1:2:3:4:5:6')), '2001:db8:1:2::/64');
eq('B3 report key for a direct spoofer is its socket', L.clientAddr(req('203.0.113.7', '1.2.3.4')), '203.0.113.7');

// C: the source
const ns = SRC.slice(SRC.indexOf('function noteSignIn('), SRC.indexOf('\n}\n', SRC.indexOf('function noteSignIn(')));
yes('C1 noteSignIn records ip: requestAddr(req)', /ip:\s*requestAddr\(req\)/.test(ns));
const reads = SRC.split("['x-forwarded-for']").length - 1;
eq('C2 X-Forwarded-For is read in exactly one place in server.js', reads, 1);
yes('C3 and that place is inside requestAddr', SRC.indexOf("['x-forwarded-for']") > SRC.indexOf('function requestAddr(') && SRC.indexOf("['x-forwarded-for']") < cStart);
yes('C4 privacy.md says the address is what our front door saw', /as our own front door saw it/.test(PRIV));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
