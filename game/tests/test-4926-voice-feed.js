'use strict';

// Exercise the real position feed against local HTTP responses that never end.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../gamemode/voice-feed.ts'), 'utf8');

for (const failure of ['truncated response', 'stalled response', 'trickling response']) {
  test(`the position feed sends fresh positions after a ${failure}`, async () => {
    const posts = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        posts.push(JSON.parse(body));
        if (posts.length > 1) {
          response.end('ok');
          return;
        }
        response.writeHead(200, { 'content-length': 20 });
        response.write('partial');
        if (failure === 'truncated response') setTimeout(() => response.destroy(), 50);
        if (failure === 'trickling response') {
          const trickle = setInterval(() => response.write('x'), 150);
          response.once('close', () => clearInterval(trickle));
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    let tick;
    let position = [1, 2, 3];
    const state = { profileId: 10, appearance: { name: 'Test' }, worldOrCellDesc: 'test' };
    try {
      vm.runInNewContext(source, {
        voicePort: () => server.address().port,
        guard: (name, run) => run,
        require(name) { if (name === 'http') return http; throw Error(name); },
        setInterval(run, ms) { if (ms === 200) tick = run; },
        setTimeout, clearTimeout, Buffer,
        mp: { get: (id, key) => id === 0 ? [1] : key === 'pos' ? position : state[key] },
        console: { log() {} }
      });
      assert.equal(typeof tick, 'function');
      tick();
      tick();
      for (let n = 0; posts.length === 0 && n < 100; n++) await delay(10);
      assert.equal(posts.length, 1, 'only one request at a time');
      assert.deepEqual(posts[0].who[0].pos, [1, 2, 3]);
      position = [4, 5, 6];
      for (let n = 0; posts.length < 2 && n < 100; n++) {
        await delay(20);
        tick();
      }
      assert.equal(posts.length, 2, 'fresh position post after the broken response');
      assert.deepEqual(posts[1].who[0].pos, [4, 5, 6]);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
