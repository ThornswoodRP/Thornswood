// scripts/bot/load-sampler.js
//
// #4623. Loaded into the game server by the load test (node -r), so the
// server process itself says how much it uses: once a second it appends
// one line of JSON to the file THORNSWOOD_LOAD_SAMPLES names, with the
// process's CPU time (user and system, in microseconds, every thread of it:
// libuv reads the whole process's times) and its memory (rss, the working
// set on Windows; the JavaScript heap; and what native code holds outside
// it). Nothing else of the server is touched, and without the variable this
// does nothing. A line that could not be written is counted in the next
// one (failed), so the load test sees a gap instead of guessing.
'use strict';
const fs = require('fs');

const file = process.env.THORNSWOOD_LOAD_SAMPLES;
if (file) {
  let failed = 0;
  const take = () => {
    const c = process.cpuUsage();
    const m = process.memoryUsage();
    const line = JSON.stringify({ at: Date.now(), user: c.user, system: c.system, rss: m.rss, heap: m.heapUsed, external: m.external, failed });
    try { fs.appendFileSync(file, line + '\n'); failed = 0; } catch (e) { failed++; }
  };
  take();
  setInterval(take, 1000).unref();
}
