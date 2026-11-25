// Exercise the same entry point as the issue workflow, with no network.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../scripts/ops/Find-Duplicate.js');

const title = 'Copper forge price display';
const issue = (number, name) => ({ number, title: name, state: 'open', labels: [] });
const full = page => Array.from({ length: 100 }, (_, i) => issue(8000 - ((page - 1) * 100 + i), 'Unrelated notice'));

async function check(list) {
  const pages = [], writes = [], lines = [];
  const code = await run(['--issue', '9000'], { GITHUB_REPOSITORY: 'fixture/repo', GITHUB_TOKEN: 'fixture' },
    async (url, opts) => {
      const u = new URL(url);
      if (opts.method !== 'GET') {
        writes.push(opts.method);
        return new Response('{}');
      }
      if (u.pathname === '/repos/fixture/repo/issues/9000') return new Response(JSON.stringify(issue(9000, title)));
      assert.equal(u.pathname, '/repos/fixture/repo/issues');
      const n = Number(u.searchParams.get('page'));
      pages.push(n);
      return list(n);
    }, line => lines.push(line));
  return { code, pages, writes, out: lines.join('\n') };
}
const ok = rows => new Response(JSON.stringify(rows));

function refused(r) {
  assert.deepEqual(r.writes, []);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.out, /none alike|read against|repeats #/);
}

test('a 502 on page seven discards even an exact match on page one', async () => {
  const r = await check(n => {
    if (n === 7) return new Response('{"message":"Server Error"}', { status: 502 });
    const rows = full(n);
    if (n === 1) rows[0].title = title;
    return ok(rows);
  });
  refused(r);
  assert.deepEqual(r.pages, [1, 2, 3, 4, 5, 6, 7]);
  assert.match(r.out, /page=7: 502/);
});

test('an exact match on the final page is acted on after a complete read', async () => {
  const r = await check(n => ok(n < 7 ? full(n) : [issue(100, title)]));
  assert.equal(r.code, 0);
  assert.deepEqual(r.pages, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r.writes, ['POST', 'PATCH']);
  assert.match(r.out, /closed #9000 as a duplicate of #100/);
});

test('a complete list with no match returns a clean result', async () => {
  const r = await check(n => ok(n === 1 ? full(n) : []));
  assert.equal(r.code, 0);
  assert.deepEqual(r.pages, [1, 2]);
  assert.deepEqual(r.writes, []);
  assert.match(r.out, /read against 100 open issue\(s\): none alike/);
});

test('a full last allowed page is not evidence of a complete list', async () => {
  const r = await check(n => ok(full(n)));
  refused(r);
  assert.equal(r.pages.length, 50);
  assert.match(r.out, /incomplete.*50/i);
});

test('a short last allowed page is a complete list', async () => {
  const r = await check(n => ok(n < 50 ? full(n) : []));
  assert.equal(r.code, 0);
  assert.equal(r.pages.length, 50);
  assert.deepEqual(r.writes, []);
  assert.match(r.out, /read against 4900 open issue\(s\): none alike/);
});
