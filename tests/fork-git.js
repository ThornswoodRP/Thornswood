'use strict';
// How a harness asks a GitHub repository which commits one branch has and
// another does not (issue #3052).
//
// tests\test-engine-at-fork-head.js and tests\test-fork-upstream.js asked
// GitHub's REST compare API, signed out. GitHub allows 60 signed out API
// requests an hour per address, and a cloud thread (or a developer behind a
// carrier's shared address) leaves from an address others use, so the
// allowance was gone before the harness asked and both failed with a 403 that
// said nothing about the engine (measured 21 Oct from a cloud container,
// whose address GitHub named in "API rate limit exceeded for ..."). The
// question is about commits, and git answers it itself over the same https
// address it clones from, which that API limit does not cover and which
// needs no token: both repositories are public. So nothing here reads a
// token, and none is needed on any machine.
//
// open(what) makes an empty bare repository in the system temp folder.
// fetch(name, url, refspecs) brings in commits only (--filter=tree:0, a few
// MB for the whole engine history; a tree git needs later, for a diff, is
// fetched when asked for). compare(base, head) answers in the shape GitHub's
// compare API did, so each harness's verdict reads the same:
//   { status: identical|ahead|behind|diverged, ahead_by, behind_by,
//     commits: [{ sha, commit: { message } }] }   (head's commits, oldest first)
// Every git failure throws with what git said, so a harness prints the real
// reason (no network, a repository gone) and not only that it failed.
// close() removes the folder.
//
// git never asks for a password here: a repository that wants one is a
// failure to report, not a prompt to wait on.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ENV = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
const NO_ASKING = ['-c', 'credential.helper=', '-c', 'core.askPass='];
// A fetch that hangs fails instead of holding the nightly.
const LIMIT_MS = 120000;

function open(what) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-' + what + '-'));

  function git(args) {
    const r = spawnSync('git', NO_ASKING.concat(['-C', dir], args), { encoding: 'utf8', env: ENV, timeout: LIMIT_MS, windowsHide: true });
    if (r.error) { throw new Error('git ' + args[0] + ' did not run: ' + r.error.message); }
    if (r.status !== 0) {
      const said = String(r.stderr || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).join(' / ');
      throw new Error('git ' + args.join(' ') + ' said: ' + (said || 'nothing, exit ' + r.status));
    }
    return String(r.stdout || '').trim();
  }

  git(['init', '-q', '--bare']);

  function fetch(name, url, refspecs) {
    git(['remote', 'add', name, url]);
    git(['fetch', '-q', '--no-tags', '--filter=tree:0', name].concat(refspecs));
  }

  function count(range) { return Number(git(['rev-list', '--count'].concat(range))); }

  function compare(base, head) {
    const ahead = count([head, '^' + base]);
    const behind = count([base, '^' + head]);
    const status = ahead === 0 && behind === 0 ? 'identical' : behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged';
    const out = git(['log', '--reverse', '--format=%H%x1f%s', head, '^' + base]);
    const commits = out ? out.split(/\r?\n/).map(function (l) {
      const p = l.split('\x1f');
      return { sha: p[0], commit: { message: p[1] || '' } };
    }) : [];
    return { status: status, ahead_by: ahead, behind_by: behind, commits: commits };
  }

  function close() { fs.rmSync(dir, { recursive: true, force: true }); }

  return { dir: dir, git: git, fetch: fetch, compare: compare, close: close };
}

module.exports = { open: open };
