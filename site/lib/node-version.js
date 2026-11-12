/*
  The lowest Node the site runs on (#4365). Asked by server.js before any
  other part of the site is loaded.

  base.js sets the roots every request is checked against (#3111) with two
  calls Node has not always had. tls.getCACertificates came in Node 23.10
  and 22.15; tls.setDefaultCACertificates in Node 24.5 and 22.19, and no
  Node 23 has it. On an older Node the site stopped at its first line with
  a TypeError and a stack, which named neither the Node it needs nor the one
  it found. Now it stops with one line that says both.

  The version is read, and the two calls are looked for as well, so a Node
  whose number passes but lacks them still gets the plain line.
*/

'use strict';

const NEEDS = 'Node 22.19 or later, or 24.5 or later';

// null when this Node runs the site, else the one line to stop with.
function nodeVerdict(version, tls) {
  const m = /^v?(\d+)\.(\d+)\.\d+/.exec(String(version || ''));
  const major = m ? Number(m[1]) : 0;
  const minor = m ? Number(m[2]) : 0;
  const recent = major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 19);
  const calls = !!tls && typeof tls.getCACertificates === 'function' &&
    typeof tls.setDefaultCACertificates === 'function';
  if (recent && calls) return null;
  return 'The site needs ' + NEEDS + '; this is Node ' + (version || 'of no version') +
    (recent ? ', which has no tls.getCACertificates or tls.setDefaultCACertificates' : '') + '.';
}

module.exports = { NEEDS, nodeVerdict };
