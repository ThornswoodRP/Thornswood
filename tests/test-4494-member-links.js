'use strict';
// #4494. The member-facing link copy must not advertise the staff queue.
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r/g, '');
const copy = /^LINKS = """\\\n([\s\S]*?)^"""/m.exec(read('bot/content.py'))?.[1] || '';
const home = read('site/public/home.js');
const galleryStart = home.indexOf("} else if (here === '/gallery') {");
const reportStart = home.indexOf("} else if (here === '/report') {");
const checks = [
  ['Links offers screenshot submission through the member gallery', /^\*\*Submit a screenshot\*\* https:\/\/thornswood\.net\/gallery$/m.test(copy)],
  ['Links never sends members to the staff uploads queue', !!copy && !/thornswood\.net\/uploads\b/i.test(copy)],
  ['Links keeps the existing report page', /^\*\*Report something\*\* https:\/\/thornswood\.net\/report$/m.test(copy)],
  ['The gallery and report pages submit through separate routes', galleryStart >= 0 && reportStart > galleryStart && home.slice(galleryStart, reportStart).includes('/api/gallery/submit?') && home.slice(reportStart).includes("request('/api/report',")],
  ['The uploads queue remains staff-only', /uploads: 'staff'/.test(read('site/lib/pages.js'))]
];
let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures++;
}
console.log(`${checks.length - failures} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
